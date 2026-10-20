# Stage 5.2B-2A — AI World Generation Foundation

## Architecture

`POST /api/ai/world/preview` is handled by the world-generation router and service. The service reuses the Stage 5.2A Ollama client and configured `llama3.1:8b` model. It sends a server-defined JSON Schema using Ollama's structured generation support, then parses and validates the returned text before responding. Generated text is treated as untrusted input.

This stage is preview-only. It does not call campaign, adventure, location, NPC, quest, scene, or session stores, and it does not write to SQLite. Stable keys in the response are references within that preview; they are not database identifiers.

## API

Loopback clients may submit:

```http
POST http://localhost:3001/api/ai/world/preview
Content-Type: application/json
```

```json
{
  "dmMode": "ai",
  "theme": "dark-fantasy",
  "worldCreation": "surprise",
  "length": "short"
}
```

A successful response includes the configured model, preview metadata (`previewOnly`, generation time, attempt count, and validated configuration), and a `preview` object with a campaign premise/setting, three locations, three NPCs, a main quest and objectives, a central mystery or threat, an opening scene, and a possible resolution. Cross-references use keys from the same response. Exactly one location is marked as the starting location.

Invalid configuration returns `400`. If output remains malformed or violates the schema after one retry, the endpoint returns `502`. Ollama timeouts return `504`; unavailable Ollama or model errors return `503`. Requests received from non-loopback addresses are rejected with `403`.

## Validation and safety

The server currently accepts only `ai`, `dark-fantasy`, `surprise`, and `short`. The configuration type is designed to extend with future values, but those values are not enabled yet. Request keys and values are checked server-side; callers cannot select another model or override the Ollama URL.

The generated response is bounded by configured character and token limits, uses a generation timeout and a shorter retry timeout, and receives at most one retry for malformed or schema-invalid output. Schema checks include required fields, string bounds, entity counts, unique non-UUID reference keys, and valid location/quest references. No application-authored fallback content is substituted if generation fails.

World-generation settings are server-side environment variables:

- `OLLAMA_WORLD_TIMEOUT_MS` (default 240000; bounded to 1000–300000)
- `OLLAMA_WORLD_RETRY_TIMEOUT_MS` (default 90000; bounded to 1000–300000)
- `OLLAMA_WORLD_MAX_RESPONSE_CHARS` (default 12000; bounded to 2000–24000)
- `OLLAMA_WORLD_NUM_PREDICT` (default 1600; bounded to 256–2048)

The shared Stage 5.2A Ollama base URL and model configuration remain in effect. No API key or automatic model download is used.

## Manual testing

1. Start Ollama locally and ensure `llama3.1:8b` is already installed (`ollama list`).
2. Start RealmForge using the existing development workflow.
3. Check `GET http://localhost:3001/api/ai/health` and confirm the configured model is available.
4. POST the example JSON above to `/api/ai/world/preview`, for example with `curl`; inspect that the returned preview has exactly three locations and NPCs, 2–3 quest objectives, a single starting location, and references that resolve within the response.
5. Repeat with an invalid value (for example `"theme":"high-fantasy"`) and confirm `400` with field details.
6. Stop Ollama and retry; confirm the endpoint returns a useful service error rather than writing data or crashing the server.
7. Compare campaign/adventure counts before and after using the existing API or local database inspection. The endpoint is not expected to alter them.

Automated tests mock Ollama and do not require a running local model. A successful mocked test does not prove the locally installed model can satisfy the schema in practice.

## Limitations and next steps

There is no frontend UI, persistence, campaign creation, adventure creation, session creation, image generation, authentication, or remote access in this stage. The endpoint is a local development diagnostic/generation surface. Before enabling LAN or remote access, add server-side authentication and authorization and review this endpoint's access policy. A later stage can add an explicit user-reviewed mapping workflow that converts preview reference keys into persisted records; this service intentionally does not perform that mapping.

Example commands:

```sh
curl -sS http://localhost:3001/api/ai/health

curl -sS -X POST http://localhost:3001/api/ai/world/preview \
  -H 'Content-Type: application/json' \
  -d '{"dmMode":"ai","theme":"dark-fantasy","worldCreation":"surprise","length":"short"}'

curl -i -X POST http://localhost:3001/api/ai/world/preview \
  -H 'Content-Type: application/json' \
  -d '{"dmMode":"ai","theme":"high-fantasy","worldCreation":"surprise","length":"short"}'
```
