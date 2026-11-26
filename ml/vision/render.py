"""Synthetic phone photos of clinical documents and medicine packs, with their exact text.

Each image is drawn from a document made by ml/structurer/make_data.py, so its true transcript and the
structured answer are both known exactly: a handwritten or printed prescription, an ADR note, a lab report,
a discharge summary, a bill, or a pack panel with stamped batch and dates. The page is then made to look
like a phone photo (tilt, perspective, blur, shadow, sensor noise, JPEG), so the reader can be tested and
taught on thousands of documents no one has to photograph or label. Everything is fictional.

    .venv-ml/Scripts/python.exe ml/vision/render.py --count 300 --out ml/data/vision

Fonts: Windows system fonts for print; handwriting fonts from Google Fonts (SIL Open Font License) in
ml/artifacts/fonts. The fonts are used to draw images only and are not redistributed.
"""

import argparse
import functools
import json
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "structurer"))
import make_data  # noqa: E402

WINDOWS = Path("C:/Windows/Fonts")
OWN = Path("ml/artifacts/fonts")
PRINT = ["arial.ttf", "calibri.ttf", "times.ttf", "verdana.ttf", "tahoma.ttf", "segoeui.ttf", "cambria.ttc", "georgia.ttf"]
BOLD = ["arialbd.ttf", "calibrib.ttf", "timesbd.ttf", "verdanab.ttf", "tahomabd.ttf", "segoeuib.ttf", "georgiab.ttf"]
STAMP = ["consola.ttf", "lucon.ttf", "cour.ttf", "ARIALN.TTF"]
HAND = [OWN / f for f in ["Kalam-Regular.ttf", "Kalam-Light.ttf", "PatrickHand-Regular.ttf", "IndieFlower-Regular.ttf",
                          "GochiHand-Regular.ttf", "ReenieBeanie.ttf", "ShadowsIntoLight.ttf", "NothingYouCouldDo.ttf"]]
HAND += [WINDOWS / f for f in ["Inkfree.ttf", "segoepr.ttf", "segoesc.ttf"]]
INK = [(20, 30, 120), (15, 15, 25), (30, 40, 90), (60, 20, 20)]
CLINICAL = {"prescription", "complaint_prescription", "clinical_note", "us_script"}
HARD = False  # --hard: hurried handwriting and poor phone photos, as hard as the reporters' real ones


@functools.lru_cache(maxsize=512)
def font(path, size):
    return ImageFont.truetype(str(path if isinstance(path, Path) else WINDOWS / path), size)


def fit(lines, path, width, start, smallest=14):
    """The largest size up to `start` at which every line fits the width."""
    size = start
    while size > smallest:
        f = font(path, size)
        if max(f.getlength(l) for l in lines) <= width:
            return f
        size -= 2
    return font(path, smallest)


