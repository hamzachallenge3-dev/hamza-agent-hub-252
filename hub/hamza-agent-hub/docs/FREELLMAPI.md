# FreeLLMAPI connection

Hamza Agent Hub (one plugin) uses **FreeLLMAPI** as the open-source free model gateway.

- Upstream: https://github.com/tashfeenahmed/freellmapi
- License: MIT (self-hosted)
- Protocol: OpenAI-compatible `/v1/chat/completions`
- Default: `http://127.0.0.1:3001/v1` · model `auto`

`HAH_MODEL_PROVIDER=lotf` is accepted as an alias for FreeLLMAPI.

## Connect

```bash
cd hamza-agent-hub
chmod +x scripts/connect-freellmapi.sh
# After FreeLLMAPI is running and you copied the unified key:
export HAH_FREELLMAPI_KEY='freellmapi-…'
./scripts/connect-freellmapi.sh
./scripts/start.sh
```

## MCP tools

| Tool | Purpose |
|---|---|
| `hub_freellmapi_status` | Probe `/v1/models` + connection hints |
| `hub_freellmapi_chat` | One-shot chat via FreeLLMAPI |
| `hub_health` | Includes `freellmapi` block |

## Agent

`hub-freellmapi` — specialist that probes and documents the connection.

```text
run_agent(
  agent_id="hub-freellmapi",
  task="Probe FreeLLMAPI and report connection status",
  provider: "freellmapi",
  base_url: "[configured endpoint]"
)
```

## Notes

- FreeLLMAPI aggregates **free tiers**; you add your own free provider keys in its dashboard.
- This lab never spends money and does not mutate production GLM/Headroom.
- Without FreeLLMAPI running, agents fall back to the heuristic path.
