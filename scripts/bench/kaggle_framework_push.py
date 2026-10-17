"""Push the framework-gap kernel. Does not print the Kaggle token."""

import json
import os
import shutil
import sys
from pathlib import Path

SLUG = "ruflo-framework-gaps"
TITLE = "Ruflo framework gaps"


def redact(text):
    out = str(text)
    for name in ("KAGGLE_API_TOKEN", "GROQ_API_KEY"):
        secret = os.environ.get(name) or ""
        if secret:
            out = out.replace(secret, "[redacted]")
    return out


def main():
    from kaggle.api.kaggle_api_extended import KaggleApi

    root = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/ruflo-framework-gaps")
    infer = Path(sys.argv[2] if len(sys.argv) > 2 else "scripts/bench/kaggle_framework_gaps.py")
    client = KaggleApi()
    client.authenticate()
    username = client.config_values.get("username")
    if not username:
        raise SystemExit("Kaggle username was not returned")
    folder = root / "kernel"
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    shutil.copyfile(infer, folder / "infer.py")
    meta = {
        "id": f"{username}/{SLUG}",
        "title": TITLE,
        "code_file": "infer.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": "true",
        "enable_gpu": "true",
        "enable_tpu": "false",
        "enable_internet": "true",
        "machine_shape": "NvidiaTeslaT4",
        "dataset_sources": [],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    (folder / "kernel-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    result = client.kernels_push(str(folder), timeout="32400")
    error = getattr(result, "error", None)
    if error:
        raise SystemExit(redact(error))
    payload = {
        "username": username,
        "kernel": f"{username}/{SLUG}",
        "url": getattr(result, "url", "") or "",
        "version": getattr(result, "versionNumber", None),
        "machineShape": "NvidiaTeslaT4",
    }
    status = root / "status.json"
    status.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload), flush=True)


if __name__ == "__main__":
    main()
