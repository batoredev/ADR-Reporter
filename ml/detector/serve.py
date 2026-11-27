"""The pack-date helper: finds the batch/date block on a medicine pack photo and returns it cut out, enlarged and
turned both ways, so the reader can read it close up. Runs next to Ollama (the same machine and GPU).

    .venv-ml/Scripts/python.exe ml/detector/serve.py --model ml/runs/detector/<run>/model.pt [--port 11500]

    GET  /health      -> {"ok": true}
    POST /date-crops  (body: the photo, JPEG or PNG) -> {"found": bool, "score": float, "crops": [{"angle", "jpeg"}]}

Listens on 127.0.0.1 only unless --host says otherwise; set PACK_DETECTOR_URL=http://127.0.0.1:11500 for the app.
A photo over 15 MB is refused, and Pillow's limit on image size guards against decompression bombs.
"""

import argparse
import base64
import io
import json
import threading
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch
from PIL import Image, UnidentifiedImageError
from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_fpn
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.transforms.functional import to_tensor

MAX_BYTES = 15 * 1024 * 1024
# A phone photo is about 12 million pixels. A small, highly compressible file can claim far more and fill memory
# when decoded, so the size is checked from the header before decoding, and Pillow's own warning is made an error.
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)
DECODES = threading.BoundedSemaphore(2)  # at most two photos decoded at once
DATE = 2  # class index: background, name, date


class Finder:
    def __init__(self, model_path, threshold):
        result = json.loads((Path(model_path).parent / "result.json").read_text(encoding="utf-8"))
        self.side = result["max_side"]
        self.threshold = threshold
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        model = fasterrcnn_mobilenet_v3_large_fpn(weights=None, weights_backbone=None, min_size=round(self.side * 0.64),
                                                  max_size=self.side)
        model.roi_heads.box_predictor = FastRCNNPredictor(model.roi_heads.box_predictor.cls_score.in_features, 3)
        model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=True))
        self.model = model.eval().to(self.device)
        self.lock = threading.Lock()  # one GPU, one photo at a time

    @torch.no_grad()
    def date_crops(self, photo):
        with DECODES:
            return self._date_crops(photo)

    def _date_crops(self, photo):
        img = Image.open(io.BytesIO(photo))  # reads only the header
        if img.width * img.height > MAX_PIXELS:
            raise ValueError("photo too large")
        img.load()
        img = img.convert("RGB")
        scale = min(1.0, self.side / max(img.size))
        small = img.resize((round(img.width * scale), round(img.height * scale)))
        with self.lock:
            out = self.model([to_tensor(small).to(self.device)])[0]
        found = [(s.item(), b.tolist()) for b, l, s in zip(out["boxes"], out["labels"], out["scores"])
                 if l.item() == DATE and s.item() >= self.threshold]
        if not found:
            return {"found": False, "score": 0.0, "crops": []}
        score, (x1, y1, x2, y2) = max(found)
        x1, y1, x2, y2 = x1 / scale, y1 / scale, x2 / scale, y2 / scale
        mx, my = (x2 - x1) * 0.1, (y2 - y1) * 0.1
        crop = img.crop((max(0, x1 - mx), max(0, y1 - my), min(img.width, x2 + mx), min(img.height, y2 + my)))
        grow = 1400 / max(crop.size)
        if grow > 1:
            crop = crop.resize((round(crop.width * grow), round(crop.height * grow)), Image.LANCZOS)
        angles = (90, 270) if crop.height > crop.width * 1.3 else (0, 180)
        crops = []
        for angle in angles:
            buffer = io.BytesIO()
            crop.rotate(angle, expand=True).save(buffer, "JPEG", quality=92)
            crops.append({"angle": angle, "jpeg": base64.b64encode(buffer.getvalue()).decode()})
        return {"found": True, "score": round(score, 3), "crops": crops}


def handler_for(finder):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self.reply(200, {"ok": True})
            else:
                self.reply(404, {"error": "Not found."})

        def do_POST(self):
            if self.path != "/date-crops":
                return self.reply(404, {"error": "Not found."})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BYTES:
                return self.reply(413 if length > MAX_BYTES else 400, {"error": "Send one photo of at most 15 MB."})
            try:
                self.reply(200, finder.date_crops(self.rfile.read(length)))
            except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning, OSError, ValueError):
                self.reply(400, {"error": "The photo could not be opened."})

        def log_message(self, *args):  # no request logging: photos may show patient details
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11500)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()
    finder = Finder(args.model, args.threshold)
    server = ThreadingHTTPServer((args.host, args.port), handler_for(finder))
    print(f"Pack-date helper on http://{args.host}:{args.port} ({finder.device})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
