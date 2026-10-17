"""Grade the missing framework calls on the same Qwen kernel setup.

Loads stock Qwen/Qwen2.5-Coder-14B-Instruct on two T4s, the same order as
kaggle_infer.py, then asks OpenHands and AutoGen through a local
OpenAI-compatible server. This file does not grade and does not call Groq.
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OUT = Path("/kaggle/working")
STATUS = OUT / "status.json"
MODEL_PATH = OUT / "model.json"
GAPS = OUT / "gaps.json"
FW_OH = Path("/tmp/fw-oh")
FW_AG = Path("/tmp/fw-ag")
PORT = 8000

FILE_PROMPT = (
    "Write the handoff file as json for coder. Reply with only this exact json and nothing else:\n"
    '{"errorName":"nan","functionName":"isEven","guard":"Number.isFinite","agent":"coder"}'
)
CODE_PROMPT = (
    "isEven(n) returns true for a finite even number, false for a finite odd number, "
    'and throws Error("nan") when n is not finite. 0 and negative evens are even.\n'
    "Return only an ES module that exports function isEven.\n"
    "No markdown and no second function."
)

CALLS = [
    {"framework": "OpenHands", "task": "coder#3", "type": "file", "prompt": FILE_PROMPT, "maxTokens": 320},
    {"framework": "AutoGen", "task": "coder#2", "type": "code", "prompt": CODE_PROMPT, "maxTokens": 640},
    {"framework": "AutoGen", "task": "coder#3", "type": "file", "prompt": FILE_PROMPT, "maxTokens": 320},
]


def redact(text):
    out = str(text)
    for name in ("KAGGLE_API_TOKEN", "GROQ_API_KEY", "OPENAI_API_KEY"):
        secret = os.environ.get(name) or ""
        if secret and secret != "local":
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


def plain_repos(gpus):
    repos = []
    if gpus >= 2:
        repos.append("Qwen/Qwen2.5-Coder-14B-Instruct")
    if gpus >= 1:
        repos.append("Qwen/Qwen2.5-Coder-7B-Instruct")
    return repos


def load_stock(gpus):
    errors = []
    for repo in plain_repos(gpus):
        status(phase="load", repo=repo)
        try:
            tokenizer, model = load_one(repo)
            return repo, tokenizer, model, errors
        except Exception as err:
            errors.append({"repo": repo, "error": redact(traceback.format_exc())[-800:]})
            status(phase="load-failed", repo=repo, error=redact(err)[:300])
    return None, None, None, errors


def flatten(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
        return "\n".join(part for part in parts if part)
    return str(content or "")


class Generator:
    def __init__(self, tokenizer, model):
        self.tokenizer = tokenizer
        self.model = model
        self.lock = threading.Lock()

    def complete(self, messages, max_tokens):
        import torch

        chat = []
        for message in messages:
            role = message.get("role") or "user"
            if role not in ("system", "user", "assistant"):
                role = "user"
            chat.append({"role": role, "content": flatten(message.get("content"))})
        if not chat:
            chat = [{"role": "user", "content": ""}]
        prompt = self.tokenizer.apply_chat_template(chat, tokenize=False, add_generation_prompt=True)
        inputs = self.tokenizer(prompt, return_tensors="pt")
        inputs = {key: value.to(torch.device("cuda:0")) for key, value in inputs.items()}
        cap = max(1, min(int(max_tokens or 256), 768))
        with self.lock, torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=cap,
                do_sample=False,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        new_tokens = output[0, inputs["input_ids"].shape[1]:]
        return self.tokenizer.decode(new_tokens, skip_special_tokens=True)


def serve(generator):
    holder = {"generator": generator}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.rstrip("/").endswith("/models"):
                body = json.dumps({"object": "list", "data": [{"id": "local", "object": "model"}]}).encode()
                self._send(200, body)
                return
            self._send(404, b"{}")

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
                text = holder["generator"].complete(payload.get("messages") or [], payload.get("max_tokens") or 256)
                body = json.dumps({
                    "id": "local",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": "local",
                    "choices": [{
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }],
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                }).encode()
                self._send(200, body)
            except Exception as err:
                body = json.dumps({"error": {"message": redact(err)[:500]}}).encode()
                self._send(500, body)

        def _send(self, code, body):
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            print(redact(fmt % args)[:300], flush=True)

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


CALLER = r'''
import json, os, traceback
from pathlib import Path

BASE = "http://127.0.0.1:8000/v1"
os.environ.pop("GROQ_API_KEY", None)
os.environ["OPENAI_API_KEY"] = "local"
os.environ["OPENAI_BASE_URL"] = BASE

calls = json.loads(Path("/tmp/gap-calls.json").read_text(encoding="utf-8"))
rows = []

def clip(err):
    return str(err)[:800]

for call in calls:
    row = {
        "framework": call["framework"],
        "task": call["task"],
        "type": call["type"],
        "ok": False,
        "content": "",
        "detail": "",
    }
    try:
        if call["framework"] == "OpenHands":
            from openhands.sdk.llm import LLM, Message, TextContent
            llm = LLM(
                model="openai/Qwen2.5-Coder-14B-Instruct",
                api_key="local",
                base_url=BASE,
                num_retries=0,
                timeout=180,
                temperature=0,
                max_output_tokens=int(call["maxTokens"]),
            )
            response = llm.completion([Message(role="user", content=[TextContent(text=call["prompt"])])])
            parts = []
            for block in response.message.content or []:
                text = getattr(block, "text", None)
                if text:
                    parts.append(text)
            row["content"] = "\n".join(parts)
            row["ok"] = True
            row["detail"] = "completion"
        elif call["framework"] == "AutoGen":
            import asyncio
            from autogen_core.models import UserMessage
            from autogen_ext.models.openai import OpenAIChatCompletionClient
            client = OpenAIChatCompletionClient(
                model="Qwen/Qwen2.5-Coder-14B-Instruct",
                base_url=BASE,
                api_key="local",
                temperature=0,
                max_tokens=int(call["maxTokens"]),
                model_info={
                    "vision": False,
                    "function_calling": False,
                    "json_output": False,
                    "family": "unknown",
                    "structured_output": False,
                },
            )
            result = asyncio.run(client.create([UserMessage(content=call["prompt"], source="user")]))
            content = result.content
            row["content"] = content if isinstance(content, str) else str(content)
            row["ok"] = True
            row["detail"] = "create"
        else:
            row["detail"] = "unknown framework"
    except Exception as err:
        row["detail"] = clip(traceback.format_exc())
    rows.append(row)
    print(json.dumps({"framework": row["framework"], "task": row["task"], "ok": row["ok"], "chars": len(row["content"])}), flush=True)

Path("/tmp/gap-rows.json").write_text(json.dumps(rows), encoding="utf-8")
'''


def install_target(target, packages):
    target.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "--target", str(target), *packages],
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired as err:
        return False, redact(err)[:500]
    tail = redact((result.stderr or result.stdout or "")[-500:])
    return result.returncode == 0, tail


def install_frameworks():
    status(phase="install-frameworks")
    # lmnr 0.7.47 and a newer instrumentation build ask for different
    # opentelemetry-semantic-conventions builds. Pin the pair that resolves.
    oh_ok, oh_err = install_target(FW_OH, [
        "openhands-sdk==1.34.0",
        "opentelemetry-instrumentation==0.60b1",
        "opentelemetry-semantic-conventions==0.60b1",
    ])
    ag_ok, ag_err = install_target(FW_AG, [
        "autogen-agentchat==0.7.5",
        "autogen-ext[openai]==0.7.5",
    ])
    status(phase="install-frameworks-done", openhands=oh_ok, autogen=ag_ok, error=(oh_err + "\n" + ag_err)[-500:])
    return oh_ok, ag_ok, oh_err, ag_err


def run_calls(loaded, pythonpath, calls):
    Path("/tmp/gap-calls.json").write_text(json.dumps(calls), encoding="utf-8")
    Path("/tmp/call_gaps.py").write_text(CALLER, encoding="utf-8")
    raw_path = Path("/tmp/gap-rows.json")
    if raw_path.exists():
        raw_path.unlink()
    env = os.environ.copy()
    env.pop("GROQ_API_KEY", None)
    env["OPENAI_API_KEY"] = "local"
    env["OPENAI_BASE_URL"] = f"http://127.0.0.1:{PORT}/v1"
    env["PYTHONPATH"] = str(pythonpath) + ((":" + env["PYTHONPATH"]) if env.get("PYTHONPATH") else "")
    result = subprocess.run(
        [sys.executable, "/tmp/call_gaps.py"],
        capture_output=True,
        text=True,
        env=env,
        timeout=900,
    )
    rows = []
    if raw_path.exists():
        rows = json.loads(raw_path.read_text(encoding="utf-8"))
    for row in rows:
        row["model"] = loaded
    if result.returncode != 0 and not rows:
        rows = [{
            "framework": calls[0]["framework"] if calls else "installer",
            "task": "calls",
            "type": "error",
            "ok": False,
            "content": "",
            "model": loaded,
            "detail": redact((result.stderr or result.stdout or "call script failed")[-800:]),
        }]
    return rows, redact((result.stderr or "")[-500:])


def try_metagpt(loaded):
    status(phase="metagpt")
    target = Path("/tmp/metagpt")
    target.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-q", "--target", str(target), "metagpt==0.8.2"],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except subprocess.TimeoutExpired as err:
        return [{
            "framework": "MetaGPT",
            "task": "install",
            "type": "install",
            "ok": False,
            "content": "",
            "model": loaded,
            "detail": redact(err)[:800],
        }]
    if result.returncode != 0:
        try:
            fallback = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", "--target", str(target), "metagpt==0.8.1"],
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired as err:
            return [{
                "framework": "MetaGPT",
                "task": "install",
                "type": "install",
                "ok": False,
                "content": "",
                "model": loaded,
                "detail": redact(err)[:800],
            }]
        if fallback.returncode != 0:
            detail = redact(((result.stderr or "") + "\n" + (fallback.stderr or ""))[-800:])
            return [{
                "framework": "MetaGPT",
                "task": "install",
                "type": "install",
                "ok": False,
                "content": "",
                "model": loaded,
                "detail": detail,
            }]
    runner = r'''
import json, os, asyncio, traceback
from pathlib import Path
os.environ.pop("GROQ_API_KEY", None)
config = Path.home() / ".metagpt" / "config2.yaml"
config.parent.mkdir(parents=True, exist_ok=True)
config.write_text(
    "llm:\n"
    "  api_type: openai\n"
    "  model: Qwen/Qwen2.5-Coder-14B-Instruct\n"
    "  base_url: http://127.0.0.1:8000/v1\n"
    "  api_key: local\n",
    encoding="utf-8",
)
prompt = Path("/tmp/metagpt-prompt.txt").read_text(encoding="utf-8")
try:
    from metagpt.llm import LLM
    text = asyncio.run(LLM().aask(prompt))
    Path("/tmp/metagpt-out.json").write_text(json.dumps({"ok": True, "content": text, "detail": "aask"}), encoding="utf-8")
except Exception:
    Path("/tmp/metagpt-out.json").write_text(json.dumps({"ok": False, "content": "", "detail": traceback.format_exc()[-800:]}), encoding="utf-8")
'''
    Path("/tmp/metagpt-prompt.txt").write_text(FILE_PROMPT, encoding="utf-8")
    Path("/tmp/run_metagpt.py").write_text(runner, encoding="utf-8")
    env = os.environ.copy()
    env.pop("GROQ_API_KEY", None)
    env["PYTHONPATH"] = str(target) + ((":" + env["PYTHONPATH"]) if env.get("PYTHONPATH") else "")
    run = subprocess.run([sys.executable, "/tmp/run_metagpt.py"], capture_output=True, text=True, env=env, timeout=300)
    out_path = Path("/tmp/metagpt-out.json")
    if out_path.exists():
        payload = json.loads(out_path.read_text(encoding="utf-8"))
    else:
        payload = {"ok": False, "content": "", "detail": redact((run.stderr or run.stdout or "no output")[-800:])}
    return [{
        "framework": "MetaGPT",
        "task": "coder#3",
        "type": "file",
        "ok": bool(payload.get("ok")),
        "content": payload.get("content") or "",
        "model": loaded,
        "detail": redact(payload.get("detail") or "")[:800],
    }]


def docker_row():
    which = shutil.which("docker")
    return {
        "framework": "SWE-agent",
        "task": "docker",
        "type": "docker",
        "ok": False,
        "content": "",
        "model": None,
        "detail": "docker found at " + which if which else "FileNotFoundError: docker is not on PATH",
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    gpus = gpu_info()
    cache = largest_cache_dir()
    status(phase="start", gpus=gpus, cache=cache, python=sys.version)
    if gpus["count"] < 1:
        write_json(GAPS, {"loaded": None, "rows": [], "error": "no GPU", "gpus": gpus})
        return
    repo, tokenizer, model, errors = load_stock(gpus["count"])
    write_json(MODEL_PATH, {"loaded": repo, "gpus": gpus, "cache": cache, "errors": errors})
    if repo is None:
        write_json(GAPS, {"loaded": None, "rows": [], "error": "no model fit", "errors": errors})
        status(phase="done", model=None)
        return
    serve(Generator(tokenizer, model))
    oh_ok, ag_ok, oh_err, ag_err = install_frameworks()
    rows = []
    call_errors = []
    status(phase="calls")
    if oh_ok:
        try:
            oh_rows, oh_call_error = run_calls(repo, FW_OH, [call for call in CALLS if call["framework"] == "OpenHands"])
            rows.extend(oh_rows)
            if oh_call_error:
                call_errors.append(oh_call_error)
        except Exception:
            rows.append({
                "framework": "OpenHands",
                "task": "coder#3",
                "type": "file",
                "ok": False,
                "content": "",
                "model": repo,
                "detail": redact(traceback.format_exc())[-800:],
            })
    else:
        rows.append({
            "framework": "OpenHands",
            "task": "coder#3",
            "type": "install",
            "ok": False,
            "content": "",
            "model": repo,
            "detail": oh_err,
        })
    if ag_ok:
        try:
            ag_rows, ag_call_error = run_calls(repo, FW_AG, [call for call in CALLS if call["framework"] == "AutoGen"])
            rows.extend(ag_rows)
            if ag_call_error:
                call_errors.append(ag_call_error)
        except Exception:
            rows.append({
                "framework": "AutoGen",
                "task": "calls",
                "type": "error",
                "ok": False,
                "content": "",
                "model": repo,
                "detail": redact(traceback.format_exc())[-800:],
            })
    else:
        rows.append({
            "framework": "AutoGen",
            "task": "calls",
            "type": "install",
            "ok": False,
            "content": "",
            "model": repo,
            "detail": ag_err,
        })
    call_error = "\n".join(call_errors)[-500:]
    write_json(GAPS, {"loaded": repo, "rows": rows, "callError": call_error})
    try:
        extra = try_metagpt(repo)
    except Exception as err:
        extra = [{
            "framework": "MetaGPT",
            "task": "install",
            "type": "install",
            "ok": False,
            "content": "",
            "model": repo,
            "detail": redact(err)[:800],
        }]
    rows.extend(extra)
    rows.append(docker_row())
    write_json(GAPS, {"loaded": repo, "rows": rows, "callError": call_error, "python": sys.version})
    status(phase="done", model=repo, rows=len(rows))


if __name__ == "__main__":
    main()