def paper(r, w, h, kind):
    tone = r.choice([(252, 251, 247), (248, 244, 232), (255, 255, 255), (240, 238, 230)])
    fibre = np.random.default_rng(r.randint(0, 1 << 30)).normal(0, 3, (h, w, 1))
    img = Image.fromarray(np.clip(np.array(tone, np.float32) + fibre, 0, 255).astype(np.uint8))
    if r.random() < 0.4:  # a fold across the page
        fold = ImageDraw.Draw(img)
        at = r.randint(h // 3, 2 * h // 3)
        fold.line([(0, at), (w, at + r.randint(-20, 20))], fill=tuple(c - 18 for c in tone), width=2)
    d = ImageDraw.Draw(img)
    if kind in CLINICAL and r.random() < 0.35:  # ruled pad
        for y in range(int(h * 0.22), h, r.randint(34, 44)):
            d.line([(30, y), (w - 30, y)], fill=(200, 210, 230), width=1)
    return img


def hurried(r, img, x, y, text, path, size, colour):
    d = ImageDraw.Draw(img)
    slope, phase, amp = r.uniform(-0.05, 0.05), r.uniform(0, 6.3), size * r.uniform(0.03, 0.1)
    squeeze = r.uniform(0.72, 0.95)
    cx = x
    for i, ch in enumerate(text):
        s = max(10, int(size * r.uniform(0.82, 1.15)))
        f = font(path, s)
        dy = slope * (cx - x) + amp * math.sin(phase + i * 0.45) + r.uniform(-0.07, 0.07) * size + (size - s)
        d.text((cx, y + dy), ch, font=f, fill=colour)
        cx += f.getlength(ch) * (squeeze if ch != " " else r.uniform(0.6, 1.3))


def draw_lines(r, img, lines, hand, ink, top, header=0):
    """Writes lines top to bottom; the first `header` lines are a printed letterhead."""
    d = ImageDraw.Draw(img)
    w, h = img.size
    margin = r.randint(40, 70)
    y = top
    head_font = fit(lines[:header] or ["x"], r.choice(BOLD), w - 2 * margin, 34)
    body_path = r.choice(HAND) if hand else r.choice(PRINT)
    body = fit(lines[header:] or ["x"], body_path, w - 2 * margin - 30, r.randint(28, 40) if hand else r.randint(22, 30))
    for i, line in enumerate(lines):
        f = head_font if i < header else body
        x = margin + (r.randint(-6, 24) if hand and i >= header else 0)
        colour = (20, 20, 20) if i < header else ink
        if hand and i >= header and HARD:
            hurried(r, img, x, y, line, body_path, f.size, colour)
        elif hand and i >= header and r.random() < 0.5:  # a slightly sloped handwritten line
            layer = Image.new("RGBA", (int(f.getlength(line)) + 20, f.size * 2), (0, 0, 0, 0))
            ImageDraw.Draw(layer).text((5, 5), line, font=f, fill=colour + (255,))
            layer = layer.rotate(r.uniform(-1.5, 1.5), expand=True, resample=Image.BICUBIC)
            img.paste(layer, (x, int(y - (layer.height - f.size * 2) / 2)), layer)
        else:
            d.text((x, y), line, font=f, fill=colour)
        y += f.size * (r.uniform(1.5, 1.85) if hand else r.uniform(1.2, 1.45))
        if i == header - 1:
            d.line([(margin, y + 2), (w - margin, y + 2)], fill=(90, 90, 90), width=2)
            y += 12
        if y > h - 40:
            return None
    return int(y)


def pack_panel(r, lines):
    """A box or strip face: a coloured panel, the brand large, batch and dates stamped."""
    w, h = r.choice([(900, 1100), (1000, 900), (1100, 800)])
    base = r.choice([(250, 250, 250), (235, 244, 252), (252, 240, 235), (240, 250, 240), (255, 248, 225)])
    img = Image.new("RGB", (w, h), base)
    d = ImageDraw.Draw(img)
    band = r.choice([(200, 30, 40), (20, 80, 160), (0, 120, 90), (120, 40, 140), (230, 120, 0)])
    if r.random() < 0.7:
        d.rectangle([0, 0, w, r.randint(30, 90)], fill=band)
    y, margin = r.randint(100, 140), 50
    text_font = fit(lines, r.choice(PRINT), w - 2 * margin, r.randint(30, 40))
    stamp = font(r.choice(STAMP), text_font.size + 2)
    brand_done = False
    for line in lines:
        stamped = line.startswith(("Batch", "Mfg. Date", "Expiry", "M.R.P.", "MFG", "EXP")) or line[:2].isdigit()
        if not brand_done and len(line) < 24 and not stamped and line[:1].isupper():
            f, colour, brand_done = fit([line], r.choice(BOLD), w - 2 * margin, 64), band, True
        else:
            f, colour = (stamp, (30, 30, 30)) if stamped else (text_font, (40, 40, 40))
        if stamped and HARD and r.random() < 0.6:  # inkjet dot-matrix print of batch and dates
            layer = Image.new("L", (w, int(f.size * 1.6)), 0)
            ImageDraw.Draw(layer).text((margin, 2), line, font=f, fill=255)
            dots = np.zeros((layer.height, w), np.uint8)
            dots[::3, ::3] = 255
            mask = Image.fromarray(np.minimum(np.asarray(layer), dots)).filter(ImageFilter.MaxFilter(3))
            img.paste(Image.new("RGB", (w, layer.height), colour), (0, int(y)), mask)
        else:
            d.text((margin, y), line, font=f, fill=colour)
        y += f.size * 1.3
        if y > h - 30:
            return None
    img = img.crop((0, 0, w, min(h, int(y) + r.randint(30, 120))))
    if HARD and r.random() < 0.5:  # a curved strip or a bulging box face
        a = np.asarray(img)
        ph, pw = a.shape[:2]
        shift = (r.uniform(8, 25) * np.sin(np.pi * np.arange(pw) / pw)).astype(int)
        rows = (np.arange(ph)[:, None] - shift[None, :]).clip(0, ph - 1)
        img = Image.fromarray(a[rows, np.arange(pw)[None, :]])
    return img


def photograph(r, page):
    """Makes a flat page look like a phone photo of it."""
    w, h = page.size
    scene = Image.new("RGB", (int(w * r.uniform(1.06, 1.18)), int(h * r.uniform(1.06, 1.18))), r.choice([(90, 70, 50), (150, 140, 130), (60, 60, 65), (200, 195, 185)]))
    angle = r.uniform(-7, 7)
    rotated = page.convert("RGBA").rotate(angle, expand=True, resample=Image.BICUBIC)
    scene.paste(rotated, ((scene.width - rotated.width) // 2, (scene.height - rotated.height) // 2), rotated)
    # Perspective: the phone is not held exactly parallel to the page.
    sw, sh = scene.size
    jitter = lambda: r.uniform(-0.05, 0.05)
    quad = [sw * jitter(), sh * jitter(), sw * jitter(), sh * (1 + jitter()), sw * (1 + jitter()), sh * (1 + jitter()),
            sw * (1 + jitter()), sh * jitter()]
    scene = scene.transform((sw, sh), Image.QUAD, quad, resample=Image.BICUBIC)
    pixels = np.asarray(scene).astype(np.float32)
    # Uneven light and a soft shadow across part of the page.
    yy, xx = np.mgrid[0:sh, 0:sw]
    cx, cy = r.uniform(0, sw), r.uniform(0, sh)
    light = 1 - r.uniform(0.0, 0.35) * np.hypot(xx - cx, yy - cy) / math.hypot(sw, sh)
    if r.random() < 0.4:
        edge = r.uniform(0.2, 0.8) * sw
        across = (xx + (yy - sh / 2) * r.uniform(-0.5, 0.5) - edge) / (0.08 * sw)
        depth = r.uniform(0.15, 0.4)
        light *= 1 - depth / (1 + np.exp(across))
    pixels *= light[..., None]
    if HARD and r.random() < 0.5:  # glare from a light above the page
        gx, gy, gr = r.uniform(0, sw), r.uniform(0, sh), r.uniform(0.08, 0.2) * sw
        pixels += r.uniform(60, 140) * np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * gr**2))[..., None]
    pixels += np.random.default_rng(r.randint(0, 1 << 30)).normal(0, r.uniform(2, 9), pixels.shape)
    img = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
    if r.random() < (0.9 if HARD else 0.7):
        img = img.filter(ImageFilter.GaussianBlur(r.uniform(0.8, 2.0) if HARD else r.uniform(0.3, 1.4)))
    if HARD and r.random() < 0.35:  # a shaky hand
        k = [0.0] * 25
        for i in range(r.choice([10, 12, 14])):
            k[i] = 1.0
        img = img.filter(ImageFilter.Kernel((5, 5), k[:25], scale=sum(k)))
    scale = r.uniform(0.32, 0.55) if HARD else r.uniform(0.55, 0.9)  # phone photos sent over chat are resized
    img = img.resize((int(sw * scale), int(sh * scale)), Image.LANCZOS)
    return img


def render(r, row):
    lines = row["transcript"].split("\n")
    kind = row["kind"]
    if kind == "pack":
        page = pack_panel(r, lines)
        style = "pack"
    else:
        w, h = 1000, 1400
        page = paper(r, w, h, kind)
        hand = kind in CLINICAL and kind != "us_script" and r.random() < 0.7
        header = 0
        if hand:  # the clinic's printed letterhead, then the doctor's handwriting
            header = sum(1 for l in lines[:2] if l.startswith(("Dr.", "Reg.", "Ph:", "Timings", "MBBS", "M.D", "MS ", "DCH", "PHC",
                                                               "Consultant", "Community")) or l.endswith("Clinic"))
        ink = r.choice(INK) if hand else (25, 25, 25)
        end = draw_lines(r, page, lines, hand, ink, r.randint(50, 110), header)
        if end is None:
            return None, None
        page = page.crop((0, 0, w, min(h, end + r.randint(60, 260))))
        style = "handwritten" if hand else "printed"
    if page is None:
        return None, None
    return photograph(r, page), style


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--out", default="ml/data/vision")
    parser.add_argument("--seed", type=int, default=11)
    parser.add_argument("--hard", action="store_true", help="hurried handwriting and poor phone photos")
    args = parser.parse_args()
    global HARD
    HARD = args.hard
    out = Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    r = random.Random(args.seed)
    rows, n = [], 0
    while n < args.count:
        row = make_data.example(r)
        image, style = render(r, row)
        if image is None:
            continue
        name = f"images/{n:05d}.jpg"
        image.save(out / name, quality=r.randint(20, 45) if HARD else r.randint(40, 85))
        rows.append({"image": name, "style": style, **row})
        n += 1
    with open(out / "labels.jsonl", "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"Rendered {n} photos with their exact text to {out}")


if __name__ == "__main__":
    main()
