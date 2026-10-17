"""Push the Ruflo task notebook to Kaggle and download its output.

The API token is read from the environment and is never printed.
"""

import argparse
import base64
import json
import os
import shutil
import time
from pathlib import Path

KERNEL_SLUG = "ruflo-agent-task-bench"
DATASET_SLUG = "ruflo-agent-tasks"
KERNEL_TITLE = "Ruflo agent task bench"
DATASET_TITLE = "Ruflo agent tasks"


def redact(text):
    out = str(text)
    for name in ("KAGGLE_API_TOKEN", "GROQ_API_KEY"):
        secret = os.environ.get(name) or ""
        if secret:
            out = out.replace(secret, "[redacted]")
    return out


def api():
    from kaggle.api.kaggle_api_extended import KaggleApi

    client = KaggleApi()
    client.authenticate()
    username = client.config_values.get("username")
    if not username:
        raise SystemExit("Kaggle username was not returned")
    return client, username


def write_status(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    current = {}
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current = {}
    current.update(payload)
    current["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    path.write_text(json.dumps(current, indent=2), encoding="utf-8")
    print(json.dumps(current)[:800], flush=True)


def dataset_folder(tasks_path, root):
    folder = Path(root) / "dataset"
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    shutil.copyfile(tasks_path, folder / "tasks.jsonl")
    return folder


def ensure_dataset(client, username, tasks_path, root):
    folder = dataset_folder(tasks_path, root)
    ref = f"{username}/{DATASET_SLUG}"
    meta = {
        "title": DATASET_TITLE,
        "id": ref,
        "licenses": [{"name": "CC0-1.0"}],
    }
    (folder / "dataset-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    exists = True
    try:
        client.dataset_status(ref)
    except Exception:
        exists = False
    if exists:
        result = client.dataset_create_version(
            str(folder),
            "task prompts",
            quiet=True,
            convert_to_csv=False,
            delete_old_versions=True,
        )
    else:
        result = client.dataset_create_new(str(folder), public=False, quiet=True, convert_to_csv=False)
    error = getattr(result, "error", None)
    if error:
        raise SystemExit(redact(error))
    return ref


def kernel_folder(root, username, infer_path, tasks_path=None):
    folder = Path(root) / "kernel"
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    source = Path(infer_path).read_text(encoding="utf-8")
    if tasks_path:
        raw = Path(tasks_path).read_bytes()
        slot = "EMBEDDED_TASKS_B64 = None"
        if slot not in source:
            raise SystemExit("infer script is missing the task embed slot")
        encoded = base64.b64encode(raw).decode("ascii")
        source = source.replace(slot, 'EMBEDDED_TASKS_B64 = "' + encoded + '"', 1)
    (folder / "infer.py").write_text(source, encoding="utf-8")
    meta = {
        "id": f"{username}/{KERNEL_SLUG}",
        "title": KERNEL_TITLE,
        "code_file": "infer.py",
        "language": "python",
        "kernel_type": "script",
        "is_private": "true",
        "enable_gpu": "true",
        "enable_tpu": "false",
        "enable_internet": "true",
        "machine_shape": "NvidiaTeslaT4",
        "dataset_sources": [f"{username}/{DATASET_SLUG}"],
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }
    (folder / "kernel-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return folder


def push_kernel(client, folder):
    result = client.kernels_push(str(folder), timeout="32400")
    error = getattr(result, "error", None)
    if error:
        raise SystemExit(redact(error))
    return {
        "url": getattr(result, "url", "") or "",
        "version": getattr(result, "versionNumber", None),
    }


def command_push(args):
    client, username = api()
    status_path = Path(args.status)
    write_status(status_path, {"phase": "upload", "username": username})
    dataset = ensure_dataset(client, username, args.tasks, args.root)
    folder = kernel_folder(args.root, username, args.infer, args.tasks)
    pushed = push_kernel(client, folder)
    ref = f"{username}/{KERNEL_SLUG}"
    write_status(status_path, {
        "phase": "pushed",
        "username": username,
        "dataset": dataset,
        "kernel": ref,
        "url": pushed["url"],
        "version": pushed["version"],
        "machineShape": "NvidiaTeslaT4",
    })


def command_wait(args):
    client, username = api()
    status_path = Path(args.status)
    payload = json.loads(status_path.read_text(encoding="utf-8"))
    ref = payload.get("kernel") or f"{username}/{KERNEL_SLUG}"
    deadline = time.time() + int(args.timeout)
    last = ""
    while time.time() < deadline:
        response = client.kernels_status(ref)
        state = str(getattr(response, "status", response))
        failure = getattr(response, "failure_message", None) or ""
        if state != last:
            write_status(status_path, {"phase": "kernel", "kernelStatus": state, "failure": redact(failure)[:500]})
            last = state
        folded = state.lower()
        if folded.endswith(("complete", "error", "failed", "cancelled", "canceled")) or "cancel" in folded:
            out_dir = Path(args.out_dir)
            out_dir.mkdir(parents=True, exist_ok=True)
            try:
                client.kernels_output(ref, str(out_dir), force=True, quiet=True)
            except Exception as err:
                write_status(status_path, {"phase": "output-error", "error": redact(err)[:500]})
            try:
                logs = client.kernels_logs(ref)
                (out_dir / "kernel.log").write_text(redact(logs)[-200000:], encoding="utf-8")
            except Exception as err:
                (out_dir / "kernel.log").write_text(redact(err)[:1000], encoding="utf-8")
            write_status(status_path, {"phase": "finished", "kernelStatus": state})
            return
        time.sleep(int(args.poll))
    write_status(status_path, {"phase": "timeout", "kernel": ref})
    raise SystemExit("kernel wait timed out")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["push", "wait"])
    parser.add_argument("--tasks")
    parser.add_argument("--infer", default="scripts/bench/kaggle_infer.py")
    parser.add_argument("--root", default="/tmp/ruflo-kaggle")
    parser.add_argument("--status", default="docs/bench/kaggle-status.json")
    parser.add_argument("--out-dir", default="/tmp/ruflo-kaggle/output")
    parser.add_argument("--timeout", default="43200")
    parser.add_argument("--poll", default="45")
    args = parser.parse_args()
    try:
        if args.command == "push":
            command_push(args)
        else:
            command_wait(args)
    except SystemExit:
        raise
    except Exception as err:
        write_status(args.status, {"phase": "error", "error": redact(err)[:800]})
        raise SystemExit(redact(err))


if __name__ == "__main__":
    main()
