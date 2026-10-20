# Stage 5.1H data model review

## Existing schema and behavior

- `campaigns` stores persistent campaign records.
- `players` stores persistent UUIDs and a display name, but currently has no lifecycle status or update timestamp.
- `campaign_memberships` joins a player to a campaign, copies the display name, records creation time, and has `UNIQUE(campaignId, playerId)`. Existing membership creation creates a new player identity and membership together. Memberships currently have no role or status.
- `characters.membershipId` associates each character with one campaign membership. There is no distinct ownership-assignment record. Existing character rows therefore remain playable through their current membership, but must not be silently copied into a new owner table.
- `adventure_session_journal` is an immutable, session-scoped gameplay event log. It is not a player-authored journal and should remain unchanged.
- Existing API routes are local and unauthenticated. Several use caller-supplied campaign/player IDs for current roster management. New identity, ownership, and private journal APIs must not broaden that trust boundary.

## Additive schema proposal

1. Extend `players` with `status` (`active`/`inactive`) and `updatedAt`; existing rows receive `active` and their existing `createdAt` value. Keep IDs and display names.
2. Extend `campaign_memberships` with `role` (`dm`/`player`), `status` (`invited`/`active`/`inactive`/`removed`), and `joinedAt`; existing rows receive the player/active values and their original creation timestamp. Keep its current uniqueness constraint and IDs.
3. Add `character_ownership`, a one-row-per-character relationship to a campaign membership. Do not backfill it: existing characters remain explicitly unassigned for ownership purposes while their original `membershipId` continues to drive all existing game APIs.
4. Add `campaign_log_entries` for campaign-scoped attributed shared notes, chronological indexes, and an optional unique source journal-entry reference.
5. Add `character_journal_entries` for character-scoped notes with `private` default visibility. Keep this separate from the immutable session event log.

All additions use foreign keys and checks. The new service layer will validate same-campaign relationships, owner identity, explicit sharing, and idempotent promotion. No new routes will expose identities, ownership changes, private journal content, sharing, or promotion until authenticated request context and authorization exist. Internal services are testable without exposing them over HTTP.

## Migration safety

Migration is additive and repeatable. It does not rebuild or clear existing tables, backfill ownership, or alter adventure-session history. Before the production database is first opened with this migration, create a timestamped backup outside `server/data` and verify it can be opened and passes SQLite integrity checks. Tests use isolated temporary databases.

## Implemented status

- Added repeatable additive column migrations for player `status`/`updatedAt` and membership `role`/`status`/`joinedAt`, with legacy backfills. Existing membership uniqueness remains stricter than “unique active membership”: a removed membership row is transitioned rather than duplicated.
- Added `character_ownership`, `character_journal_entries`, and `campaign_log_entries`. The ownership table is intentionally empty for legacy characters. Database triggers also reject cross-campaign owner links.
- Added internal service operations for player identity lifecycle, campaign memberships, DM-approved ownership assignment, private-by-default character notes, explicit party sharing, authorized Campaign Log reads/writes, and idempotent promotion. Promotion requires the source entry already be party-shared and preserves it.
- No new HTTP endpoints are registered. Identity mutation, ownership assignment, journal content, sharing, and Campaign Log operations remain unavailable to unauthenticated clients. Existing solo-session event history and current gameplay APIs are unchanged.
- The production database was backed up to `~/Library/Application Support/RealmForge/backups/realmforge-before-stage-5.1h-20261017-223701.sqlite` and verified with SQLite `PRAGMA integrity_check` (`ok`, 40 tables). Automated migration tests operate on isolated temporary SQLite files; the production database itself has not been migrated or modified by this implementation run. The next server start will apply the additive migration.
