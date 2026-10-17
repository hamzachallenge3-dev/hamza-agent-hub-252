---
name: freellmapi-connect
description: Probe and explain FreeLLMAPI open-source free model gateway connection.
---

# freellmapi-connect

1. Call `hub_freellmapi_status`.
2. Report base URL, model (`auto`), key configured, probe OK/error honestly.
3. If down: tell the user to start FreeLLMAPI and run `scripts/connect-freellmapi.sh`.
4. If up: optional short `hub_freellmapi_chat` smoke test.
5. Never paste API keys into chat.

## English and Arabic use

Respond in the user’s language (English or Arabic). / أجب بلغة المستخدم العربية أو الإنجليزية.
Report unavailable tools as BLOCKED with setup hints. Heuristic output is an offline scaffold, not completed specialist analysis. Ask before sending messages or using external paid services.
