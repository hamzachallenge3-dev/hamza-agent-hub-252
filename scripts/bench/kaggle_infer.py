"""Run Ruflo task prompts on the strongest Qwen coder that fits.

This file is the Kaggle kernel. It reads tasks.jsonl from the mounted
dataset, writes one completion per line, and records the model that loaded.
It does not grade. Grading stays in checks.mjs.
"""

import base64
import gc
import json
import os
import shutil
import time
import traceback
from pathlib import Path

OUT = Path("/kaggle/working")
STATUS = OUT / "status.json"
MODEL_PATH = OUT / "model.json"
COMPLETIONS = OUT / "completions.jsonl"
EMBEDDED_TASKS_B64 = None


def redact(text):
    out = str(text)
    for name in ("KAGGLE_API_TOKEN", "GROQ_API_KEY"):
        secret = os.environ.get(name) or ""
        if secret:
            out = out.replace(secret, "[redacted]")
    return out


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def status(**payload):
    payload["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    write_json(STATUS, payload)
    print(json.dumps(payload)[:500], flush=True)


def gpu_info():
    try:
        import torch
    except Exception as err:
        return {"count": 0, "names": [], "error": redact(err)}
    if not torch.cuda.is_available():
        return {"count": 0, "names": [], "error": "cuda unavailable"}
    names = []
    memories = []
    for index in range(torch.cuda.device_count()):
        names.append(torch.cuda.get_device_name(index))
        memories.append(torch.cuda.get_device_properties(index).total_memory)
    return {"count": len(names), "names": names, "memories": memories}


def largest_cache_dir():
    best = "/tmp"
    best_free = -1
    for path in ("/kaggle/working", "/tmp", "/"):
        if not os.path.isdir(path):
            continue
        free = shutil.disk_usage(path).free
        if free > best_free:
            best = path
            best_free = free
    cache = os.path.join(best, "hf-cache")
    os.makedirs(cache, exist_ok=True)
    os.environ["HF_HOME"] = cache
    os.environ["HUGGINGFACE_HUB_CACHE"] = cache
    return {"dir": cache, "free": best_free}


def find_tasks():
    if EMBEDDED_TASKS_B64:
        path = Path("/tmp/tasks.jsonl")
        path.write_bytes(base64.b64decode(EMBEDDED_TASKS_B64))
        return path
    deadline = time.time() + 600
    while time.time() < deadline:
        matches = list(Path("/kaggle/input").rglob("tasks.jsonl"))
        if matches:
            return matches[0]
        status(phase="wait-input")
        time.sleep(10)
    raise SystemExit("tasks.jsonl was not mounted")


def free_cuda():
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def load_one(repo):
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(repo, trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(
        repo,
        device_map="auto",
        torch_dtype="auto",
        low_cpu_mem_usage=True,
        trust_remote_code=False,
    )
    model.eval()
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    return tokenizer, model


def candidate_repos(gpus, free_bytes):
    repos = []
    if gpus >= 2 and free_bytes >= 22 * 1024 ** 3:
        repos.extend([
            "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
            "Qwen/Qwen2.5-Coder-32B-Instruct-GPTQ-Int4",
            "unsloth/Qwen2.5-Coder-32B-Instruct-bnb-4bit",
        ])
    elif gpus >= 1 and free_bytes >= 22 * 1024 ** 3:
        repos.append("Qwen/Qwen2.5-Coder-32B-Instruct-AWQ")
    if gpus >= 1 and free_bytes >= 12 * 1024 ** 3:
        repos.append("Qwen/Qwen2.5-Coder-14B-Instruct-AWQ")
    if gpus >= 1 and free_bytes >= 8 * 1024 ** 3:
        repos.append("Qwen/Qwen2.5-Coder-7B-Instruct")
    seen = set()
    ordered = []
    for repo in repos:
        if repo not in seen:
            seen.add(repo)
            ordered.append(repo)
    return ordered


def pip_install(packages):
    import subprocess
    import sys
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-q", *packages],
        capture_output=True,
        text=True,
    )
    status(phase="install-quant", packages=packages, code=result.returncode, error=redact((result.stderr or result.stdout or "")[-300:]))


def plain_repos(gpus):
    repos = []
    if gpus >= 2:
        repos.append("Qwen/Qwen2.5-Coder-14B-Instruct")
    if gpus >= 1:
        repos.append("Qwen/Qwen2.5-Coder-7B-Instruct")
    return repos


def load_strongest(gpus, free_bytes):
    errors = []
    # Stock weights first. The quant install upgrades protobuf and then
    # transformers can no longer import AutoModelForCausalLM.
    for repo in plain_repos(gpus):
        status(phase="load", repo=repo)
        try:
            tokenizer, model = load_one(repo)
            return repo, tokenizer, model, errors
        except Exception as err:
            errors.append({"repo": repo, "error": redact(traceback.format_exc())[-800:]})
            status(phase="load-failed", repo=repo, error=redact(err)[:300])
            free_cuda()
    repos = candidate_repos(gpus, free_bytes)
    if any("AWQ" in repo or "GPTQ" in repo for repo in repos):
        status(phase="install-quant")
        pip_install([
            "autoawq==0.2.8",
            "bitsandbytes",
            "protobuf>=5.26.1,<6",
            "transformers==4.46.3",
        ])
    for repo in repos:
        status(phase="load", repo=repo)
        try:
            tokenizer, model = load_one(repo)
            return repo, tokenizer, model, errors
        except Exception as err:
            errors.append({"repo": repo, "error": redact(traceback.format_exc())[-800:]})
            status(phase="load-failed", repo=repo, error=redact(err)[:300])
            free_cuda()
    return None, None, None, errors


def generate(tokenizer, model, task):
    import torch

    messages = []
    if task.get("system"):
        messages.append({"role": "system", "content": task["system"]})
    messages.append({"role": "user", "content": task["user"]})
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt")
    device = torch.device("cuda:0")
    inputs = {key: value.to(device) for key, value in inputs.items()}
    max_tokens = int(task.get("maxTokens") or 80)
    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            do_sample=False,
            pad_token_id=tokenizer.pad_token_id,
        )
    new_tokens = output[0, inputs["input_ids"].shape[1]:]
    return tokenizer.decode(new_tokens, skip_special_tokens=True)


