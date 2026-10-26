# RealmForge Windows launcher

The Windows launcher runs the already-built production artifacts. It does not start Vite and it does not run a build during startup.

## Startup

From PowerShell or Command Prompt, run:

```text
launcher\windows\realmforge.cmd start
```

The launcher validates `client\dist\index.html` and `server\dist\index.js`, starts the compiled Express server on `127.0.0.1:3001`, waits for `GET /api/health`, checks Ollama through `/api/ai/health`, and opens the default browser.

Ollama is optional. If it is unavailable or the configured model is missing, RealmForge still starts and non-AI features remain available.

## Shutdown and status

```text
launcher\windows\realmforge.cmd status
launcher\windows\realmforge.cmd stop
launcher\windows\realmforge.cmd diagnose
```

`stop` only terminates a process whose PID, project root, launcher path, worker mode, and random ownership token all match the current launcher state. Port conflicts and stale state are reported or recovered without stopping unrelated processes.

## Desktop shortcut

Right-click [RealmForge.ps1](./RealmForge.ps1), choose **Create shortcut** if available, or create a shortcut manually with this target:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\Projects\RealmForge\launcher\windows\RealmForge.ps1"
```

The PowerShell launcher provides Start, Stop, Status, and Diagnose buttons. Keep the project on `D:` and update the shortcut if the project moves.

## Runtime files and database

Logs and launcher state are stored per user under `%LOCALAPPDATA%\RealmForge\launcher`.

The database remains at `server\data\realmforge.sqlite` by default. The launcher passes through `REALMFORGE_DATA_DIR` when supplied; it never copies, moves, migrates, or resets the database.

For example:

```text
set REALMFORGE_DATA_DIR=D:\RealmForgeData
launcher\windows\realmforge.cmd start
```

The override must be set before starting the launcher. Existing databases are not automatically moved.
