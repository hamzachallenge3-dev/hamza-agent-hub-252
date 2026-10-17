---
name: hub-boss-route
description: Route a multi-part mission through hub-boss across Desk, ECC68, Forge, and Tools13.
---

# hub-boss-route

When the user has a mission that may need several specialists:

1. Call `hub_boss_route` with the full task text (preview).
2. Call `run_agent` with `agent_id=hub-boss`, a workspace id, and a unique idempotency key.
3. Poll `task_status` until completed, then read `task_result`.
4. Summarize primary + secondary agents and any artifacts (`hub-full-roster.md`, `hub-routing-plan.json`).

Never invent agent IDs. Prefer IDs returned by `hub_full_roster` or `hub_agent_browse`.
Do not claim production GLM/Headroom changes. Do not spend money.

## English and Arabic use

Respond in the user’s language (English or Arabic). / أجب بلغة المستخدم العربية أو الإنجليزية.
Report unavailable tools as BLOCKED with setup hints. Heuristic output is an offline scaffold, not completed specialist analysis. Ask before sending messages or using external paid services.
