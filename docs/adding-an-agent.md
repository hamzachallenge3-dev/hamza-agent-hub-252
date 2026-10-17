# Adding an agent

An agent in this tree is a markdown file. The frontmatter names it. The body is the system prompt sent on `agent_execute`. Declared tools are a request to the host (for example Claude Code). This harness does not run those tools by itself.

Create one from the template:

```bash
node scripts/new-agent.mjs migration-reviewer "Reviews SQL migrations for unsafe changes"
```

That writes `.ruflo/agents/migration-reviewer.md`. Files there override a shipped agent with the same `name`. Edit the body so it says what the agent should do, then spawn it:

```bash
npx ruflo agent spawn -t migration-reviewer --provider ollama
```

The type does not have to be one of the original fifteen names. It must start with a letter and use only letters, numbers, hyphens, and underscores. A few shipped prompts use a display name with spaces (for example `Benchmark Suite` in `benchmark-suite.md`). Spawn those by the filename: `-t benchmark-suite`.

You can also drop a JSON file in the same directory:

```json
{
  "name": "migration-reviewer",
  "description": "Reviews SQL migrations for unsafe changes",
  "instructions": "You review SQL migrations. Quote the statement you are worried about and say why. If you see no problem, say so in one sentence."
}
```

Shipped prompts live in `.claude/agents/**` and `plugins/**/agents/**`. The `v3` packages also keep their own `.claude/agents` copies, and some of those files differ from the root copies. Same `name` in more than one file: `.ruflo/agents` wins, then `.claude/agents`, then plugins, then the package copies. The others stay on disk for their original Claude Code plugins.

Minimum shape:

```markdown
---
name: migration-reviewer
description: Reviews SQL migrations for unsafe changes
---

You review SQL migrations. Quote the statement you are worried about and say why.
If you see no problem, say so in one sentence.
```

`instructions` in JSON, and the markdown body, need to be at least a short paragraph. A name and a description are required.
