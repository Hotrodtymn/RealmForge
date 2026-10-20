# Stage 5.2C-2A — AI World Expansion Proposals

## Architecture

`POST /api/ai/world/expand/preview` is a loopback-only, read-only endpoint. The route validates identifiers, then `worldExpansionService` verifies the session through the existing session/character ownership lookup, confirms the session belongs to the requested adventure, and reads campaign, adventure, world entities, recent completed turns, and active story memories through the existing stores. It constructs a bounded, allowlisted context and asks the configured local Ollama model for structured JSON. The dedicated `worldExpansionSchema` validator checks the output and source references before it is returned.

Preview generation is read-only and creates no campaign entities or database records. A short in-process guard rejects overlapping preview requests for the same adventure/session pair. Successful previews also receive an expiring in-memory approval ID; the validated snapshot is retained server-side and is invalidated by a backend restart.

## API

Request:

```json
{
  "adventureId": "<existing adventure UUID>",
  "sessionId": "<existing session UUID>",
  "characterId": "<character UUID belonging to that session>"
}
```

The character ID is required because the existing session store uses it to verify the session/character relationship. Campaign context, entity lists, conversation text, and story memories are never accepted from the client.

Success response:

```json
{
  "model": "llama3.1:8b",
  "metadata": { "previewOnly": true, "generatedAt": "...", "proposalCount": 1, "expiresAt": "..." },
  "previewId": "<opaque random value>",
  "proposals": { "npcs": [], "locations": [], "quests": [] }
}
```

Each proposal has a temporary `key`, bounded descriptive fields, exact evidence references, and an uncertainty label (`observed`, `npc_claim`, `player_assertion`, or `uncertain`). Relationships point to `{ "type": "existing", "id": "..." }`, `{ "type": "proposal", "key": "..." }`, or `null` where applicable. Duplicate matches are annotated by the server with `duplicateOf`; repeated names in the generated set receive `duplicateProposalKey`. Existing records are never merged or changed.

## Validation and authority

The response must be strict JSON with only the supported fields. Strings, array counts, reference types, proposal keys, and evidence are bounded. Evidence must cite a source ID present in the server-loaded session/adventure context and quote text that occurs in that source. References to existing entities must resolve to the requested adventure and correct entity type; proposal references must resolve to a proposal key of the correct type.

Player actions cannot be classified as observed facts. Story memories retain their stored uncertainty label or may be made more cautious (`uncertain`). Narration with a nearby attribution verb such as “Gundrik says” cannot be labeled observed. All returned records remain explicitly unpersisted proposals, including names mentioned by NPCs. The UI renders model text as ordinary text and has no Save or Apply control.

The prompt includes at most eight recent completed turns and eight active memories, with existing entity summaries bounded to twelve per kind and text clipped. Ollama generation uses an 8,192-token context, at most 1,200 predicted output tokens, the existing world-generation timeout (default 240 seconds), and the existing configured response-character limit capped at 16,000. Ollama timeout/unavailability, response truncation, malformed JSON, and schema/evidence failures return errors without retries or database changes.

## DM interface

The preview is in the existing Adventures → selected adventure → Worldbuilding tab. It lists active and paused sessions with their character names, then displays proposals, evidence, uncertainty labels, and duplicate warnings. The parent application renders Adventures only in DM mode; Player mode renders the solo player interface and does not expose this panel.

## Reviewed approval

`POST /api/ai/world/expand/approve` accepts only `previewId`, `adventureId`, a non-empty explicit `selectedProposalKeys` array, and optional `edits` keyed by selected proposal key. Client-supplied proposal content, references, evidence, provenance, uncertainty, and identity fields are rejected. NPC, location, and quest creative text is bounded and revalidated, including historical-language safeguards.

Proposal references resolve only when the target was explicitly approved in this batch or an earlier partial approval from the same preview. Existing references are rechecked against the same adventure. One SQLite `BEGIN IMMEDIATE` transaction creates selected entities, objectives, and relationships, then writes the original server-held evidence and uncertainty through the approval metadata store. Failures roll back the entire batch; an already approved key cannot be applied again. The response returns saved entity IDs and remaining proposal keys.

Preview IDs expire after the configured world preview TTL (default 15 minutes), are process-local, and are not authentication credentials. A restart invalidates pending IDs. The endpoint remains loopback-only. RealmForge has no authenticated DM identity, so approval assumes a trusted local operator; do not expose it to LAN or remote clients before authentication and role-based authorization exist.

The additive Stage 5.2C-2B-1C schema migration is applied by normal database initialization. This implementation did not run it against the live database or restart the active backend. Before using approval on that installation, verify the live database backup path and integrity, then apply the migration through the normal controlled startup process.

## Security and limitations

The endpoint is restricted to loopback and requires a matching session/character pair. RealmForge does not yet have user authentication or server-side DM roles, so loopback is a local-development boundary, not proof that a particular human is a DM. Do not expose this endpoint to a LAN or remote client until authentication and role-based authorization are implemented. Ollama output may still be narratively weak or omit useful proposals; schema and provenance validation constrain structure and source claims but do not guarantee literary quality or factual inference.

## Manual verification

1. Keep the active RealmForge backend running and ensure the configured Ollama service has `llama3.1:8b` installed.
2. Open the DM interface, choose Adventures, select an adventure, then open Worldbuilding.
3. Select an active or paused session and click **Generate World Expansion**. Wait for the local model; generation may take a while.
4. Confirm each result is labeled as a preview, displays evidence and uncertainty, and shows duplicate warnings where names match existing entities. Confirm no Save/Apply action is present.
5. Refresh the page and verify no proposals were persisted. Existing campaign entities, session transcript, and story memories should be unchanged.
6. Open `/player` and confirm the proposal panel is absent.
7. To exercise failure states, temporarily stop Ollama or configure a test mock to delay or return invalid structured output; verify a useful error appears and the saved adventure/session data remains unchanged.
