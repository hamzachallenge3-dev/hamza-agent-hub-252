# ChatGPT and Codex directory readiness

Release 1.2.0 is a private setup scaffold with tested source. It is **not yet approved or ready to upload publicly**.

| Requirement | Status | Evidence or blocker |
|---|---|---|
| One installable plugin | Done | `hamza-agent-hub`; 92 agents in five packs; ecc68-lab remains a redirect |
| Portable manifest + compatibility overlay | Done | Agent Plugins 1.0 root manifest; synchronized identity/version; subtitle ≤30 chars; three default prompts |
| App binding | Blocked | `.app.example.json` is an unverified template, excluded from ZIP. Obtain a real technical app ID after private MCP connection; never invent one |
| 25 annotated tools (+ `run_command` on secret-path HTTP) | Done locally | Stdio/base catalog is 25; authenticated HTTP adds sandbox `run_command` |
| Resources and prompts | Done locally | `hub://roster`, `hub://capabilities`, `route_mission` |
| Worker + Python origin | Done locally | Tested proxy and Python-to-Node integration; not deployed |
| Always-on origin | Blocked | Needs an account-provisioned free host and private deployment secrets; Kaggle sleeps |
| Auth for public users | Blocked | Capability-path deployment is private and single tenant; obtain accepted auth and tenant isolation for directory distribution |
| Verified public MCP endpoint | Blocked | No live credential-free public `/mcp` endpoint verified; public pack fails closed |
| Domain verification | Code done; live blocked | Challenge endpoints implemented. Needs portal token + authorized staging/production deployment |
| Five positive + three negative test cases | Done locally | `tests/contracts.test.ts` through actual MCP client, not direct helper calls; see `VALIDATION.md` |
| Live ChatGPT host cases | Blocked | Custom connection and portal access needed; local tests do not prove host acceptance |
| Secret-free deterministic ZIP | Done | Allowlist pack, symlink/secret rejection, archive inspection tests |
| Listing copy and logo | Prepared | Manifest and existing SVG; policy/terms point at this PR branch. Use stable release URLs after merge |
| Demo recording | Script prepared; recording blocked | Needs live private connection and a recording environment; script below |
| Verified identity / portal upload / review / publish | Blocked | Requires developer portal identity and accepted endpoint; no submission performed |

## Private connection and scaffold

See `../deploy/README.md`. Private URL shape:

`https://hub.imdifferent01.com/<HUB_SECRET>/mcp`

Set `HAH_MCP_URL` privately in clients supporting environment substitution. The archive's `${HAH_MCP_URL}` is a setup placeholder, not a verified endpoint. For a ChatGPT custom connection, configure the private URL directly in the connection UI; do not put it in a public artifact. If using portal auth type “none” with the path capability for a private connection, the secret path is still a credential. Host acceptance has not been tested. Public auth must be reviewed separately.

```bash
npm run pack:chatgpt
# chatgpt-plugin/release/hamza-agent-hub-chatgpt-plugin.zip
# Explicitly marked SETUP-REQUIRED; no app binding or credential inside.
```

For a **public** export, first obtain and verify a credential-free HTTPS `/mcp` endpoint, compatible auth, privacy policy, and tenant isolation. Set `HAH_PUBLIC_MCP_URL` and `HAH_PUBLIC_ENDPOINT_VERIFIED=1` privately, then run `npm run pack:chatgpt -- --public`. The script refuses path capabilities, queries, userinfo, and unverified URLs. This operator attestation is not a substitute for live ChatGPT and portal review. Never pass `HUB_SECRET` as a publish-time public endpoint substitution.

The personal/workspace `.app.example.json` remains outside every release ZIP. If the portal supplies a verified app binding, keep that in a separate private install copy; public packages exclude `.app.json` and all apps declarations.

## Review test cases

Positive: health returns 92 agents; SEO browse includes the specialist; security routing chooses `ecc-security-reviewer`; supplied HTML receives an SEO score; duplicate email input produces one lead.

Negative: unknown agent returns `isError`; missing task returns `isError`; unavailable FreeLLMAPI returns `isError` without invented success. Additional checks cover unsafe paths, symlinks, lookalike origins, missing auth, rate limits, and bounded retries.

Repeat these through the live ChatGPT connection before submission. Record model readiness truthfully: offline heuristics produce scaffolds, not completed specialist reviews. Unsupported Tools13 integrations report BLOCKED and manual install hints; local alternatives are labeled as alternatives to upstream tools.

## Demo recording script (60–90 seconds)

1. Start with the plugin name and show all five packs with agent browse.
2. Ask in Arabic: “تنظيف البريد ثم تحسين محركات البحث ثم مراجعة أمان”. Show specialist decomposition.
3. Clean a duplicate **synthetic** email list and audit supplied demo HTML.
4. Queue `hub-boss`; poll status and show actual child task IDs and evidence. Say explicitly if the live model is unavailable and the output is an offline scaffold.
5. Show a rejected invalid agent and sanitized edge-health response.
6. Finish with privacy/terms and the real limitations: no paid calls, no automated posting, unsupported upstream runners require setup.

Hide the connector URL, browser address bar, developer tools and logs. Use synthetic data only.

Official guidance: https://developers.openai.com/plugins/build/plugins and https://developers.openai.com/plugins/deploy/submission . Review the current portal requirements before upload; this PR does not claim public approval.
