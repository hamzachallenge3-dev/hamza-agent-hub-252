# Hamza Agent Hub — audit, repair and upgrade report

Every number here was produced by a command in this repository, and each one
names the command that produced it. Where something could not be verified on a
CPU-only box with no paid credentials, it is reported as unverified rather than
estimated.

Reproduce the whole report with:

```bash
npm install && npm run build
npm test                 # 170 tests, 10 files
npm run audit:agents     # per-agent readiness from executed tool checks
npm run benchmark        # 32 routing missions
npm run smoke:browser    # 18 live Chromium checks
npm run smoke:console -- http://127.0.0.1:8799 "$HAH_AUTH_TOKEN"
```

## 1. What was inspected

The deployed Hub source is not in `hamzaloukili/agent-core` on any branch. It
lives in a separate private repository, which Rule 4 forbids modifying. The source
at `docs@ea43560` was therefore vendored into `hamza-agent-hub/` as commit
`e7c3ed0`, verified byte-identical with `diff -r`, so every later commit is a
reviewable diff against the real deployed code and can be reverted precisely.

Inspected in full: the agent catalog (93 registrations across 5 packs), the MCP
tool surface, the Boss planner and its scoring, the task queue and executor, the
model client and its fallback behaviour, the storage schema, the Tools13 pack,
the workspace sandbox, and the shell sandbox.

## 2. What was broken, and why

Each item is the root cause, not the symptom.

**The REST surface returned 404 for every route.** `src/api/v1.ts` declares
absolute paths (`/v1/agents`), and `http.ts` mounted that router under `/v1`,
doubling the prefix. Nothing caught it because the contract tests had never been
executed against a running app. Fixed by mounting the auth and rate-limit guards
as path-scoped middleware and the router at the root.

**68 agents held tools that did not exist.** `workspace_stat` (68 agents),
`workspace_mkdir` (32) and `list_specialists` (5) were granted in the catalog but
absent from `runTool`'s dispatch, so an agent told to inspect a tree before
reading it failed on its first step with "unknown tool". The grants are
deliberate, so all three are now implemented under the same path sandbox as the
other workspace tools.

**"Tested" was a flag, not evidence.** The catalog shipped `tested: true` on 3 of
93 agents and nothing ever exercised a tool. Readiness is now derived from 26
executed smoke checks run through the same dispatch an agent uses, and every
tool without a check must name its specific blocker or a test fails.

**Routing was keyword-shaped and mis-ranked real missions.** A bare `checkout`
matched "checkout code", routing a code review to the browser; `login.py` in a
security review matched "log in"; "plan the architecture, then implement it"
dropped the implementation step because it named no noun; "clean up the list"
matched nothing at all, silently deleting the cleaning step from a business
mission; and a mission matching no intent became `plan.architecture` with no
indication that nothing had been classified. Six pattern defects plus that
shared fallback were fixed; the benchmark went from 79.2% to 100%.

**The Boss planned a decomposition and then ran one agent.** `POST /v1/missions`
queued the primary alone. Owners, dependencies and roles for the other subtasks
existed only on paper, so every multi-agent requirement in Part 2 was unmet
however good the plan looked.

**Approval gates were computed and discarded.** `checkAction` returned
`requiresApproval: true`, but callers only tested `allowed`, and uploads
additionally ran through the non-gated `click` pipeline. An upload configured to
need sign-off ran without it, and `WAITING_FOR_APPROVAL` was unreachable.

**Search results were an unwrapped injection vector.** Page text was wrapped as
untrusted; titles and snippets — authored by whoever owns the page — reached the
model unlabelled.

**The sandbox bounded time but not consumption.** A single `run_command` could
exhaust memory, spin CPU inside the timeout, fill the disk or fork-bomb the box.

**The console could read but never write.** A browser omits `Origin` on
same-origin GETs and sends it on same-origin POSTs; the guard consulted only
`HAH_ALLOW_ORIGINS`, whose default carries no port. Plan and Execute failed with
`forbidden_origin` on the Hub's own page. Found by driving the page in a real
browser, which is why `npm run smoke:console` now exists.

**Routing and the audit disagreed in public.** The console showed a plan claiming
`UNTESTED` beside an audit claiming `READY`, because the synchronous
classification fell back to the catalog flag while the audit used executed
evidence. The smoke results now live in one cache both paths read.

**The Boss reported gaps for work it had assigned.** Excluding an already-used
agent from ranking is right for parallelism, but it made a second capability
held by that same agent look missing. Subtasks now carry the further
capabilities they cover.

## 3. Files changed

56 files, +16,125 / −247 against the vendored baseline
(`git diff --stat e7c3ed0..HEAD -- hamza-agent-hub`). No file was deleted and no
agent registration was removed.

