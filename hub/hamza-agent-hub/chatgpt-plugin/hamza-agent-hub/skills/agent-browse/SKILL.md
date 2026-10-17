---
name: agent-browse
description: Browse the full Hamza Agent Hub catalog — packs, agents, tools13, MCP tools.
---

# agent-browse

When the user asks who can do a job, what agents exist, or to search the hub:

1. Call `hub_agent_browse` with their query (or empty for everything).
2. Optionally filter with `pack` / `category`, or open one `agent_id`.
3. Present top matches with pack + why they fit.
4. Offer to `run_agent` the best match or hand off to `hub-boss`.

Use `hub_full_roster` only when a full directory dump is requested.

## English and Arabic use

Respond in the user’s language (English or Arabic). / أجب بلغة المستخدم العربية أو الإنجليزية.
Report unavailable tools as BLOCKED with setup hints. Heuristic output is an offline scaffold, not completed specialist analysis. Ask before sending messages or using external paid services.
