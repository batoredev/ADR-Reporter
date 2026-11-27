"""Trains a detector that finds a medicine pack's name and its batch/date block in a photo, so the reader can zoom in.

    .venv-ml/Scripts/python.exe ml/detector/train.py [--epochs 6]

Data: ml/data/roboflow-major-project (download.py; CC BY 4.0, credit in ATTRIBUTION.txt). Its train split holds
each source photo three times (turned 0 or 90 degrees); its 507 "valid" photos are untouched originals and are
used only as the held-back test. Model: torchvision Faster R-CNN with a MobileNetV3 backbone (BSD licence, so it
can be served in the app), starting from COCO weights. Fits a 4 GB GPU.

Scored on what zooming needs: for each true name or date area, whether the best detection covers nearly all of it
(after the margin added before cropping), and how many detections are false alarms.
"""

import argparse
import json
import math
import random
import time
from pathlib import Path

import torch
from PIL import Image, ImageEnhance, ImageFilter
from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_fpn
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms.functional import to_tensor

DATA = Path("ml/data/roboflow-major-project/dataset")
CLASSES = ["background", "name", "date"]
MAX_SIDE = 800  # date and name blocks are large; 800 px trains about 1.6x faster than 1024 on a laptop GPU


def load(split):
    coco = json.loads((DATA / split / "_annotations.coco.json").read_text(encoding="utf-8"))
    names = {c["id"]: c["name"] for c in coco["categories"]}
    boxes = {}
    for a in coco["annotations"]:
        label = names[a["category_id"]]
        if label in CLASSES:
            x, y, w, h = a["bbox"]
            if w > 2 and h > 2:
                boxes.setdefault(a["image_id"], []).append((x, y, x + w, y + h, CLASSES.index(label)))
    return [(DATA / split / i["file_name"], boxes.get(i["id"], [])) for i in coco["images"]]


def prepare(path, boxes, train):
    img = Image.open(path).convert("RGB")
    # Training sees photos at varied sizes (phones send them at many resolutions); the test always at MAX_SIDE.
    side = random.choice([640, 704, 768, 800, 864]) if train else MAX_SIDE
    scale = side / max(img.size)
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.BILINEAR)
    else:
        scale = 1.0
    if train:  # phone-photo variation the copies do not cover: light, contrast, blur
        img = ImageEnhance.Brightness(img).enhance(random.uniform(0.7, 1.3))
        img = ImageEnhance.Contrast(img).enhance(random.uniform(0.7, 1.3))
        if random.random() < 0.3:
            img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.5, 1.5)))
    b = torch.tensor([[x1 * scale, y1 * scale, x2 * scale, y2 * scale] for x1, y1, x2, y2, _ in boxes], dtype=torch.float32).reshape(-1, 4)
    labels = torch.tensor([c for *_, c in boxes], dtype=torch.int64)
    return to_tensor(img), {"boxes": b, "labels": labels}


class Photos(torch.utils.data.Dataset):
    """Photos decoded and varied on several CPU cores while the GPU trains (decoding is the slow part)."""

    def __init__(self, rows):
        self.rows = rows

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        return prepare(*self.rows[i], True)


def as_batch(items):
    return tuple(zip(*items))


def coverage(true_box, pred_box, margin=0.08):
    """Share of the true area inside the predicted box once widened by the crop margin."""
    tx1, ty1, tx2, ty2 = true_box
    px1, py1, px2, py2 = pred_box
    mw, mh = (px2 - px1) * margin, (py2 - py1) * margin
    px1, py1, px2, py2 = px1 - mw, py1 - mh, px2 + mw, py2 + mh
    iw = max(0.0, min(tx2, px2) - max(tx1, px1))
    ih = max(0.0, min(ty2, py2) - max(ty1, py1))
    return iw * ih / max(1e-6, (tx2 - tx1) * (ty2 - ty1))