def done_ids():
    found = set()
    if not COMPLETIONS.exists():
        return found
    for line in COMPLETIONS.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            found.add(json.loads(line)["id"])
        except Exception:
            continue
    return found


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    gpus = gpu_info()
    cache = largest_cache_dir()
    status(phase="start", gpus=gpus, cache=cache)
    if gpus["count"] < 1:
        write_json(MODEL_PATH, {"loaded": None, "gpus": gpus, "error": "no GPU"})
        raise SystemExit("no GPU")
    tasks_path = find_tasks()
    tasks = [json.loads(line) for line in tasks_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    repo, tokenizer, model, errors = load_strongest(gpus["count"], cache["free"])
    write_json(MODEL_PATH, {
        "loaded": repo,
        "gpus": gpus,
        "cache": cache,
        "errors": errors,
        "taskCount": len(tasks),
    })
    if repo is None:
        raise SystemExit("no model fit")
    finished = done_ids()
    with COMPLETIONS.open("a", encoding="utf-8") as handle:
        for index, task in enumerate(tasks):
            if task["id"] in finished:
                continue
            started = time.time()
            try:
                content = generate(tokenizer, model, task)
                row = {
                    "id": task["id"],
                    "content": content,
                    "model": repo,
                    "ms": int((time.time() - started) * 1000),
                }
            except Exception as err:
                row = {
                    "id": task["id"],
                    "content": "",
                    "model": repo,
                    "error": redact(err)[:400],
                    "ms": int((time.time() - started) * 1000),
                }
                free_cuda()
            handle.write(json.dumps(row) + "\n")
            handle.flush()
            if index % 10 == 0:
                status(phase="run", model=repo, done=index + 1, total=len(tasks))
    status(phase="done", model=repo, total=len(tasks))


if __name__ == "__main__":
    main()
