# RealmForge

**RealmForge** is an in-development, local-first fantasy tabletop campaign and solo-adventure workspace. It combines a React-based Dungeon Master interface, a player-facing interface, an Express API, SQLite persistence, and experimental local AI features powered by Ollama.

> **Status:** Active development / local prototype. Not a hosted multiplayer service. The API is not ready for exposure to a LAN or the public internet.

## Features

- Create and manage campaigns and adventures, with data stored locally in SQLite.
- Separate browser interfaces for Dungeon Master and player workflows: `/dm` and `/player`. These are presentation modes, **not security roles**.
- Local Ollama diagnostics and AI narration endpoints.
- AI-generated world previews and explicit, token-based persistence of approved previews into campaigns and adventures.
- Local macOS launcher workflow for starting and stopping the application.

Features and APIs are developed incrementally; see the [project documentation](docs/) for stage-specific contracts and verification steps.

## Technology

- **Client:** React 19, TypeScript, Vite 8
- **Server:** Node.js, Express 5, TypeScript
- **Storage:** SQLite (local database)
- **Optional local AI:** Ollama, with a separately installed model

## Run locally

Install Node.js and npm. From the repository root:

```bash
cd server
npm ci
npm run dev
```

In another terminal:

```bash
cd client
npm ci
npm run dev
```

The API listens on `http://127.0.0.1:3001` by default. The Vite development UI uses its local dev-server address (typically `http://localhost:5173`); its requests target the local API on port 3001. The production server can serve the built client.

To build and run the production server, build the client first and then start the server:

```bash
cd client && npm run build
cd ../server && npm start
```

The combined production UI is available at `http://127.0.0.1:3001`; use `/dm` or `/player` for the respective views. Run `npm test` separately in `client/` and `server/` for their configured test suites.

### Local AI

Ollama is **not** installed or started by RealmForge. Install and run Ollama separately and provision a compatible model before using AI endpoints. See [Ollama diagnostics](docs/stage-5.2a-ollama.md), [narration](docs/stage-5.2b-1-narration.md), [world preview](docs/stage-5.2b-2a-world-generation.md), and [world persistence](docs/stage-5.2b-2b-world-persistence.md).

### macOS launcher

See [launcher setup and troubleshooting](docs/macos-launcher-and-remote-access.md) for building the desktop launcher, its dependencies, and local startup behavior. Machine-specific paths in that document are examples, not universal install locations.

## Data and security

The default SQLite database is under `server/data/`; `REALMFORGE_DATA_DIR` can override the data directory. Back up local data before making schema or deployment changes.

The server binds to loopback by default. **Do not expose the current API to remote clients.** Hiding DM controls in the player UI does not enforce permissions. Authentication, campaign membership checks, and server-side role authorization are required before LAN or multiplayer deployment.

## Roadmap

Planned work includes a fuller solo-play loop, deeper AI-assisted session preparation, and eventually authenticated multiplayer access. Planned capabilities should not be mistaken for completed features.

## Documentation

- [macOS launcher and remote access readiness](docs/macos-launcher-and-remote-access.md)
- [Ollama diagnostics](docs/stage-5.2a-ollama.md)
- [AI narration](docs/stage-5.2b-1-narration.md)
- [World-generation preview](docs/stage-5.2b-2a-world-generation.md)
- [World persistence](docs/stage-5.2b-2b-world-persistence.md)
