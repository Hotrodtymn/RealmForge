# Stage 5.2A — Local Ollama diagnostics

RealmForge can query a local Ollama instance for availability and run a bounded diagnostic generation. This is a connection foundation, not an AI Dungeon Master: no story, campaign, or session content is sent automatically.

## Server configuration

Configuration is read only by the backend. Defaults are:

| Variable | Default | Bounds / behavior |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | HTTP loopback URLs only; invalid or non-loopback values fall back to the default |
| `OLLAMA_MODEL` | `llama3.1:8b` | Configured model name; never accepted from a request |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `30000` | 100–120000 ms |
| `OLLAMA_MAX_RESPONSE_CHARS` | `1200` | 100–8000 characters; longer output is truncated |
| `OLLAMA_TEMPERATURE` | `0.2` | 0–2 |
| `OLLAMA_NUM_PREDICT` | `256` | 1–2048 generated tokens |
| `OLLAMA_NUM_CTX` | `2048` | 256–16384 context tokens |

No API key is used, no model is downloaded, and the launcher does not start Ollama. RealmForge itself continues to start when Ollama is offline. The server binds to `127.0.0.1` by default.

## Endpoints

- `GET /api/ai/health` checks Ollama's local model-tag endpoint only. It reports `connectionStatus`, configured `model`, `modelAvailable`, and a safe user-facing `error` when needed. It does not generate text or initiate a model pull.
- `POST /api/ai/test` accepts only `{ "prompt": "..." }`, with 1–300 non-whitespace characters. It uses the server-configured model/settings and returns the bounded response. The endpoint is restricted to loopback clients and does not log prompt or output content.

This is a development diagnostic without authentication. **Remove or protect `/api/ai/test` with server-side authentication and authorization before enabling LAN or remote access.** Hiding a browser control is not a security boundary.

## Manual local connection test

1. Start Ollama yourself and make sure `llama3.1:8b` is already installed (`ollama list`).
2. Start RealmForge as usual.
3. Open `http://localhost:3001/api/ai/health`; expect `connectionStatus: "online"` and `modelAvailable: true`.
4. Send a small test prompt, for example:

   ```sh
   curl -sS http://localhost:3001/api/ai/test \
     -H 'Content-Type: application/json' \
     -d '{"prompt":"Reply with a short greeting."}'
   ```

An online health response confirms the local connection/model listing only. A successful test response confirms one diagnostic generation; neither means AI Dungeon Master behavior has been implemented.
