"""Python Streamable HTTP entrypoint sharing the ONE Node agent runtime.

Run uvicorn hub:app --host 127.0.0.1 --port 8787 from runtime/
(or 8789 to match Docker). The lifespan starts the built Node runtime on
loopback. No independent roster. Access logs MUST be disabled
(uvicorn --no-access-log).
"""
import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route
from starlette.background import BackgroundTask

ROOT = Path(__file__).resolve().parents[1]
BACKEND = "http://127.0.0.1:8790"

@asynccontextmanager
async def lifespan(app):
    token = os.environ.get("HAH_AUTH_TOKEN", "")
    if len(token) < 24:
        raise RuntimeError("HAH_AUTH_TOKEN must contain at least 24 characters")
    env = dict(os.environ, HAH_TRANSPORT="http", HAH_HOST="127.0.0.1", HAH_PORT="8790")
    process = await asyncio.create_subprocess_exec(
        "node", "--experimental-sqlite", str(ROOT / "dist/index.js"), env=env,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    try:
        async with httpx.AsyncClient(base_url=BACKEND, timeout=35, follow_redirects=False, trust_env=False) as client:
            app.state.client = client
            for _ in range(100):
                if process.returncode is not None:
                    raise RuntimeError("Node runtime failed to start")
                try:
                    health = await client.get("/healthz")
                    if health.status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.1)
            else:
                raise RuntimeError("Node runtime startup timeout")
            yield
    finally:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 10)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()

async def health(request):
    try:
        result = await request.app.state.client.get("/healthz")
        ok = result.status_code == 200 and result.json().get("ok") is True
    except (httpx.HTTPError, ValueError):
        ok = False
    return JSONResponse({"ok": ok, "service": "hamza-agent-hub-origin"}, status_code=200 if ok else 503)

async def mcp(request: Request):
    token = os.environ.get("HAH_AUTH_TOKEN", "")
    supplied = request.headers.get("authorization", "")
    if len(token) < 24 or not hmac.compare_digest(supplied.encode(), ("Bearer " + token).encode()):
        return JSONResponse({"error": "unauthorized / غير مصرح"}, status_code=401)
    if request.method != "POST":
        return Response(status_code=405, headers={"Allow": "POST"})
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 1_048_576:
            return JSONResponse({"error": "request too large"}, status_code=413)
        chunks.append(chunk)
    headers = {h: request.headers[h] for h in
               ("authorization", "content-type", "accept", "mcp-protocol-version", "origin") if h in request.headers}
    try:
        outgoing = request.app.state.client.build_request("POST", "/mcp", content=b"".join(chunks), headers=headers)
        result = await request.app.state.client.send(outgoing, stream=True)
        if result.status_code >= 500:
            await result.aclose()
            return JSONResponse({"error": "origin unavailable"}, status_code=502)
        response_headers = {h: result.headers[h] for h in ("content-type", "retry-after") if h in result.headers}
        return StreamingResponse(result.aiter_raw(), status_code=result.status_code,
                                 headers=response_headers, background=BackgroundTask(result.aclose))
    except httpx.HTTPError:
        return JSONResponse({"error": "origin unavailable"}, status_code=502)

app = Starlette(lifespan=lifespan, routes=[Route("/healthz", health), Route("/mcp", mcp, methods=["POST", "GET", "DELETE"])])
