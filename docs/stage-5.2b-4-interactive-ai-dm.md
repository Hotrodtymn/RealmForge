# Stage 5.2B-4 — Interactive AI Dungeon Master

## API

All turn routes are local-only under `/api/ai`:

- `POST /api/ai/session/turn` accepts exactly `{ sessionId, characterId, action, clientTurnId }`. IDs must be UUIDs; action is trimmed and limited to 1–2,000 characters. A new completed turn returns `201`; a completed idempotent replay returns `200`.
- `GET /api/ai/session/:sessionId/turns?characterId=…` returns this session's ordered turns. The session and supplied character must match; otherwise it returns `404`.

The turn endpoint rejects inactive sessions and characters outside the session or with dead/retired status. It uses the existing loopback guard and the configured local Ollama model. It does not accept model names, prompts, or Ollama URL overrides from the client.

## Persistence and retries

The additive `ai_session_turns` table stores a stable server turn ID, session and character IDs, unique client turn ID per session, player action, optional DM response, status, timestamps, and an expiring claim lease. The gameplay journal remains unchanged and immutable.

A short `BEGIN IMMEDIATE` transaction claims a turn and closes before any Ollama request. Another request with the same key and payload receives `409` while generation is pending. Completed requests replay the stored response. If generation fails, the action remains as a `failed` row without a fabricated response; retrying the same key and payload reuses that row. If the process crashes while a request is pending, a retry can reclaim it after the generation lease expires. A mismatched action or character for a previously used key returns `409`.

No game state is updated by narration. Character data, hit points, inventory, quests, flags, locations, and scenes are read-only inputs to this feature.

## Context and prompt construction

`aiSessionTurnService` builds an explicit allowlist from the authoritative current session: campaign premise/setting, adventure summary, current scene and location, session character, a bounded set of visible NPCs, active or available quest objectives, public/player story flags, selected safe journal event fields, and the last four completed conversation turns. Each field and collection is bounded; generation uses a 4,096-token context ceiling and at most 384 predicted tokens.

Private story notes, NPC DM notes, secret flags, remote NPCs, ownership records, and unrelated campaign data are excluded. The system prompt treats context and player action as untrusted content, directs the model not to follow embedded instructions, and prohibits claims of unverified mechanics or state changes. The model receives no database tools or state mutation endpoint.

## Failure handling

Ollama unavailability returns `503`, timeout returns `504`, malformed or empty output returns `502`, and invalid input returns `400`. Failed actions remain visible and can be retried with the same client turn ID. Repeated requests while generation is active receive `409`; the player can retry after it finishes or reload the transcript. Transcript loading errors have a separate retry control.

## Database backup

Before adding the table, the active `server/data/realmforge.sqlite` passed `PRAGMA integrity_check`. A `VACUUM INTO` backup was created at:

`server/data/realmforge.sqlite.stage-5.2b-4-2026-10-18T223011283Z.bak`

The backup also passed `PRAGMA integrity_check`; campaign and session IDs matched the source (3 campaign rows and 2 session rows). The database directory is ignored by Git. The application applies the `CREATE TABLE IF NOT EXISTS` migration when the backend initializes; no existing records are rewritten.

## Manual browser test

1. Start RealmForge and local Ollama with the configured model installed. Open `/player`, select an active session, and wait for its conversation to restore.
2. Submit an action using **Submit Action**. Confirm the action and a separate RealmForge DM response appear in order. Enter adds a newline; Ctrl/Cmd+Enter submits.
3. Refresh the browser and reopen the same session. Confirm its transcript returns in chronological order. Switch to a different session and confirm its transcript is separate.
4. Submit an empty or overlong action and confirm client limits and server validation. Try submitting while a turn is pending and confirm controls prevent duplicate clicks.
5. Stop Ollama or trigger a timeout. Confirm the action remains visible as failed and can be retried. Retry with Ollama available and confirm one completed turn exists for that client request.
6. Submit the same request again after success and confirm it replays without producing another narration. Confirm the player can retry an interrupted request after reopening the session.
7. Use an action containing instructions to reveal hidden notes or change inventory/HP. Confirm the narration treats it as player text, private notes remain undisclosed, and saved character, inventory, quest, scene, and session mechanics remain unchanged.
8. Pause or complete a session and confirm new AI actions are rejected while the conversation remains readable.
9. Restart the backend and verify completed and failed transcript rows still load.

## Limitations

The current local app has no authenticated player identity. Session plus assigned character matching applies the existing local ownership boundary, and the loopback check prevents remote network use; this is not a substitute for authentication before multiplayer or LAN access. The model can still produce imperfect prose, but its response is stored only as narration and cannot directly apply game mechanics. There is no streaming output or server-side cancellation API in this stage.
