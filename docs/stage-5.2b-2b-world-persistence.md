# Stage 5.2B-2B — Persist AI-Generated Campaign Worlds

## Architecture

World generation remains in the Stage 5.2B-2A Ollama service. On successful validated generation, `worldPreviewRegistry.ts` creates a 256-bit cryptographically random URL-safe token and stores the exact validated preview, configuration, and configured model in a bounded in-memory registry. `worldPersistenceStore.ts` maps that trusted server-side snapshot into the existing campaign and adventure tables inside one SQLite `BEGIN IMMEDIATE` transaction. `worldGenerationRoutes.ts` provides loopback-only preview and save endpoints.

The browser never submits generated content to be persisted. The save endpoint accepts only a preview token; changing or adding a preview payload is rejected. A failed transaction rolls back and returns the token to its ready state so the caller may retry. A successful token is idempotent: retrying it within its lifetime returns the same saved campaign and adventure rather than inserting duplicates.

## Token lifecycle and configuration

- Tokens contain 32 random bytes encoded as base64url and are not written to SQLite or logs.
- `OLLAMA_WORLD_PREVIEW_TTL_MS` sets token lifetime (default 900000 ms; bounded to 10000–3600000 ms).
- `OLLAMA_WORLD_PREVIEW_MAX_ENTRIES` sets the in-memory registry limit (default 50; bounded to 1–200).
- Expired entries are pruned. If the registry is full, an older unused preview may be evicted; if all entries are saved and still within their retry lifetime, issuing another token returns a capacity error.
- Server restart loses all unsaved previews and their tokens. Saved worlds remain in SQLite.

## API contracts

Generate a preview as in Stage 5.2B-2A:

```http
POST /api/ai/world/preview
Content-Type: application/json
```

```json
{"dmMode":"ai","theme":"dark-fantasy","worldCreation":"surprise","length":"short"}
```

The response retains `model`, `preview`, and preview metadata, and adds `previewToken`. `metadata.expiresAt` is the token expiry time. Generation still does not write to the database.

Save the exact server-held preview:

```http
POST /api/ai/world/save
Content-Type: application/json
```

```json
{"previewToken":"<token returned by world preview>"}
```

The first save returns `201` with `campaign`, `adventure`, and `referenceMap`. A retry with the same saved token returns `200` and the same identifiers, with `metadata.replayed: true`. Other outcomes: `400` for malformed request shape, `403` for non-loopback callers, `404` for unknown/forged tokens, `409` while a save is in progress, `410` for an expired token, `503` when Ollama or the bounded registry is unavailable, and `500` for a rolled-back persistence failure.

## Database mapping and migration

The campaign title, premise, and setting map to the existing campaign name, description, and setting. A draft adventure is created under the new campaign. Existing adventure, location, NPC, quest, and objective tables are reused. Preview location keys map to new location UUIDs; NPC location references, quest-location references, and starting-location references use those mapped database IDs. NPC role and personality use existing description/personality fields, and motivation is preserved in DM-only notes. Quest objectives start incomplete and the main quest starts available. The central mystery and possible resolution are saved as distinct adventure story notes.

Session scenes are historical instances tied to a real session and character. To avoid inventing either, an additive `adventure_scene_templates` table stores the opening scene as an adventure template linked to its location and quest. The additive `adventure_quest_locations` table stores quest/location associations, and `adventures.startingLocationId` stores the selected start location while retaining the existing `startingLocation` text for compatibility. Existing records are left intact; the new reference column remains null for legacy adventures unless later edited through the existing adventure workflow.

No sessions, characters, players, or journal events are created by saving a world. Future dynamic expansion can use the existing location, NPC, quest, objective, story-flag, story-note, and session-journal structures. Player decisions remain part of real session records and are not fabricated during world creation.

## Production database backup

Before the schema or persistence changes, the active default database was verified at `server/data/realmforge.sqlite` (`PRAGMA integrity_check` returned `ok`). A SQLite snapshot was created with `VACUUM INTO` and reopened read-only for verification:

- Backup: `server/data/backups/realmforge-2026-10-18T03-46-07-427Z.sqlite`
- Size: 659456 bytes
- SHA-256: `03453c4cd93b6cc45e6359172b2b6de4b767fcd6ef3aaa54f8b8538aaee62685`
- Backup integrity: `ok`
- Preserved before migration: 1 campaign (`The Ashen Crown`), 1 adventure (`The Whispering Flask`), 1 session, 1 scene, and 2 journal entries.

Backups live under `server/data/backups`, within the existing ignored database-data directory. They are not committed.

After the backup was verified, the additive startup migration was applied to the active database. The migrated database reports `integrity_check = ok` and no foreign-key violations. A row-by-row comparison of all 43 tables present in the backup (27 existing rows across those tables) found no changes to the original common columns. The new scene-template and quest-location tables are empty until a preview is explicitly saved.

## Manual verification

1. Confirm Ollama is running and `llama3.1:8b` is installed; start RealmForge using its existing local workflow.
2. Request a preview:

   ```sh
   curl -sS -X POST http://localhost:3001/api/ai/world/preview \
     -H 'Content-Type: application/json' \
     -d '{"dmMode":"ai","theme":"dark-fantasy","worldCreation":"surprise","length":"short"}'
   ```

3. Keep the returned `previewToken`, then save it:

   ```sh
   curl -i -X POST http://localhost:3001/api/ai/world/save \
     -H 'Content-Type: application/json' \
     -d '{"previewToken":"PASTE_PREVIEW_TOKEN_HERE"}'
   ```

4. Repeat the same save request before token expiry. The first request should be `201`; the retry should be `200` with the same campaign/adventure IDs and `metadata.replayed: true`.
5. Inspect `GET /api/campaigns` and `GET /api/campaigns/{campaignId}/adventures/{adventureId}`. Verify the three locations/NPCs, one quest with its objectives and linked locations, one opening scene template, and the start location. Verify no session or character was created.
6. Try an unknown token and a request containing an extra `preview` field; expect `404` and `400` respectively. For expiry testing, temporarily lower `OLLAMA_WORLD_PREVIEW_TTL_MS` to its minimum, generate a preview, wait for the advertised expiration, and save it; expect `410`.
7. Compare the preexisting Ashen Crown/Whispering Flask records and session journal to confirm they remain present.

Automated persistence tests use temporary databases and mocked Ollama responses. They exercise token expiry and forgery, mapping and relationships, save replay/concurrency, transaction rollback, and preservation of seeded existing data. They do not write to the production database.

## Limitations and next steps

There is no UI for reviewing or saving the preview in this stage. The token registry is process-local and intended for a single local RealmForge server. No launch workflow, player interaction, new AI narration behavior, or dynamic world expansion is implemented. Before LAN or remote access, the application needs server-side authentication and authorization; UI mode separation and loopback checks alone are not remote-user authorization.