New subsystems: `src/model/providers.ts`, `src/browser/{session,actions,policy}.ts`,
`src/integrations/{types,registry,adapters,credentials,search}.ts`,
`src/api/{v1,openapi,ui}.ts`, `src/mcp/browser-tools.ts`, `src/tools/{browser,smoke}.ts`,
`src/runtime/{capabilities,constraints,states,verification,audit,benchmark,mission,approvals}.ts`.

Modified: `src/runtime/{boss,browse,executor,queue,registry}.ts`,
`src/storage/db.ts`, `src/model/{client,schemas}.ts`, `src/mcp/{http,tools}.ts`,
`src/tools/{runner,sandbox}.ts`, `src/config.ts`, `src/index.ts`.

## 4. APIs added

24 documented paths (`GET /v1/openapi.json`), all under bearer auth except the
two probes. `GET /v1/agents`, `/v1/agents/{id}`, `/v1/capabilities`, `/v1/catalog`,
`/v1/tools`, `/v1/audit`, `/v1/audit/{id}`, `/v1/integrations`,
`/v1/integrations/{id}`, `/v1/model/health`, `/v1/browser/sessions`,
`/v1/diagnostics`; `POST /v1/missions`, `/v1/missions/plan`,
`/v1/missions/{id}/cancel`, `/v1/missions/{id}/approval`, `/v1/browser/sessions`;
`GET /v1/missions/{id}`, `/{id}/result`, `/{id}/events` (SSE with `?stream=true`),
`/{id}/approval`, `/v1/artifacts/{taskId}`; `GET /health/live`, `/health/ready`.

Idempotency keys are required on mission creation, not optional. Pagination,
structured errors with recovery hints, and a redacting audit trail are uniform
across the surface. 35 MCP tools remain exposed; the ChatGPT connector handshake
is still covered by `tests/contracts.test.ts` (Rule 12).

## 5. Browser capabilities

Playwright 1.64.1 with headless Chromium — CPU-only, no Opera, no paid cloud
browser. Six MCP tools (`browser_session`, `browser_navigate`, `browser_snapshot`,
`browser_act`, `browser_extract`, `browser_screenshot`) plus the registered
`hub-web-browser` agent, kept separate from `hub-agent-browse`, which still
browses the catalog exactly as before.

Verified by `npm run smoke:browser` — 18/18 against real pages: navigation,
title and text extraction, interactive-element listing, link extraction,
screenshots, session lifecycle, and the security properties below. An action
whose stated expectation is not observed is reported `verified: false`, so a
failed click is never reported as a completed submission.

Security verified in the same run: a session without an allow list is refused;
off-allow-list hosts, loopback addresses, cloud metadata addresses and the
`file:` scheme are all blocked (SSRF); page text reaches the model wrapped as
untrusted; the audit trail redacts secrets. Profiles are AES-256-GCM encrypted
and 2FA or identity challenges stop and ask for the user.

## 6. Agents now verified operational

`npm run audit:agents`, measured from executed checks rather than the catalog
flag:

| Readiness | Count | What it rests on |
|---|---|---|
| READY | 13 | every tool it holds passed an executed check |
| LIMITED | 73 | 71 wait only on a live model; 2 on a named upstream |
| BLOCKED | 7 | upstream service not installed, named per agent |
| UNTESTED | 0 | — |

93 registered, all intact (`tests/regression.test.ts` R15). 83 agents had their
entire toolset executed, 10 had some. 26 of 44 exposed tools have an executed
check; the other 18 each name a specific blocker, and a test fails if any tool
is left uncovered without one.

The honest reading: 13 agents are proven end to end here. The 73 LIMITED are
structurally sound and their deterministic tools run, but their reasoning step
cannot be verified without a model. None of that is reported as success.

## 7. Tools13 status

13 catalogued, matching the verified baseline. 4 READY (`n8n-library`, `ecc-68`,
`scrapling`, `headroom`), 2 LIMITED (`seo-audit` — some tools executed;
`lapian-notes` — needs ffmpeg plus a workspace video), 7 BLOCKED, each naming its
upstream install URL. No limited local substitute is presented as a working
upstream integration.

## 8. Model readiness

**BLOCKED.** Five provider adapters are implemented (FreeLLMAPI,
OpenAI-compatible, Ollama, OpenRouter free tier, Hugging Face) with real health
checks, priority fallback, circuit breakers, retry and token budgeting. One is
configured (FreeLLMAPI) and its probe fails with `fetch failed` — the gateway is
unreachable from here. The other four are unconfigured and say so.

With no model, reasoning agents return a deterministic scaffold explicitly
graded `COMPLETED_LIMITED` and never `COMPLETED_VERIFIED`. No paid credits were
spent and no GPU was started.

## 9. Tests run and results

| Suite | Result |
|---|---|
| `npm test` | 170 passed, 10 files |
| `npm run benchmark` | routing 100% (32/32), tool success 100% (26/26), p95 3 ms |
| `npm run smoke:browser` | 18/18 |
| `npm run smoke:console` | passed (93 roster rows, 3 planned and 3 executed subtasks) |

