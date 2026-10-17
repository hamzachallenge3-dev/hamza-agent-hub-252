# ⚡ Hamza Agent Hub — Super Powers for ChatGPT & Claude

**Use your chat with super power, with full power.**

Hamza Agent Hub is a free, open library of **252 ready-made expert agents** for ChatGPT,
Claude, Gemini, or any AI chat. Each agent is a carefully written role prompt
(planner, code reviewer, tester, security auditor, lead cleaner, docs writer, and many
more). You plug one into your chat and it answers as that specialist.

**Who it's for:** freelancers, small teams, developers, and anyone who uses an AI chat
every day and wants better, more focused answers without writing prompts from scratch.

> **Honest note.** These agents are prompt / instruction files. They don't run by
> themselves, don't act on your accounts, and don't make money on their own. They make
> the AI chat you already use behave like a focused expert when you give it a task.

---

## Use it in 3 steps

1. **Pick an agent.** Browse the list in [`docs/agent-inventory.md`](docs/agent-inventory.md)
   or the folders below (for example `.claude/agents/core/reviewer.md`).
2. **Copy its text.** Open the `.md` file and copy everything under the front-matter.
3. **Paste it into your chat.** Use it as a ChatGPT Custom GPT / custom instructions, a
   Claude Project instruction, or just the first message of a new chat. Then give it your task.

That's it: no install, no account, no setup.

## Agent categories

Counts come from the recorded roster in [`docs/bench/agent-tasks.json`](docs/bench/agent-tasks.json)
(252 agents, each tagged with a kind):

| Category | Agents |
| --- | ---: |
| 🗺️ Planning & coordination | 51 |
| 🧪 Testing & QA | 35 |
| 🧰 General helpers | 34 |
| 🔍 Code review | 25 |
| 🚀 Performance & optimization | 22 |
| 🏗️ Architecture & design | 21 |
| 🔐 Security | 14 |
| 💻 Coding | 12 |
| 🧠 Memory & knowledge | 10 |
| 📝 Documentation | 9 |
| 📈 Trading & market data (prompts only, not financial advice) | 9 |
| 🔎 Research | 5 |
| 🌿 Git & GitHub | 3 |
| 🎵 Music | 2 |
| **Total** | **252** |

Where they live:

* **162** agents from the upstream open-source agent library, under `.claude/agents/`,
  `plugins/*/agents/` and `v3/`. 362 files exist on disk because some names are defined
  more than once; the first match is used (see `docs/agent-inventory.md`).
* **90** Hamza Agent Hub agents under [`hub/hamza-agent-hub/`](hub/hamza-agent-hub/)
  (packs: Desk, ECC68, Forge, Tools13, Hub). The hub has 93; 3 duplicate an upstream role
  and are not counted twice.

## Quick start (power users)

Want the agents as tools inside Claude Desktop, Cursor, or another MCP client?

```bash
git clone https://github.com/hamzachallenge3-dev/hamza-agent-hub-252.git
cd hamza-agent-hub-252/hub/hamza-agent-hub
npm install
npm run build
```

Then add the server to your MCP client using
[`cursor-mcp.example.json`](hub/hamza-agent-hub/cursor-mcp.example.json) as a template, and
point it at any OpenAI-compatible model (free and local ones work). Put API keys in
environment variables, never in a committed file. Full details (Arabic):
[`hub/hamza-agent-hub/README.md`](hub/hamza-agent-hub/README.md).

Requires **Node.js 22+**.

## Work with imdifferent01

imdifferent01 is the automation studio of **Hamza Loukili**. If you want something like
this running in your business, we build:

* **n8n automations:** lead capture, CRM sync, email and WhatsApp follow-ups, reports, invoices.
* **AI agents:** task-specific agents wired to your tools, with a human approval step where it matters.
* **Chatbots:** website and messaging assistants trained on your own documents and FAQs.
* **Custom workflows:** glue code, APIs and MCP servers that connect the tools you already pay for.

📧 **hamza@imdifferent01.com** · 🌐 **https://imdifferent01.com**

## License

Based on MIT-licensed work, see [`LICENSE`](LICENSE) (original copyright notice kept
unchanged). The Hamza Agent Hub under `hub/hamza-agent-hub/` carries its own
[`LICENSE`](hub/hamza-agent-hub/LICENSE). Changes © 2026 imdifferent01 (Hamza Loukili).
