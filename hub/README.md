# First agent

A [Cursor BDK](https://cursor.com) chat agent that keeps a small notebook of facts. Playground and HTTP are on. Slack, GitHub, and MCP are not wired yet.

The start message did not name a job, so this project uses the recommended first surface:

- Purpose: chat assistant
- Directory: `first-agent`
- Model: `grok-4.5` with high effort and fast sampling
- Tools: `remember` (write) and `recall` (read), stored in host KV
- Check: one smoke eval at `evals/remember.eval.ts`

## Run

Node 22.13 or newer. Do not use Bun.

```bash
cd first-agent
npm install
npm run dev
```

Open [the playground](http://127.0.0.1:4747/playground).

A model reply needs a Cursor credential. Either export `CURSOR_API_KEY` or run `npx bdk login` inside `first-agent`. Tool calls, validate, and the playground shell work without that key.

Try: “Remember that the launch code name is Harbor.” Then: “What do you remember?”

## Checks

```bash
cd first-agent
npx bdk validate --dir .
npx bdk info --dir . --json
npx bdk call remember --dir . --input '{"text":"Harbor is the launch code name"}'
npx bdk call recall --dir . --input '{}'
npx bdk eval --dir . --list
npm run check
```

`npx bdk eval --dir .` and `npx bdk run --dir . --message "..."` run a model turn and need the same Cursor credential.

## Layout

| Path | Role |
| --- | --- |
| `first-agent/bot/instructions.md` | Always-on prompt |
| `first-agent/bot/agent.ts` | Model selection |
| `first-agent/bot/tools/remember.ts` | Save one fact |
| `first-agent/bot/tools/recall.ts` | List saved facts |
| `first-agent/bot/lib/facts.ts` | Shared notebook shape |
| `first-agent/evals/` | Smoke eval |

Serve only `first-agent`. Pointing `bdk serve` at the repo root mounts every sibling directory.
