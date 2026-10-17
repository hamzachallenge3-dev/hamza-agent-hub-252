"""Deterministic allowlist export. Default ZIP is a private setup scaffold.
--public requires an operator-verified, non-capability HTTPS endpoint.
Never write endpoint credentials into a public artifact.
"""
import argparse
import json
import os
import re
import stat
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "chatgpt-plugin/hamza-agent-hub"
OUT = ROOT / "chatgpt-plugin/release/hamza-agent-hub-chatgpt-plugin.zip"

def check_content(data):
    text = data.decode("utf-8")
    patterns = (r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", r"gh[pousr]_[A-Za-z0-9]{20,}",
                r"sk-[A-Za-z0-9_-]{20,}", r"https://hub\.imdifferent01\.com/(?!<|\$)[A-Za-z0-9_-]{24,}/mcp")
    if any(re.search(pattern, text) for pattern in patterns):
        raise ValueError("secret-like content rejected (values withheld)")
    for key, value in os.environ.items():
        if re.search(r"SECRET|TOKEN|API_KEY|PASSWORD", key) and len(value) >= 8 and value in text:
            raise ValueError("environment secret rejected (values withheld)")

def build(public=False):
    entries = {}
    for path in SOURCE.rglob("*"):
        rel = path.relative_to(SOURCE)
        if path.is_symlink():
            raise ValueError("symlinks forbidden")
        if not path.is_file():
            continue
        allowed = str(rel) in ("plugin.json", "mcp.json", ".mcp.json", ".codex-plugin/plugin.json", "PRIVACY.md", "TERMS.md") or rel.parts[0] in ("skills", "assets")
        if not allowed:
            continue
        if path.name.startswith(".env") or any(p in (".git", "node_modules", "__pycache__") for p in rel.parts):
            raise ValueError("forbidden archive member")
        data = path.read_bytes()
        if path.suffix.lower() not in (".png", ".jpg", ".webp"):
            check_content(data)
        entries[str(rel)] = data
    manifest = json.loads(entries["plugin.json"])
    interface = manifest["extensions"]["com.openai"]["interface"]
    assert len(interface["shortDescription"]) <= 30
    prompts = interface["defaultPrompt"]
    assert isinstance(prompts,str) or len(prompts) <= 3
    assert "apps" not in manifest and "apps" not in manifest["extensions"]["com.openai"]
    assert "apps" not in json.loads(entries[".codex-plugin/plugin.json"])
    if public:
        raw = os.environ.get("HAH_PUBLIC_MCP_URL", "")
        endpoint = urlsplit(raw)
        if os.environ.get("HAH_PUBLIC_ENDPOINT_VERIFIED") != "1" or endpoint.scheme != "https" or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or endpoint.path != "/mcp":
            raise ValueError("public export blocked: verified credential-free HTTPS /mcp endpoint required; path-capability URLs are private only")
        pointer = json.loads(entries["mcp.json"])
        pointer["mcpServers"]["hamza-agent-hub"]["url"] = raw
        data = (json.dumps(pointer,indent=2)+"\n").encode()
        check_content(data)
        entries["mcp.json"] = entries[".mcp.json"] = data
    else:
        entries["SETUP-REQUIRED.txt"] = b"Private setup scaffold. Set HAH_MCP_URL in your client. Not ready for public upload. See repository docs/CHATGPT-STORE.md.\n"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUT.with_suffix(".tmp")
    with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            entry = zipfile.ZipInfo("hamza-agent-hub/"+name, (2026,1,1,0,0,0))
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry,data)
    temp.replace(OUT)
    print("Packed public release" if public else "Packed private scaffold (public upload blocked)")
    print(OUT)
    return OUT

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--public", action="store_true")
    try:
        build(parser.parse_args().public)
    except (ValueError, AssertionError):
        parser.exit(1, "Package validation failed; check source or endpoint configuration (secret values withheld).\n")