By file: regression 56, tools 34, api 24, contracts 19, hub 9, approvals 8,
mission 7, benchmark 5, sandbox 4, worker 4.

All 15 mandatory Part 11 regression tests exist as named groups R1–R15 in
`tests/regression.test.ts`. Every bug listed in section 2 has a test.

## 10. Security findings

Found and fixed: the unreachable REST surface (an auth guard that never ran is
not a guard), approval verdicts computed and discarded, unlabelled search
results as an injection path, and an unbounded shell.

In place and tested: bearer auth with constant-time comparison before body
parsing; same-origin writes allowed, foreign origins refused; separate
rate-limit windows for `/v1` and `/mcp` — note these are per-process, not
per-client, so edge rate limiting is still required in front of a public
deployment; artifact serving restricted to paths a mission actually
recorded, with traversal refused; secret redaction on every event, tool log and
audit entry; credentials reported as present-or-absent, never by value;
AES-256-GCM at rest for browser profiles and the credential store; SSRF
protection by DNS resolution check; untrusted-content wrapping for both page
text and search results; soft ulimits on CPU, address space, file size, process
count and core dumps; a non-privileged sandbox user with cwd confinement;
single-use, tool-scoped, actor-accountable approvals persisted so a restart
cannot resume privileged work; per-task browser sessions released on completion.

No agent gains unlimited shell, browser or account privileges by being selected:
tool grants are per-agent, `run_command` is unavailable except on authenticated
HTTP, and mutating browser actions are policy-gated independently of selection.

## 11. Remaining blockers

1. **No live AI model.** The single largest limit. 71 agents are LIMITED solely
   because of it. Configuring any one free provider moves them without code
   changes.
2. **Search, Notion, Google Workspace and n8n are unconfigured.** Adapters are
   implemented and report exactly which variable is missing. GitHub is READY and
   reachable.
3. **FreeLLMAPI is unreachable** from this environment (`fetch failed`). Whether
   the gateway is down or merely unroutable from here is not determinable
   without network access to it.
4. **The Browser-Box tunnel (`UNAVAILABLE: Box browser unreachable`) was not
   repaired.** It is a separate connector, not part of this Hub; Part 1 D says
   to investigate only if it belongs here. `hub-web-browser` makes it
   unnecessary for web automation.
5. **No within-task checkpoints.** A task interrupted mid-run is requeued and
   restarted from the beginning, not resumed mid-step. Mission wiring,
   dependencies and pending approvals all survive a restart and that is tested;
   step-level resumption is not implemented.
6. **Concurrency is still 2.** Unchanged deliberately: Part 7 requires load
   tests before raising it, and those have not been run.
7. **Rate limiting is per-process, not per-client.** One noisy caller can
   consume the window. Edge per-client limiting is still needed in front of a
   public deployment.
8. **`WAITING_FOR_DEPENDENCY` is the only state reached indirectly.** It is set
   by the queue when it skips a blocked subtask rather than by the executor, so
   a dependant that is claimable the instant it is created never passes through
   it. The state is legal, persisted and tested; the nuance matters only if you
   are reading the state as a timeline.
9. **Deployment is unverified.** Everything here was tested against a locally
   run Hub. Nothing was deployed to `hub.imdifferent01.com`.

## 12. Rollback

Every change is additive and reversible.

- **Whole change set:** `git revert` the range, or reset to `e7c3ed0`, which is
  the byte-identical deployed baseline.
- **One subsystem:** each commit is self-contained — browser, integrations,
  REST, tools, audit, routing, security, mission orchestration.
- **Database:** all schema changes are `ALTER TABLE ... ADD COLUMN` plus two
  indexes and one new `missions` table. Old rows need no backfill and older code
  ignores the new columns, so a rollback needs no migration.
- **Behaviour:** `POST /v1/missions` with an explicit `agent_id` behaves exactly
  as before. `status` is still written alongside `state`. No agent, tool or
  config was removed.
- **Disable at runtime without reverting:** `HAH_ENABLE_SANDBOX_TOOLS=0` for the
  shell; leaving provider and integration variables unset keeps those paths
  BLOCKED rather than active.

## 13. Production readiness

**Ready to deploy as a strictly better version of what is running now; not ready
to be called autonomous.**

The platform is sound: routing is capability-based and measured, constraints
propagate, missions genuinely run multi-agent with dependencies, the state
machine distinguishes verified from limited work, the REST and MCP surfaces are
authenticated and documented, and the security controls are tested rather than
asserted. Nothing fabricates a result: with no model, agents say so.

What stops it being autonomous is item 1. Until a model provider is live, 71 of
93 agents can only run their deterministic tools, and the Hub correctly reports
that as `COMPLETED_LIMITED`. The recommendation is to deploy, configure one free
provider, re-run `npm run audit:agents` to re-measure the roster, and only then
consider raising concurrency on the evidence of a load test.
