# Hamza Agent Hub — ChatGPT app (MCP server)

One ChatGPT app that gives ChatGPT all **252 expert agents** of this repo (14 categories).
ChatGPT searches the roster, loads the right agent's full instructions, and works in that role.

**Public endpoint (no login, read-only):**

```
https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/mcp
```

Health check: `https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/health` (and `/healthz`)

## Tools

| Tool | What it does |
| --- | --- |
| `list_categories` | The 14 categories and agent counts (252 total). |
| `search_agents(query, category?, limit?)` | Finds the best agents for a task. Returns ids. |
| `get_agent(id)` | Returns the agent's full instructions; ChatGPT adopts that role. |
| `list_model_providers` | Free providers, the secret name for each, and the models allowed. No key values. |
| `run_agent_prompt(id, task, provider?, model?)` | Agent instructions + your task. Calls a free model when a secret is set; otherwise returns the prompt and the secret names to set. |

Catalog tools are `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
`run_agent_prompt` is `openWorldHint: true` because it may send the task to a free model API.
The server stores nothing. Paid providers (OpenAI, Anthropic, and any other billed API) are hard-blocked.

### Free model secrets

Set any one of these as a Cloudflare Worker secret (`npx wrangler secret put NAME`) or as an env var for `node src/server.js`. With none set, every tool still works and `run_agent_prompt` returns the prompt.

| Secret | Provider | Default free model |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq free tier | `qwen/qwen3.8-27b` |
| `GEMINI_API_KEY` | Google Gemini free tier (Flash only) | `gemini-2.5-flash` |
| `OPENROUTER_API_KEY` | OpenRouter models ending in `:free` | `meta-llama/llama-3.3-70b-instruct:free` |
| `HF_TOKEN` | Hugging Face free inference (`:hf-inference` only). `HUGGINGFACE_API_KEY` is an alias. | `Qwen/Qwen2.5-7B-Instruct:hf-inference` |
| `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | Workers AI REST. A binding named `AI` works with no token. | `@cf/meta/llama-3.1-8b-instruct` |

On rate limit or provider error the server tries the next configured free provider. A paid model id is rejected and is not replaced with a paid call.

## Add it in ChatGPT (web)

You need a ChatGPT plan that allows custom MCP servers (see "Plans" below). Use chatgpt.com in a browser; mobile can't add custom servers.

1. Open **chatgpt.com → Plugins** (`chatgpt.com/plugins`).
2. Click **+** → **Add custom MCP server** (older UI: **Settings → Apps & Connectors → Advanced → Developer mode ON → Create**).
3. Name: `Hamza Agent Hub` · Description: `252 expert agents: coding, testing, security, planning, docs, research and more.`
4. Connection / MCP Server URL: `https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/mcp`
5. Authentication: **No authentication**.
6. Tick **I understand and want to continue** → **Create** (as a plugin). You should see the 5 tools.
7. Install / enable it, open a new chat, type **@Hamza Agent Hub** and ask, for example:
   - "Find the best agent to review my Node.js API for security, then act as it."
   - "List the agent categories."
   - "Act as the `tester` agent and write unit tests for this function: …"

## Plans (as documented by OpenAI, Oct 2026)

- Custom MCP servers are added on ChatGPT **web** from Plugins; the separate "developer mode" toggle is no longer required.
- **Pro** can connect custom MCP servers with read/fetch tools (all tools here are read-only). Business / Enterprise / Edu get full MCP (admins/owners create and publish for the workspace).
- Public listing in the ChatGPT plugin directory needs an OpenAI review: verified developer identity on platform.openai.com, public HTTPS endpoint, domain verification, tool annotations, website / support / privacy / terms URLs, 5 positive + 3 negative test cases. See https://developers.openai.com/plugins/deploy/submission .

## Run or deploy it yourself (free)

```bash
cd chatgpt-app
python3 scripts/build_catalog.py      # rebuild data/agents.json from the repo roster
PORT=8791 node src/server.js          # local, zero dependencies, Node 18+
node scripts/smoke.mjs http://127.0.0.1:8791
npx wrangler deploy                   # Cloudflare Workers free plan (Node 22+ for wrangler)
```

`src/core.js` is the whole server (stateless MCP streamable HTTP, JSON responses).
`src/worker.js` = Cloudflare Worker entry, `src/server.js` = plain Node entry.

## Notes

- 162 agents come from the upstream open-source agent library (MIT, see `../LICENSE`); 90 from the Hamza Agent Hub packs.
  Hub agents with no profile file get instructions generated from the catalog description (marked in `source`).
- 6 very long instruction files are cut at 24,000 characters (marked `truncated: true`).
- Instructions may mention CLI tools that don't exist in ChatGPT; the server tells ChatGPT to skip those parts.
