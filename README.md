# ⚡ Hamza Agent Hub

**252 expert agents (reviewer, planner, tester, security auditor…) inside ChatGPT, Claude and Cursor with one MCP URL. No install, no API key required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
![Agents](https://img.shields.io/badge/agents-252-orange)
![Categories](https://img.shields.io/badge/categories-14-purple)
![Tools](https://img.shields.io/badge/tools-5-lightgrey)
[![GitHub stars](https://img.shields.io/github/stars/hamzachallenge3-dev/hamza-agent-hub-252?style=social)](https://github.com/hamzachallenge3-dev/hamza-agent-hub-252/stargazers)

![Hamza Agent Hub running inside ChatGPT](docs/media/chatgpt-demo.gif)

▶️ **Demo video (3.5 min, ChatGPT):** https://drive.google.com/file/d/1Pk586kzf7EgKf_5hXbwUgdBLtm4CaN9N/view

---

## 30-second quickstart

The hosted server is free and has no authentication:

```
https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/mcp
```

**ChatGPT** (developer mode / plugins): Settings → Plugins → **+ Add custom MCP server** → paste the URL → Authentication: *None*.

**Claude** (claude.ai or Desktop): Settings → Connectors → **Add custom connector** → paste the URL.
Claude Code: `claude mcp add --transport http agent-hub https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/mcp`

**Cursor**: add this to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "hamza-agent-hub": { "url": "https://hamza-agent-hub-mcp.loukilihamza78.workers.dev/mcp" }
  }
}
```

Then ask: *"Use Hamza Agent Hub to review this function as a security auditor."*

## What the server exposes

Five tools. Nothing touches your accounts, files, or money. `run_agent_prompt` calls a free model only when a server secret is set; otherwise it returns the prompt.

| Tool | What it does |
| --- | --- |
| `list_categories` | The 14 categories and how many agents each has |
| `search_agents` | Find agents by keyword or category |
| `get_agent` | Full role prompt and details for one agent |
| `list_model_providers` | Free providers, secret names, and allowlisted models (never the keys) |
| `run_agent_prompt` | Agent role + your task, then a free-model reply when a secret is set |

> **Honest note.** These agents are carefully written role prompts. They don't run by
> themselves or act on your accounts. They make the AI chat you already use behave like a
> focused specialist for the task you give it. Optional server secrets (`GROQ_API_KEY`,
> `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`, or `CLOUDFLARE_API_TOKEN` with
> `CLOUDFLARE_ACCOUNT_ID`) let `run_agent_prompt` call a free model. Paid providers are disabled.

## Categories (252 agents)

| Category | Agents |
| --- | ---: |
| 🗺️ Planning & coordination | 51 |
| 🧰 General helpers | 36 |
| 🧪 Testing & QA | 35 |
| 🔍 Code review | 25 |
| 🚀 Performance & optimization | 22 |
| 🏗️ Architecture & design | 21 |
| 🔐 Security | 14 |
| 💻 Coding | 12 |
| 🧠 Memory & knowledge | 10 |
| 📝 Documentation | 9 |
| 🔎 Research | 6 |
| 📈 Trading & market data (prompts only) | 6 |
| 🌿 Git & GitHub | 3 |
| 🎵 Music | 2 |
| **Total** | **252** |

The served roster is [`chatgpt-app/data/agents.json`](chatgpt-app/data/agents.json).

## Example prompts

- "What categories does Hamza Agent Hub have?"
- "Find an agent for writing unit tests in TypeScript, then use it on this file."
- "Act as the security auditor agent and review this Express login route."
- "Use the planner agent to break this feature into tasks with estimates."
- "Get the performance optimizer agent and find the slow parts of this SQL query."
- "Use the docs writer agent to write a README for this script."

## No MCP? Copy-paste works too

Every agent is a Markdown file. Browse [`docs/agent-inventory.md`](docs/agent-inventory.md),
copy the text under the front-matter, and paste it as custom instructions or the first message of a chat.

## Self-host

The server is a small Cloudflare Worker in [`chatgpt-app/`](chatgpt-app/):

```bash
git clone https://github.com/hamzachallenge3-dev/hamza-agent-hub-252.git
cd hamza-agent-hub-252/chatgpt-app
npm install
npx wrangler deploy
```

A local stdio MCP version for Claude Desktop/Cursor lives in [`hub/hamza-agent-hub/`](hub/hamza-agent-hub/) (Node.js 22+).

## ⭐ Star if useful

If this saved you from writing a prompt from scratch, a star helps other people find it.
Issues and PRs with new agents are welcome, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Work with imdifferent01

imdifferent01 is the automation studio of **Hamza Loukili**. If you want something like
this running in your business, we build:

* **n8n automations:** lead capture, CRM sync, email and WhatsApp follow-ups, reports, invoices.
* **AI agents:** task-specific agents wired to your tools, with a human approval step where it matters.
* **Chatbots:** website and messaging assistants trained on your own documents and FAQs.
* **Custom workflows:** glue code, APIs and MCP servers that connect the tools you already pay for.

📧 **hamza@imdifferent01.com** · 🌐 **https://imdifferent01.com**

## License

MIT, see [`LICENSE`](LICENSE). Based on MIT-licensed work (original copyright notice kept).
Changes © 2026 imdifferent01 (Hamza Loukili).
