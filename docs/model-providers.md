# Model providers

Ruflo can call more than one model API. When `ruflo.settings.json` exists (or `.ruflo/settings.json`, or the file named by `RUFLO_SETTINGS`), that file is the configuration. The list order is the fallback order.

Copy the example and edit it:

```bash
cp ruflo.settings.example.json ruflo.settings.json
```

`ruflo.settings.json` is gitignored. Put secrets in the environment and refer to them as `"apiKey": "env:GROQ_API_KEY"` or `"${GROQ_API_KEY}"`. A loopback OpenAI-compatible server, such as Ollama on `127.0.0.1`, does not need a key.

## Presets

| id | protocol | default base URL |
| --- | --- | --- |
| `openai` | OpenAI chat completions | `https://api.openai.com/v1` |
| `groq` | OpenAI-compatible | `https://api.groq.com/openai/v1` |
| `openrouter` | OpenAI-compatible | `https://openrouter.ai/api/v1` |
| `ollama` | OpenAI-compatible | `http://127.0.0.1:11434/v1` |
| `together` | OpenAI-compatible | `https://api.together.xyz/v1` |
| `deepseek` | OpenAI-compatible | `https://api.deepseek.com/v1` |
| `mistral` | OpenAI-compatible | `https://api.mistral.ai/v1` |
| `gemini` | Gemini `generateContent` | `https://generativelanguage.googleapis.com` |
| `anthropic` | Anthropic Messages | `https://api.anthropic.com` |

Any other OpenAI-compatible server is a provider with `"protocol": "openai"` and your own `baseUrl`. A base URL that already ends in `/v1` is not given a second `/v1`.

```json
{
  "version": 1,
  "fallbacks": true,
  "providers": [
    { "id": "ollama", "preset": "ollama", "model": "llama3.2" },
    { "id": "groq", "preset": "groq", "apiKey": "env:GROQ_API_KEY" }
  ]
}
```

The first provider that is enabled and reachable answers. A network error, timeout, 401, 403, 404, 408, 429, or 5xx tries the next provider. A 400 that is not about the model name does not, because the prompt itself was rejected.

`"fallbacks": false` tries only the first provider (or the provider id you passed).

`agent spawn --provider groq` tries that id first, then the rest of the file when fallbacks are on. Without this file, the built-in path still understands `anthropic`, `openrouter`, and `ollama` from environment variables and `claude-flow.config.json`.

Logical names such as `sonnet` or `haiku` use the `model` of whichever provider actually runs. They are not sent to Ollama or Groq as Claude model ids.
