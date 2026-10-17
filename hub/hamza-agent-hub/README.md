# Hamza Agent Hub — الإضافة الواحدة

هذه **إضافة MCP واحدة** تجمع كل ما أعطيتَه في مكان واحد قابل للتشغيل:

| المصدر | أين صار داخل الإضافة |
|---|---|
| ECC68 Build Kit (68 وكيل) | `packs/ecc68/` |
| Automation Desk / Hamza Hub | `packs/desk/` + أدوات Desk |
| Cross-Forge / Plugin Builder | `packs/forge/` |
| Hub Boss Tools Recovery 13 | `packs/tools13/` |
| الموزّع الذي يعرف الجميع | `hub-boss` في `packs/hub/` |
| متصفح الكتالوج | `hub-agent-browse` + أداة `hub_agent_browse` |
| FreeLLMAPI (مجاني مفتوح المصدر) | `hub-freellmapi` + `hub_freellmapi_*` |

لا تثبّت `ecc68-lab` كإضافة منفصلة — دُمجت هنا.

## الوكلاء: 93

- **1** `hub-boss` — يعرف الدليل الكامل ويفرّق المهام على الجميع
- **1** `hub-agent-browse` — يتصفّح كل الـ packs / الوكلاء / tools13 / أدوات MCP
- **1** `hub-web-browser` — أتمتة متصفح حقيقية (Playwright + Chromium، CPU فقط)
- **1** `hub-freellmapi` — يربط FreeLLMAPI (بوابة LLM مجانية مفتوحة المصدر)
- **4** Desk
- **68** ECC
- **4** Forge
- **13** Tools13

## أدوات MCP الرئيسية

`hub_health` · `hub_list_packs` · `hub_list_agents` · `hub_full_roster` · `hub_agent_browse` · `hub_freellmapi_status` · `hub_freellmapi_chat` · `hub_boss_route` · `hub_tools13_lookup` · `run_agent` · `task_status` · `task_result` · `cancel_task` · `clean_leads` · `sheets_to_json` · `extract_contacts` · `seo_audit_html` · `forge_detect` · `github_url_tricks` · `agent_mining_queries`

## تثبيت واحد

```bash
cd hamza-agent-hub
npm install
npm run build
npm test
./scripts/start.sh
```

### Cursor (stdio) — إعداد واحد فقط

انسخ `cursor-mcp.example.json` (أو الملف في جذر المستودع `cursor-mcp.hamza-agent-hub.example.json`) إلى إعدادات MCP، واستبدل المسار المطلق، ثم أعد تحميل MCP.

```json
{
  "mcpServers": {
    "hamza-agent-hub": {
      "command": "node",
      "args": ["--experimental-sqlite", "/ABS/hamza-agent-hub/dist/index.js"],
      "env": { "HAH_TRANSPORT": "stdio", "HAH_CONCURRENCY": "2" }
    }
  }
}
```

## تجربة التوزيع

```text
run_agent(
  agent_id="hub-boss",
  task="SEO audit + clean leads + security review login.py",
  workspace_id="one",
  idempotency_key="one-plugin-1"
)
```

الـ boss يكتب:
- `artifacts/hub-full-roster.md` — كل الوكلاء الذين يعرفهم
- `artifacts/hub-routing-plan.json` — من اختار ولماذا

## تصفّح كل شيء (agent browse)

```text
hub_agent_browse(query="SEO security leads")
# أو
run_agent(
  agent_id="hub-agent-browse",
  task="browse SEO and security agents",
  workspace_id="browse",
  idempotency_key="browse-1"
)
```

يعيد packs + agents + tools13 + MCP tools، ويكتب `artifacts/agent-browse.md`.

## FreeLLMAPI (النموذج المجاني مفتوح المصدر)

