# Stage 5.2C-1 — Persistent Story Memory

## Architecture and data model

Story memory is separate from the immutable session journal and the `ai_session_turns` transcript. On backend initialization, SQLite additively creates `story_memories`, `story_memory_events`, and `story_memory_extractions`; no existing campaign, adventure, session, character, journal, or transcript row is rewritten.

Each memory is scoped to one campaign, adventure, and session and records a stable ID, category, concise statement, verification status, optional NPC/location/quest references, source turn, exact supporting quote, lifecycle status, and timestamps. Verification values are `observed`, `npc_claim`, `player_assertion`, and `uncertain`. Extracted memories are never marked authoritative. Categories include discoveries, NPC statements, relationships, promises, mysteries, environmental developments, player assertions, and other narrative events.

`story_memory_events` is append-only. It records creation, reinforcement, supersession, and retraction with source turn and evidence. Memories are never physically deleted. An explicit supported correction can supersede an active memory; a supported retraction marks it retracted. Otherwise, contradictory claims remain separate records rather than silently replacing one another. An active partial unique index plus a normalized hash deduplicates equivalent statements within the same adventure and session.

## Extraction and validation

After a turn's narration is stored, a queued extraction job is created in the same short SQLite transaction. A background task claims the job with an expiring lease, then calls the configured local Ollama model using JSON-schema constrained output. It uses the completed action and narration, up to eight active memories, and an allowlist of visible NPCs, the current location, and current quests. It does not receive private NPC notes, story notes, hidden flags, character journals, or unrestricted database rows.

The output is capped at four candidate memories and three retractions. The server parses the JSON, checks exact allowed fields and categories, limits statements and evidence quotes, requires each quote to occur in the original action or narration, rejects mechanical claims, resolves related IDs against the session's allowlist, and verifies supersession/retraction targets. SQLite triggers additionally enforce source session, campaign, adventure, and related entity scope. Quotes and extracted prose remain untrusted narrative data; this validation does not prove semantic truth. NPC claims stay labeled as claims, player assertions stay assertions, and uncertain details remain uncertain.

Extraction runs outside the turn response path and never holds a database write transaction while waiting for Ollama. Its generation timeout is configured by `OLLAMA_MEMORY_EXTRACTION_TIMEOUT_MS` (default 180,000 ms; accepted range 1,000–300,000 ms), independently of `OLLAMA_NARRATION_TIMEOUT_MS`. The timeout applies to the generation request; Ollama's model availability probe uses `OLLAMA_REQUEST_TIMEOUT_MS` (default 30,000 ms; maximum 120,000 ms). Context remains bounded to 12,000 characters, output is capped at 6,000 characters and **768 predicted tokens**, and retries are limited to 20 attempts.

The extraction lease is calculated from the configured extraction timeout plus the Ollama request timeout and a 30,000 ms safety margin. This covers the sequential health probe, generation request, context preparation, and cleanup without relying on a fixed lease when timeout settings change. SQLite claim transactions and an in-process active-job guard prevent duplicate concurrent processing of the same turn. A process interruption leaves a leased job that becomes retryable after the lease expires; failed jobs can also be retried from the DM journal's Story Memory section. A failed generation writes no candidate memories. A completed extraction is idempotent; duplicate statements become reinforcement events.

The Ollama response exposes its `done_reason`, response character count, output-token count, and whether the response exceeded the application character limit. Extraction rejects output stopped for length or clipped at 6,000 characters before attempting strict JSON parsing. Failures remain retryable and do not write candidate memories. Diagnostics distinguish timeout, output truncation, malformed JSON, schema-invalid JSON, and invalid evidence/provenance. A valid empty result (`memories: []`, `retractions: []`) completes successfully. Retries reuse the source turn and existing extraction row, but rebuild the prompt from current session context and active memories.

