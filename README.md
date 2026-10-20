# RealmForge

See [macOS launcher and remote access readiness](docs/macos-launcher-and-remote-access.md) for the double-click launcher, local startup instructions, and multiplayer architecture plan.

See [Stage 5.2A local Ollama diagnostics](docs/stage-5.2a-ollama.md) for backend configuration, local AI health and test endpoints, and the manual connection check.

See [Stage 5.2B-1 AI narration](docs/stage-5.2b-1-narration.md) for the local-only narration API, context/privacy boundary, and manual test steps.


## Browser interfaces and local security

- `http://localhost:3001/dm` opens the Dungeon Master campaign and adventure workspace.
- `http://localhost:3001/player` opens the player-facing solo adventure experience.
- The root URL remains the existing combined interface for compatibility. These routes are client presentation modes and share the same local API and SQLite database.
- RealmForge currently binds to `127.0.0.1`. Hiding DM controls from the player interface is not authorization: local clients can still call the server API directly. Server-side authentication and role-based authorization must be implemented and applied to every relevant endpoint before multiplayer, LAN access, or remote access is enabled.
See [Stage 5.2B-2A AI world-generation preview](docs/stage-5.2b-2a-world-generation.md) for the preview-only endpoint, structured validation, configuration, and manual test steps.
See [Stage 5.2B-2B world persistence](docs/stage-5.2b-2b-world-persistence.md) for preview tokens, transactional saving, additive database mappings, and the verified backup.
