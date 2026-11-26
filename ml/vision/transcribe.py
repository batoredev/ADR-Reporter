"""Runs the local vision model over rendered photos and scores its transcripts against the exact text.

    .venv-ml/Scripts/python.exe ml/vision/transcribe.py --data ml/data/vision [--model qwen3-vl:2b-instruct] [--limit 100]

Writes <data>/read-<model>.jsonl (one row per photo: what was read, character error rate, and which of the
answer's values survived) and prints a summary by style. The rows are also training material for the
structuring step: the vision model's real slips paired with the correct answer.
Uses exactly the app's transcription prompt and settings (src/server/ai/two-step.ts).
"""

import argparse
import base64
import json
import re
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

PROMPT = re.search(r"TRANSCRIBE_PROMPT\s*=\s*`([^`]*)`", Path("src/server/ai/two-step.ts").read_text(encoding="utf-8")).group(1)


def clean(raw):
    """The app's cleanTranscript: English lines, each repeated line once, URTl -> URTI."""
    seen, out = set(), []
    for line in raw.splitlines():
        t = line.strip()
        if not t:
            continue
        letters = re.sub(r"[\W\d_]", "", t)
        if letters and len(re.sub(r"[A-Za-z]", "", letters)) / len(letters) > 0.3:
            continue
        key = re.sub(r"\s+", " ", t.lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(re.sub(r"\b([A-Z]{2,})l\b", r"\1I", t))
    return "\n".join(out)[:6000]


def distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def values(target):
    """The answer's text values a reader must get right (batch, dates, doses, names...)."""
    out = []
    for k, v in target.items():
        if k in ("documentType", "ageUnit", "gender") or v in (None, []):
            continue
        if isinstance(v, list):
            for item in v:
                out += [x for x in item.values() if isinstance(x, str)]
        elif isinstance(v, str):
            out += [x for x in v.split("; ") if x]
    return out


def squash(s):
    return re.sub(r"\s+", " ", s.lower()).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="ml/data/vision")
    parser.add_argument("--model", default="qwen3-vl:2b-instruct")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--url", default="http://localhost:11434/api/chat")
    args = parser.parse_args()
    data = Path(args.data)
    rows = [json.loads(l) for l in (data / "labels.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    rows = rows[: args.limit] if args.limit else rows
    out_path = data / f"read-{args.model.replace(':', '_').replace('/', '_')}.jsonl"
    done = {json.loads(l)["image"] for l in out_path.read_text(encoding="utf-8").splitlines()} if out_path.exists() else set()
    with open(out_path, "a", encoding="utf-8") as out:
        for row in rows:
            if row["image"] in done:
                continue
            image = base64.b64encode((data / row["image"]).read_bytes()).decode()
            body = {"model": args.model, "stream": False, "think": False,
                    "options": {"temperature": 0, "repeat_penalty": 1.15, "num_predict": 900, "num_ctx": 8192},
                    "messages": [{"role": "user", "content": PROMPT, "images": [image]}]}
            started = time.time()
            req = urllib.request.Request(args.url, json.dumps(body).encode(), {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=600) as r:
                read = clean(json.loads(r.read())["message"]["content"])
            truth = row["transcript"]
            wanted = values(row["target"])
            kept = [v for v in wanted if squash(v) in squash(read)]
            result = {"image": row["image"], "style": row["style"], "kind": row["kind"], "seconds": round(time.time() - started, 1),
                      "cer": round(distance(squash(truth), squash(read)) / max(1, len(squash(truth))), 4),
                      "field_recall": round(len(kept) / max(1, len(wanted)), 4),
                      "missed": [v for v in wanted if v not in kept][:12],
                      "read": read, "transcript": truth, "target": row["target"]}
            out.write(json.dumps(result, ensure_ascii=False) + "\n")
            out.flush()
            print(f"{row['image']} {row['style']:<11} cer {result['cer']:.3f} fields {result['field_recall']:.2f} {result['seconds']}s", flush=True)
    summary = defaultdict(list)
    for line in out_path.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        summary[r["style"]].append(r)
        summary["all"].append(r)
    for style, rs in summary.items():
        n = len(rs)
        print(f"{style:<12} n={n:<4} character error {sum(r['cer'] for r in rs) / n:.3f}  "
              f"values kept {sum(r['field_recall'] for r in rs) / n:.3f}  {sum(r['seconds'] for r in rs) / n:.0f}s each")


if __name__ == "__main__":
    main()
