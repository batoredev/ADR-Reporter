"""Downloads the Roboflow Universe dataset "major project" (college-hxirw/major-project-8anow, CC BY 4.0):
about 1,700 photos of medicine strips and packs with boxes around each one's name and date.

    .venv-ml/Scripts/python.exe ml/detector/download.py

Needs ROBOFLOW_API_KEY in the environment or in .env (a free Roboflow account's key). The key is never printed,
not even in an error. The archive is untrusted: it is unpacked into its own new folder, and any entry that would
land outside it is refused. Saved under ml/data (gitignored) with the licence and credit the dataset requires.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

#   Any other Universe project:  download.py --project <workspace>/<project> --out ml/data/<folder>
# Only openly licensed datasets are downloaded; the licence is read from Roboflow, not assumed.
import argparse as _argparse

_args = _argparse.ArgumentParser()
_args.add_argument("--project", default="college-hxirw/major-project-8anow")
_args.add_argument("--out", default="ml/data/roboflow-major-project")
_parsed = _args.parse_args()
WORKSPACE, PROJECT = _parsed.project.split("/", 1)
OUT = Path(_parsed.out)
OPEN_LICENCES = ("CC BY 4.0", "CC BY-SA 4.0", "PUBLIC DOMAIN", "MIT", "CC0", "CC0 1.0", "CC BY 2.0", "CC BY 3.0")


def api_key():
    key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not key and Path(".env").exists():
        for line in Path(".env").read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("ROBOFLOW_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("ROBOFLOW_API_KEY is not set. Add it to .env (never paste it into a chat).")
    return key


def get_json(url):
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        # The address carries the key: report only the status and the part before the query.
        sys.exit(f"Roboflow returned {e.code} for {url.split('?')[0]}" + (" (check the API key)" if e.code in (401, 403) else ""))
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach Roboflow: {e.reason}")


def main():
    key = api_key()
    if OUT.exists() and any(OUT.iterdir()):
        sys.exit(f"{OUT} already has files; remove it first to download again.")
    project = get_json(f"https://api.roboflow.com/{WORKSPACE}/{PROJECT}?api_key={key}")
    licence = str(project.get("project", {}).get("license") or "").strip()
    if licence.upper() not in OPEN_LICENCES:
        sys.exit(f"Not downloaded: the licence is '{licence or 'not stated'}', not an open licence.")
    name = project.get("project", {}).get("name") or PROJECT
    credit = (f"Dataset: \"{name}\" by {WORKSPACE} on Roboflow Universe\n"
              f"https://universe.roboflow.com/{WORKSPACE}/{PROJECT}\nLicence: {licence}\n")
    versions = sorted(int(v["id"].rsplit("/", 1)[1]) for v in project.get("versions", []))
    if not versions:
        sys.exit("The dataset has no downloadable version.")
    version = versions[-1]
    print(f"Version {version} of {project.get('project', {}).get('images', '?')} images; preparing the COCO export...")
    link = None
    for _ in range(60):  # Roboflow prepares the export on first request
        export = get_json(f"https://api.roboflow.com/{WORKSPACE}/{PROJECT}/{version}/coco?api_key={key}")
        link = export.get("export", {}).get("link")
        if link:
            break
        time.sleep(5)
    if not link:
        sys.exit("The export was not ready after five minutes; try again later.")
    OUT.mkdir(parents=True, exist_ok=True)
    archive = OUT / "download.zip"
    try:
        urllib.request.urlretrieve(link, archive)
    except urllib.error.URLError as e:
        sys.exit(f"The download failed: {getattr(e, 'reason', e)}")
    root = (OUT / "dataset").resolve()
    root.mkdir()
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            target = (root / member.filename).resolve()
            if not str(target).startswith(str(root)):
                sys.exit(f"Refused an archive entry outside the folder: {member.filename}")
        z.extractall(root)
    archive.unlink()
    (OUT / "ATTRIBUTION.txt").write_text(credit, encoding="utf-8")
    for split in ("train", "valid", "test"):
        ann = root / split / "_annotations.coco.json"
        if ann.exists():
            coco = json.loads(ann.read_text(encoding="utf-8"))
            names = [c["name"] for c in coco["categories"]]
            print(f"{split}: {len(coco['images'])} images, {len(coco['annotations'])} boxes, classes {names}")
    print(f"Saved to {OUT}")


if __name__ == "__main__":
    main()
