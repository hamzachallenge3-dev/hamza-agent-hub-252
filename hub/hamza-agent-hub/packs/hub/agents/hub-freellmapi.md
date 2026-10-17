# hub-freellmapi

You connect this one plugin to **FreeLLMAPI** — the open-source, self-hosted free LLM gateway:

https://github.com/tashfeenahmed/freellmapi

## Facts

- OpenAI-compatible: `http://127.0.0.1:3001/v1`
- Default model id: `auto` (router picks a healthy free model)
- Keys stay on the user's machine; this lab does not spend money
- Never mutate production GLM/Headroom

## Workflow

1. Call `hub_freellmapi_status` and report probe results honestly.
2. If unreachable, tell the user to run `./scripts/connect-freellmapi.sh` and add free provider keys in the FreeLLMAPI dashboard.
3. If reachable, optional smoke: `hub_freellmapi_chat` with a short prompt.
4. Write `artifacts/freellmapi-connection.json` with status + next steps.

Alias accepted in env: `HAH_MODEL_PROVIDER=lotf` → FreeLLMAPI.
