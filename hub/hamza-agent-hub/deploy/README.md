# Deploy the single hub runtime

This is reviewed source, not a production deployment. Do not replace production Hub, GLM or Headroom during testing. Use a separate Worker and origin for staging.

## Architecture

ChatGPT → Cloudflare Worker → HTTPS origin or cloudflared → `runtime/hub.py` → loopback Node MCP.

Python owns process startup, shutdown and streaming proxying. Node remains the single roster, queue and tool implementation. No second plugin is installed. MCP is stateless: POST supports initialization, discovery, resources, prompts and tool calls; GET/DELETE return 405. Do not send session IDs. Responses support JSON and SSE passthrough.

## Always-on origin (recommended)

Build from the `hamza-agent-hub` directory:

```bash
docker build -f deploy/Dockerfile -t hamza-agent-hub:1.2.0 .
# Populate a PRIVATE runtime.env via your secret manager, with HAH_AUTH_TOKEN.
# Do not place it in this repository or use a literal token on the command line.
docker run --name hamza-hub-lab --restart unless-stopped \
  --env-file /private/runtime.env \
  -p 127.0.0.1:8789:8789 \
  -v hamza-hub-data:/app/data -v hamza-hub-workspaces:/app/workspaces \
  hamza-agent-hub:1.2.0
```

Put a TLS reverse proxy or a named Cloudflare tunnel in front of port 8789. Disable access logs, tracing and request capture on every proxy: the public path is a credential. Mount volumes for SQLite and workspaces; back them up privately. Run one origin replica (SQLite queue leases are not distributed). SQLite migration adds attempts/availability columns without deleting tasks. Task replay may repeat tool actions; built-in writes and dispatch use deterministic paths/idempotency keys.

The container runs as an unprivileged user. Model endpoints are operator-configured, not public tool arguments. Use only free-tier credentials. Docker build and a live always-on host have not been provisioned by this PR.

## Cloudflare staging Worker

Source: `cloudflare-worker/worker.js`; configuration: `cloudflare-worker/wrangler.jsonc`.

1. Use an account-approved Wrangler installation. Keep the default `hamza-agent-hub-edge-lab` name for staging.
2. Set secret bindings interactively from your secret manager using `wrangler secret put`: `HUB_SECRET` (32+ URL-safe random characters), `ORIGIN_URL` (HTTPS origin host only, no path/query/userinfo; live Worker alias `HUB_ORIGIN` is also accepted), `ORIGIN_TOKEN` (matches the origin's `HAH_AUTH_TOKEN`, 24+ characters), and `OPENAI_APPS_CHALLENGE` (portal value).
3. Set exact allowed origins in `ALLOWED_ORIGINS`; default is `https://chatgpt.com`. Requests without Origin remain supported. Verify the actual ChatGPT client origin before changing this.
4. Verify the rate-limit binding for your Cloudflare account. Requests fail closed if it is absent. Default 120 requests/client/minute; health/challenge are public. Add WAF limits for public health probes.
5. Deploy to a staging host first. No production route is included in the checked-in Wrangler config. After staging approval, bind `hub.imdifferent01.com` explicitly using your existing deployment process.
6. Check `/healthz` → 200 with `ok: true`; set the portal challenge and check `/.well-known/openai-apps-challenge`. MCP's **private** connect URL shape is `https://hub.imdifferent01.com/<HUB_SECRET>/mcp`. Do not paste the actual URL into issues, recordings or public ZIPs.

The Worker replaces inbound Authorization with the origin token. Cookies, arbitrary headers, redirects and origin error bodies are not forwarded. Health responses never expose origin URLs or secrets. Body limit is 1 MiB, upstream MCP timeout 35 seconds, health timeout 3 seconds. Origin model calls time out after 30 seconds. Long work uses `run_agent` followed by `task_status` and `task_result`, rather than a long synchronous HTTP request.

## Kaggle and cloudflared runbook

Kaggle is an optional temporary lab host, not an always-on store service.

**One-shot starter** (preferred): after cloning `main` and loading `HAH_AUTH_TOKEN` from Kaggle Secrets (never print it):

```bash
cd hamza-agent-hub
# Optional overrides: HUB_SANDBOX_USER=agentbox HUB_SANDBOX_WORK_DIR=/home/agentbox/work HAH_ORIGIN_PORT=8787
bash runtime/kaggle_start.sh
```

That script builds the Node runtime, installs Python deps, ensures `/home/agentbox/work`, enables `run_command` for the sandbox user, and starts `hub.py` on **8787**.

Manual steps if you skip the script:

1. In a CPU session, clone `main` and enter `hamza-agent-hub`.
2. Install Node 22+ and Python 3.11+. Run `npm ci && npm run build`; create a venv and install `runtime/requirements.txt`.
3. Load `HAH_AUTH_TOKEN` using Kaggle's private secrets integration. Never print environment variables or notebook cell outputs containing tokens. It must match Worker `ORIGIN_TOKEN`.
4. Export `HUB_SANDBOX_USER=agentbox`, `HUB_SANDBOX_WORK_DIR=/home/agentbox/work`, `HAH_ENABLE_SANDBOX_TOOLS=1`. Start from `runtime/`: `uvicorn hub:app --host 127.0.0.1 --port 8787 --no-access-log`. Confirm `http://127.0.0.1:8787/healthz`.
5. Start the existing authenticated named cloudflared tunnel pointing at **8787**. Keep tunnel config private; update Worker `ORIGIN_URL` or live alias `HUB_ORIGIN` after restarts. Never commit the URL.
6. Connect clients at `https://hub.imdifferent01.com/<HUB_SECRET>/mcp`. `run_command` appears only on that authenticated HTTP path (not stdio). There is no legacy `start_job`/`job_status` in this plugin — use `run_agent` / `task_status` / `task_result` for queued agent work.
7. On failure, check the kernel is awake, origin health, tunnel process, Worker origin binding, then auth. Restart in that order. Rotate secrets privately if a URL/token was exposed.

Kernel sleep kills the tunnel and running process. There is no implemented Worker wake queue. Migrate to a persistent origin before public review; polling cannot make a sleeping Kaggle kernel reliable.

## Operational boundaries

The path-secret capability is single-tenant private authentication. Anyone who obtains it can access that hub's tasks/workspaces. It is not an OAuth multi-user isolation design and must not be advertised in a public directory package. Public submission needs an approved OAuth-capable, tenant-isolated gateway and a verified credential-free `/mcp` URL. This release blocks public packaging until a verified endpoint is configured; it does not certify the auth design.

Pending queue capacity defaults to 1,000 tasks (`HAH_MAX_PENDING`); idempotent reuses still succeed when full. Graceful shutdown requeues interrupted work within its attempt budget. Retries default to 3 attempts with exponential backoff, then `dead_letter`. Cancellation is terminal; late model success/failure cannot overwrite it. Poll task results for evidence and failures. Stop/start one process to recover interrupted tasks. Keep `HAH_CONCURRENCY` within the origin's resources (default 2, maximum 32).