Concise backend diagnostics record extraction start, health-check and generation request durations, successful completion, failure classification, response character/token counts, truncation state, and Ollama timing fields when returned. Prompts, player actions, narration, generated memory text, and campaign details are not logged. Extraction and narration still share the local Ollama model and may overlap; separate completed turns can also extract concurrently. A busy machine can make requests slower. Structured generation can still return malformed or schema-invalid output even with a larger token budget; failed jobs remain available for manual retry.

## Retrieval and privacy

The next AI narration receives up to six active memories from the exact session, prioritizing memories related to the current NPC/location, then mysteries, promises, discoveries, and recency. The full serialized context is capped at 12,000 characters; older conversation, journal events, flags, and lower priority memories are trimmed first. The system prompt explicitly treats memory as private continuity notes rather than authoritative facts.

The read-only Story Memory panel appears in the DM session journal. It shows statements, category, verification status, related entity, source timestamp, evidence, lifecycle, history, and retryable extraction failures. Player-facing endpoints do not return memories. The local app has no authentication or roles, so the DM-only presentation and loopback restriction are not authorization boundaries; do not expose RealmForge to LAN or the internet until server-side authentication and authorization exist.

## API

- `GET /api/ai/session/:sessionId/memories?characterId=:characterId` returns the selected session's private memories, event history, and queued/running/failed extraction issues. Session and character must match.
- `POST /api/ai/session/:sessionId/memories/:turnId/retry?characterId=:characterId` retries extraction for a completed turn. It is loopback-only and session/character scoped. A currently leased job returns `409`; unavailable Ollama or invalid structured output leaves a retryable failed job.

Both endpoints use the existing loopback helper. The normal `POST /api/ai/session/turn` contract remains unchanged; completed turns are enqueued automatically. No gameplay state endpoint is called.

## Backup and migration

Before editing the active database, its integrity check returned `ok`; it contained 3 campaigns, 3 adventures, 2 sessions, and 3 characters. A fresh verified `VACUUM INTO` backup is:

`server/data/realmforge.sqlite.stage-5.2c-1-20261018T225106223Z.bak`

The backup also passed `PRAGMA integrity_check` and retained those record counts. The `server/data/` directory is Git-ignored. The production database migration is applied additively when the backend initializes; no reset or reseed is used.

## Manual verification

1. Start Ollama with the configured model installed, start RealmForge, open `/player`, and continue an active session.
2. Submit an action that elicits a durable fact or an attributed NPC statement. Confirm the player action and DM response still complete even if extraction is slow or Ollama is unavailable.
3. Open `/dm`, select the campaign/adventure, then **Journal** and the session. Confirm the private Story Memory panel shows the extracted memory, source turn, evidence quote, category, and verification status. An NPC statement should remain labeled `NPC claim`.
4. Refresh the DM page and backend. Confirm the memory and lifecycle history persist. Switch to another session and confirm its memory list is separate.
5. Continue the player session. Confirm relevant stored memory appears in subsequent narration context while the player-facing API response does not contain the private memory list.
6. Stop Ollama or return malformed JSON from a test/mock model. Confirm the turn remains completed, the extraction issue is shown, and **Retry extraction** can recover the job once Ollama is available.
7. Test a duplicate memory, a conflicting claim, an explicit correction, and a retraction. Duplicates should reinforce; conflicts should remain visible; corrections should create a supersession event; retractions should retain the old record and add a retraction event.
8. Compare the character sheet, inventory, quest/flag state, scene, and session before and after narration/extraction. They should remain unchanged.

## Limitations

Extraction is probabilistic. Exact source quotes and reference checks reject many unsupported outputs but cannot establish semantic entailment, so memory remains a private, non-authoritative DM aid. Retrieval is restricted to the same session in this stage; cross-session campaign memory is not shared. No manual memory editing UI, NPC/location/quest creation, dice, combat, or automatic game-state updates are implemented. A process interruption leaves a leased job that can be retried after its lease expires.