```bash
# 1) شغّل FreeLLMAPI محلياً (انظر docs/FREELLMAPI.md)
# 2) اربط الإضافة:
export HAH_FREELLMAPI_KEY='freellmapi-…'
./scripts/connect-freellmapi.sh
./scripts/start.sh
```

أو في `.env`:
```
HAH_MODEL_PROVIDER=freellmapi   # alias: lotf
HAH_FREELLMAPI_URL=http://127.0.0.1:3001/v1
HAH_FREELLMAPI_MODEL=auto
HAH_FREELLMAPI_KEY=freellmapi-…
```

أدوات: `hub_freellmapi_status` · `hub_freellmapi_chat`  
دليل: [`docs/FREELLMAPI.md`](docs/FREELLMAPI.md)

## حدود صريحة

- مختبر جديد — لا يعدّل إنتاج Hamza Agent Hub ولا GLM/Headroom الإنتاجي
- بدون FreeLLMAPI / `HAH_MODEL_URL` النموذج الحي = BLOCKED (المسار heuristic يعمل للاختبار)
- أوزان GLM/Kimi غير مضمّنة (روابط فقط في `packs/tools13/MODELS.md`)

## ChatGPT / Codex store plugin

Package for the ChatGPT + Codex Plugin Directory:

```bash
./scripts/pack-chatgpt-plugin.sh
# → chatgpt-plugin/release/hamza-agent-hub-chatgpt-plugin.zip
```

- Package source: `chatgpt-plugin/hamza-agent-hub/`
- **Give to Codex in ChatGPT:** paste [`CODEX-HANDOFF.md`](CODEX-HANDOFF.md) (or [`GIVE-TO-CODEX.txt`](GIVE-TO-CODEX.txt))
- Store checklist: [`docs/CHATGPT-STORE.md`](docs/CHATGPT-STORE.md)

## Operator console and REST API

With `HAH_TRANSPORT=http`, the Hub serves a self-contained console at `/ui` — no
bundler, no CDN, nothing fetched from a third-party origin. Paste the API token
and it shows Boss status, the measured roster, model and browser readiness, API
integrations, live mission progress with the agent currently working, blockers,
and downloadable verified outputs. The full flow is Prompt → Plan → Execute →
Verify → Download.

It is a thin client over `/v1`, so it can never show a status the API would not
also report. The documented contract is at `GET /v1/openapi.json` (24 paths).

`POST /v1/missions` without an `agent_id` runs the whole Boss decomposition: one
task per subtask, wired to the dependencies the plan declared and assembled into
one report. Naming an `agent_id` runs that agent alone, as before.

## Verification

```bash
npm test                 # unit, integration, contract and security tests
npm run audit:agents      # per-agent readiness from executed tool checks
npm run benchmark         # routing accuracy over representative missions
npm run smoke:browser     # live headless Chromium checks
npm run smoke:console -- http://127.0.0.1:8799 "$HAH_AUTH_TOKEN"
python3 packs/tools13/scripts/verify_bundle.py
./scripts/pack-chatgpt-plugin.sh
```

Readiness is measured, not declared: an agent is READY only when the tools it
holds passed a check that actually executed, and every tool without one names
its specific blocker. See [`docs/ENGINEERING-REPORT.md`](docs/ENGINEERING-REPORT.md)
for the current counts and the commands that produced them.

## Release 1.2.0 strengthening

The hub now has a Cloudflare edge proxy and Python entrypoint sharing the same Node roster, stateless authenticated HTTP MCP, bounded retries/dead letters, terminal cancellation, safe workspace paths, five additional tools, MCP resources/prompts, and deterministic secret-free packaging. Boss dispatch queues real specialist child tasks; heuristic completion is an offline scaffold.

Read [deployment](deploy/README.md), [store readiness](docs/CHATGPT-STORE.md), and [validation](docs/VALIDATION.md). Public upload remains blocked until a verified, appropriately authenticated public endpoint and portal review exist. The rebuilt ZIP is a private setup scaffold.
