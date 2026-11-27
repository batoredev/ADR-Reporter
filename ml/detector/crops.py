"""Cuts the batch/date block out of each test photo for the zoom test, in the orientations to try.

    .venv-ml/Scripts/python.exe ml/detector/crops.py --boxes truth          # the hand-drawn boxes (best case)
    .venv-ml/Scripts/python.exe ml/detector/crops.py --boxes ml/runs/detector/<run>/model.pt   # the detector's

Writes ml/data/pack-dates-test/crops-<source>/<id>-<angle>.jpg: the block with a margin, enlarged so its longer
side is about 1400 px, turned 90/270 degrees when it is printed sideways and 0/180 when it is not (strips are
photographed either way up). The reader then keeps the orientation whose reading has a batch and dates.
"""

import argparse
import json
from pathlib import Path

from PIL import Image

TEST = Path("ml/data/pack-dates-test")
PHOTOS = Path("ml/data/roboflow-major-project/dataset/valid")


def detector_boxes(model_path, rows):
    import torch
    from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_fpn
    from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
    from torchvision.transforms.functional import to_tensor

    side = json.loads((Path(model_path).parent / "result.json").read_text())["max_side"]
    model = fasterrcnn_mobilenet_v3_large_fpn(weights=None, weights_backbone=None, min_size=round(side * 0.64), max_size=side)
    model.roi_heads.box_predictor = FastRCNNPredictor(model.roi_heads.box_predictor.cls_score.in_features, 3)
    model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=True))
    model.eval().cuda()
    found = {}
    with torch.no_grad():
        for r in rows:
            img = Image.open(PHOTOS / r["file"]).convert("RGB")
            scale = min(1.0, side / max(img.size))
            small = img.resize((round(img.width * scale), round(img.height * scale)))
            out = model([to_tensor(small).cuda()])[0]
            dates = [(s.item(), b.tolist()) for b, l, s in zip(out["boxes"], out["labels"], out["scores"]) if l.item() == 2]
            if dates:
                score, (x1, y1, x2, y2) = max(dates)
                found[r["id"]] = [x1 / scale, y1 / scale, (x2 - x1) / scale, (y2 - y1) / scale, round(score, 3)]
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--boxes", default="truth")
    args = parser.parse_args()
    rows = json.loads(Path("samples/pack-dates-benchmark.json").read_text(encoding="utf-8"))["photos"]
    source = "truth" if args.boxes == "truth" else "detector"
    boxes = {r["id"]: r["box"] for r in rows} if source == "truth" else detector_boxes(args.boxes, rows)
    out = TEST / f"crops-{source}"
    out.mkdir(parents=True, exist_ok=True)
    made = 0
    for r in rows:
        if r["id"] not in boxes:
            continue
        x, y, w, h = boxes[r["id"]][:4]
        img = Image.open(PHOTOS / r["file"]).convert("RGB")
        mx, my = w * 0.1, h * 0.1
        crop = img.crop((max(0, x - mx), max(0, y - my), min(img.width, x + w + mx), min(img.height, y + h + my)))
        grow = 1400 / max(crop.size)
        if grow > 1:
            crop = crop.resize((round(crop.width * grow), round(crop.height * grow)), Image.LANCZOS)
        angles = (90, 270) if crop.height > crop.width * 1.3 else (0, 180)
        for angle in angles:
            crop.rotate(angle, expand=True).save(out / f"{r['id']:02d}-{angle}.jpg", quality=92)
        made += 1
    (out / "boxes.json").write_text(json.dumps(boxes, indent=1), encoding="utf-8")
    print(f"{made} of {len(rows)} photos cropped from {source} boxes into {out}")


if __name__ == "__main__":
    main()
