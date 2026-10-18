# macOS launcher and remote access readiness

## Launcher location and use

The generated apps are placed beside the project:

- `/Users/thomas/Documents/Code Projects/RealmForge/RealmForge.app`
- `/Users/thomas/Documents/Code Projects/RealmForge/RealmForge Stop.app`

Double-click **RealmForge.app** to launch. It builds the client and server, starts the production server, waits for `GET /api/health`, and opens `http://127.0.0.1:3001` in the default browser. The Express server also serves the built client, so Vite is not started for a normal launch.

Double-click **RealmForge Stop.app** to stop the launcher's server. It sends `SIGTERM` only to a manager process whose command line matches this project, launcher script, and generated owner token; that manager then stops only its own server child. If another process already owns port 3001, startup reports the conflict and leaves that process alone.

For command-line status and troubleshooting, run these from Terminal:

```sh
./launcher/macos/realmforge.sh status
./launcher/macos/realmforge.sh stop
```

Launcher output is at `~/Library/Application Support/RealmForge/launcher/launcher.log`. Startup errors are shown by the app and include the log location. Common recovery steps:

1. Confirm Node.js and npm are installed and available from a login zsh (`node -v`, `npm -v`). The launcher resolves those commands from the login shell because Finder apps have a reduced environment.
2. Run `npm ci` in `client/` and `server/` once if dependencies are missing.
3. If port 3001 is occupied, inspect it with `lsof -nP -iTCP:3001 -sTCP:LISTEN`. Stop the process only if you know it is the RealmForge process you intend to stop, then launch again.
4. Keep each `.app` beside the project root. The bundles resolve the repository from their own parent folder, so moving the whole project folder with the apps preserves that relationship. If an app is moved separately, move it back beside the repository or recreate both apps there with `./launcher/macos/build-app.sh`.

The launcher uses production builds on each start, so changed source files are included on the next launch. Development remains separate: use `npm run dev` in `server/` and `npm run dev` in `client/` as before. Vite defaults to port 5173 and serves locally; it has no configured API proxy. Development client requests go directly to `http://localhost:3001/api`.

The SQLite database remains at `server/data/realmforge.sqlite` by default, independent of whether the server is running through tsx or the production build. `REALMFORGE_DATA_DIR` can override that path. The launcher does not reset or move the database.

## Services and Ollama

The normal launcher starts one service: the production Express server on `127.0.0.1:3001`. It serves `client/dist` and `/api/*` from the same origin. No Vite dev server is needed. The launcher does not start Ollama and RealmForge currently has no Ollama API integration. To check Ollama locally, use `ollama ps`; `ollama list` shows installed models. The future model name in project planning is `llama3.1:8b`; it is not downloaded or required by this launcher. Keep Ollama on the host and do not expose port 11434.

The server defaults to `REALMFORGE_HOST=127.0.0.1`, including when started directly. The API allows browser origins on localhost/loopback only for development. The frontend currently hardcodes `http://localhost:3001/api` in multiple components, rather than using a same-origin relative URL or a Vite proxy. Production same-origin requests work through the bundled server; this hardcoded URL is a blocker for browser clients on other machines.

## Network and multiplayer readiness

RealmForge is local-only by default. The production server binds to loopback, the Vite development server uses its local default, and this launcher does not configure router forwarding, a tunnel, or a public address. No remote access should be enabled using the current unauthenticated API.

For a private LAN prototype, the application would first need a configurable API base (prefer a relative `/api` path), a deliberate LAN bind option, and a narrowly configured list of allowed origins. The database must stay on the host. The host firewall should allow only the intended private subnet. This launcher does none of that.

Authenticated remote access requires more than changing the bind address or CORS policy:

- Add accounts, secure password or identity-provider handling, HTTPS, secure session/token storage, CSRF protections where cookies are used, rate limits, and account recovery.
- Add campaign membership and role checks to every read and write route. Existing campaign IDs and player display names are not authorization. Validate that players can control only their assigned characters and that only the host/DM can manage privileged campaign state.
- Review each response and error for DM-only notes, private story flags, internal override reasons, and hidden NPC/location data. Keep player-facing APIs separately scoped.
- Add invitation records with unpredictable, expiring, single-use tokens stored as hashes; make joining campaign-scoped and require host approval or character assignment.
- Keep state-changing rules on the server, with audit history and concurrency protection. Browser clients must never connect directly to SQLite or Ollama.
- Keep Ollama bound to the host. The RealmForge backend alone should call it, enforce timeouts and output limits, and validate any proposed game-state action before applying it.

### Proposed future join flow

1. Host creates a campaign.
2. Host generates an invitation.
3. Player opens a secure link.
4. Player signs in or creates an account.
5. Player joins only the campaign authorized by that invitation.
6. Host approves the player and assigns a character.
7. Player enters the game through the browser.

Authentication, invitations, LAN binding, tunnels, and public hosting are planning only and are not implemented in this stage.

## Verification and manual macOS checks

The source launcher can be compiled with `./launcher/macos/build-app.sh`. After building, manually double-click both apps once to verify Finder launch permissions, startup alerts, browser opening, and clean stop behavior. Then verify browser refresh, campaign/API reads, and SQLite persistence. Test a port conflict and confirm the launcher refuses to stop the existing process. These GUI checks should be repeated after moving the project and rebuilding the apps.