@torch.no_grad()
def evaluate(model, rows, threshold=0.5):
    model.eval()
    found = {1: [0, 0], 2: [0, 0]}  # class -> [covered >= 90%, total]
    alarms = {1: 0, 2: 0}
    for path, boxes in rows:
        img, target = prepare(path, boxes, False)
        out = model([img.cuda()])[0]
        keep = out["scores"] >= threshold
        pb, pl = out["boxes"][keep].cpu().tolist(), out["labels"][keep].cpu().tolist()
        truth = list(zip(target["boxes"].tolist(), target["labels"].tolist()))
        for tb, tl in truth:
            found[tl][1] += 1
            if any(l == tl and coverage(tb, p) >= 0.9 for p, l in zip(pb, pl)):
                found[tl][0] += 1
        for p, l in zip(pb, pl):
            if not any(tl == l and coverage(tb, p) > 0.3 for tb, tl in truth):
                alarms[l] += 1
    return {CLASSES[c]: {"covered": f[0], "total": f[1], "rate": round(f[0] / max(1, f[1]), 3), "false_alarms": alarms[c]}
            for c, f in found.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--lr", type=float, default=0.01)
    args = parser.parse_args()
    random.seed(7)
    torch.manual_seed(7)
    train_rows, test_rows = load("train"), load("valid")
    print(f"{len(train_rows)} training photos, {len(test_rows)} held-back test photos", flush=True)

    model = fasterrcnn_mobilenet_v3_large_fpn(weights="DEFAULT", min_size=512, max_size=MAX_SIDE)
    model.roi_heads.box_predictor = FastRCNNPredictor(model.roi_heads.box_predictor.cls_score.in_features, len(CLASSES))
    model.cuda()
    params = [p for p in model.parameters() if p.requires_grad]
    optimiser = torch.optim.SGD(params, lr=args.lr, momentum=0.9, weight_decay=1e-4)
    steps = args.epochs * (len(train_rows) // args.batch)
    schedule = torch.optim.lr_scheduler.LambdaLR(
        optimiser, lambda s: min(1.0, (s + 1) / 300) * 0.5 * (1 + math.cos(math.pi * s / steps)))
    scaler = torch.amp.GradScaler()
    run = Path("ml/runs/detector") / time.strftime("%Y%m%d-%H%M%S")
    run.mkdir(parents=True, exist_ok=True)
    started, best = time.time(), -1.0
    loader = torch.utils.data.DataLoader(Photos(train_rows), batch_size=args.batch, shuffle=True, num_workers=6,
                                         collate_fn=as_batch, persistent_workers=True, drop_last=True)
    for epoch in range(1, args.epochs + 1):
        model.train()
        total, n = 0.0, 0
        for imgs, tgts in loader:
            images = [im.cuda(non_blocking=True) for im in imgs]
            targets = [{k: v.cuda() for k, v in t.items()} for t in tgts]
            with torch.autocast("cuda", dtype=torch.float16):
                loss = sum(model(images, targets).values())
            optimiser.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(optimiser)
            torch.nn.utils.clip_grad_norm_(params, 10.0)
            scaler.step(optimiser)
            scaler.update()
            schedule.step()
            total, n = total + loss.item(), n + 1
            if n % 200 == 0:
                print(f"  epoch {epoch} step {n}/{len(loader)} loss {total / n:.3f} {time.time() - started:.0f}s", flush=True)
        score = evaluate(model, test_rows)
        both = (score["name"]["rate"] + score["date"]["rate"]) / 2
        print(f"epoch {epoch}/{args.epochs} loss {total / n:.3f} test {json.dumps(score)} {time.time() - started:.0f}s", flush=True)
        if both > best:
            best = both
            torch.save(model.state_dict(), run / "model.pt")
            (run / "result.json").write_text(json.dumps(
                {"epoch": epoch, "test": score, "classes": CLASSES, "max_side": MAX_SIDE,
                 "data": "roboflow college-hxirw/major-project-8anow v5, CC BY 4.0"}, indent=2))
    print(f"Best test coverage {best:.3f}; saved to {run}", flush=True)


if __name__ == "__main__":
    main()
