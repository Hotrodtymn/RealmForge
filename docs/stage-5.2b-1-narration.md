# Stage 5.2B-1 — AI Dungeon Master narration

This stage adds read-only, server-side scene narration through the existing local Ollama service. It is a narration primitive, not a full AI Dungeon Master: the model does not resolve actions, make rules decisions, change game state, or continue scenes automatically.

## Architecture

- `server/src/narrationRoutes.ts` validates the request and applies the loopback-only guard.
- `server/src/narrationService.ts` resolves the session and current scene, builds a bounded prompt from authoritative stored state, and calls the existing Ollama service.
- `server/src/loopback.ts` shares the local-client check with the Stage 5.2A diagnostic route.
- `server/src/adventureSessionStore.ts` remains the source for current session/scene and player-visible context. `campaignStore.getCampaign` was added for a scoped campaign lookup.
- `server/src/ollamaConfig.ts` adds `OLLAMA_NARRATION_TIMEOUT_MS`; the existing diagnostic timeout is unchanged.

No schema migration or narration persistence was added.

## Request and response

`POST /api/ai/narrate` is loopback-only. The JSON body must contain exactly four UUID identifiers:

```json
{
  "campaignId": "<campaign UUID>",
  "adventureId": "<adventure UUID>",
  "sessionId": "<session UUID>",
  "sceneId": "<current scene UUID>"
}
```

The session must belong to the campaign and adventure, be `active`, and the supplied scene must be its current scene. Invalid identifiers return `400`; nonexistent or mismatched records return `404`; paused/completed sessions or a noncurrent scene return `409`. Ollama timeouts return `504`, and unavailable/missing-model or malformed generation failures return safe `503`/`502` responses.

Successful response:

```json
{
  "model": "llama3.1:8b",
  "narration": "Mist drifts across the road as the old bell rings once.",
  "identifiers": {
    "campaignId": "<campaign UUID>",
    "adventureId": "<adventure UUID>",
    "sessionId": "<session UUID>",
    "sceneId": "<scene UUID>"
  }
}
```

The output is subject to the existing `OLLAMA_MAX_RESPONSE_CHARS` limit. Generated narration is not stored.

## Context and privacy boundary

The server, not the request body, supplies all world facts. The prompt includes bounded campaign/adventure names and descriptions, the current scene and location, the player's character name/species/class, NPCs located at the current scene location, active quests and their objectives, `public_`/`player_` story flags, and recent player decisions.

It excludes NPC `dmNotes`, non-public story flags, private story notes, unrelated NPCs, character ability scores, and private override reasons. The prompt explicitly treats stored campaign text as untrusted reference data and tells the model not to follow instructions embedded in it. Prompt instructions reduce risk but cannot guarantee model behavior.

The narration call performs reads only. It does not update scenes, journal entries, decisions, characters, quests, flags, locations, or NPCs.

## Configuration and timeout

The existing server-side Ollama settings remain in effect: loopback base URL, configured model (default `llama3.1:8b`), generation settings, and maximum response size. Narration uses a separate timeout:

- `OLLAMA_NARRATION_TIMEOUT_MS`: default `180000` (3 minutes), bounded to 1,000–300,000 ms.
- `OLLAMA_REQUEST_TIMEOUT_MS`: remains the timeout for health and Stage 5.2A diagnostic requests.

No model is downloaded and the launcher does not start Ollama. Requests are cancellable when their timeout expires.

## Manual test

1. Start Ollama yourself and confirm `llama3.1:8b` is installed.
2. Start RealmForge and create or select an active campaign/adventure with a location, then start an active session.
3. Read the active session from `GET /api/campaigns/{campaignId}/sessions/{sessionId}` and copy `session.currentSceneId`.
4. Send the four IDs to `POST http://localhost:3001/api/ai/narrate` with the JSON shape above.
5. Confirm the response has the configured model, a narration string, and matching identifiers. Repeat with a mismatched scene ID (expect `409`), a paused session (expect `409`), and Ollama stopped (expect a safe `503`).
6. Read the session again and confirm the scene, journal, decisions, and status are unchanged.

This endpoint is strictly local-only but has no authentication. Loopback access is not a production authorization system. Protect or remove the endpoint before enabling LAN or remote access.

## Limitations and next stage

Narration is generated on demand and is not persisted. It does not interpret player actions, call checks or combat rules, advance a scene, maintain long-term model memory, or guarantee factual adherence. Stage 5.2B-2 can add player-action handling and continuity only after authoritative action resolution and persistence rules are defined.
