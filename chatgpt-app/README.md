# Hamza Agent Hub — ChatGPT app (MCP server)

One ChatGPT app that gives ChatGPT all **252 expert agents** of this repo (14 categories).
ChatGPT searches the roster, loads the right agent's full instructions, and works in that role.

**Public endpoint (no login, read-only):**

```
https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/mcp
```

Health check: `https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/healthz`

## Tools

| Tool | What it does |
| --- | --- |
| `list_categories` | The 14 categories and agent counts (252 total). |
| `search_agents(query, category?, limit?)` | Finds the best agents for a task. Returns ids. |
| `get_agent(id)` | Returns the agent's full instructions; ChatGPT adopts that role. |
| `run_agent_prompt(id, task)` | Agent instructions + your task as one ready prompt (also usable in any AI chat). |

All tools are marked `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
The server stores nothing, needs no keys, and makes no outside calls.

## Add it in ChatGPT (web)

You need a ChatGPT plan that allows custom MCP servers (see "Plans" below). Use chatgpt.com in a browser; mobile can't add custom servers.

1. Open **chatgpt.com → Plugins** (`chatgpt.com/plugins`).
2. Click **+** → **Add custom MCP server** (older UI: **Settings → Apps & Connectors → Advanced → Developer mode ON → Create**).
3. Name: `Hamza Agent Hub` · Description: `252 expert agents: coding, testing, security, planning, docs, research and more.`
4. Connection / MCP Server URL: `https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/mcp`
5. Authentication: **No authentication**.
6. Tick **I understand and want to continue** → **Create** (as a plugin). You should see the 4 tools.
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
  8 hub agents have no profile file; their instructions are generated from the catalog description (marked in `source`).
- 6 very long instruction files are cut at 24,000 characters (marked `truncated: true`).
- Instructions may mention CLI tools that don't exist in ChatGPT; the server tells ChatGPT to skip those parts.
