# ECC 68 — Full Cursor Build Brief
هذه حزمة بناء وليست إضافة مثبتة أو متصلة. ملفات profiles هي مهارات ChatGPT الحالية؛ لا تتضمن محرك وكلاء مستقل.
افتح المجلد في Cursor وأعطه التعليمات التالية كاملة.

Build one real authenticated MCP plugin with all 68 ECC roles in agents.json. Reuse the existing Boss Plugin Hub project when located; otherwise work in an isolated ecc68-lab. Preserve all originals and do not change production Hamza Agent Hub or GLM/Headroom settings.

## Profiles
Read all 68 profiles. Each includes its upstream source URL. Fetch full upstream role definitions, pin their commit, and preserve attribution and the actual license. The bundled wrappers are not full upstream definitions. Report inaccessible sources instead of inventing instructions.

## Implementation
Use one shared CPU runtime, default concurrency 2, and an already configured explicitly free model endpoint. No spending, paid API calls, GPUs, Hermes, or VM starts. Load secrets only from server-side environment/secret storage. If no free endpoint exists, mark live execution blocked.
Provide MCP tools:
- list_agents(): exactly 68 unique IDs, description, tools, model readiness, tested status.
- run_agent(agent_id, task, workspace_id, idempotency_key): validates inputs and returns durable task_id.
- task_status(task_id): queued/running/completed/failed/cancelled with real progress.
- task_result(task_id): output, evidence, tool log and artifacts.
- cancel_task(task_id): stops actual execution.
- health(): runtime/model/storage readiness without secrets.

Implement a genuine iterative execution loop: role instructions plus task/context -> model call -> permitted tool execution -> inspect result -> continue -> evidence-based answer. Returning a prompt or canned answer is not independent execution.
Use SQLite durable jobs/events, isolated task workspaces, restart recovery, step/time limits, rate-limit handling, bounded retries, cancellation, idempotency and secret-redacted logging.
Grant tools by role. Restrict filesystem access to assigned workspaces; enforce permissions; block path traversal and arbitrary host command execution. No payments or unauthorized outgoing messages/publication.
Confirm current official MCP transport and target environment's plugin packaging/install schema before producing integration files. Do not invent installer formats or claim uploading this ZIP connects anything. Localhost for development; authenticated HTTPS for remote connection.

## Required deliverables
Runnable source, pinned dependencies/lockfile, environment template without keys, startup script, Arabic README, validated connection instructions and a truthful per-agent test table.

## Tests
Validate exactly 68 unique registry entries and all profiles readable.
Test queue state transitions, invalid agent/task inputs, idempotency, restart recovery, cancellation, tool permission enforcement, timeouts and secret redaction.
Create a representative role-specific fixture for EVERY agent with objective assertions. Do not reuse one generic test for all roles.
Separate profile-load PASS, mocked orchestration PASS, live model PASS and specialist-tool PASS. Missing models/compilers/tools = BLOCKED.
Execute one real end-to-end task with a tool invocation and artifact, then test all 68 using the free endpoint within rate limits. Record actual evidence; no invented test passes.
Save checkpoints and all deliverables before reporting. Report the exact connection URL only if actually configured.

## Verified prior state
2026-10-13: 68 installed skills loaded successfully. A ChatGPT code-review demonstration passed four Python checks. This does not prove 68 independent workers or Boss Hub connection.

