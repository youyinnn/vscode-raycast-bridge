# vscode-raycast

Run Raycast commands and Raycast AI from inside VSCode.

Raycast exposes no API to external processes: `raycast://` deeplinks are the only
supported entry point, and they are one-way with no return value. This repo therefore
ships a **pair** of extensions:

- `vscode/` - the VSCode extension. Owns a loopback HTTP server and fires deeplinks.
- `raycast/` - the companion Raycast extension. Executes the work and streams results back.

```
VSCode ──raycast:// deeplink (jobId, port, token)──▶ Raycast command
   ▲                                                      │
   └──── HTTP GET job / POST chunks / POST done ──────────┘
                  (127.0.0.1, token-authenticated)
```

The server lives on the VSCode side because Raycast unloads command processes as soon
as they finish, so it cannot host anything long-lived. The VSCode extension host can.

## Requirements

- macOS (Raycast is macOS only; the bridge shells out to `open`)
- Raycast **Pro** for the AI features (`AI.ask` throws without it)
- Node 20+

## Setup

```bash
cd raycast && npm install && npx ray develop     # imports the extension into Raycast
cd ../vscode && npm install && npm run build
```

`ray develop` only needs to run once to import the extension. It stays registered in
Raycast after you stop the process; you do not need a terminal open to use the bridge.

Then in VSCode press F5 (or point a dev host at `vscode/`) and set your Raycast handle:

```json
{ "raycastBridge.owner": "your-raycast-handle" }
```

The first deeplink triggers a Raycast confirmation dialog. **Choose "Always"** - after
that every launch is silent.

## Commands

| Command | What it does |
| --- | --- |
| `Raycast: Ask AI` | Sends the selection (or whole file) to Raycast AI, streams the answer into a new markdown document |
| `Raycast: Run Command` | Fires any configured Raycast deeplink, optionally injecting the selection |

## Configuration

| Setting | Default | Notes |
| --- | --- | --- |
| `raycastBridge.owner` | - | Your Raycast Store handle, used as the `<author-or-owner>` deeplink segment |
| `raycastBridge.model` | `""` | Raycast AI model id, e.g. `anthropic-claude-sonnet-4-6`. Empty uses the Raycast default |
| `raycastBridge.creativity` | `none` | `none` / `low` / `medium` / `high` / `maximum` |
| `raycastBridge.commands` | `[]` | Commands offered by `Raycast: Run Command` |

Raycast has no API to enumerate installed extensions (the local database is encrypted),
so `raycastBridge.commands` must be filled in by hand. Get each URL from Raycast's
**Copy Deeplink** action in root search:

```json
{
  "raycastBridge.commands": [
    {
      "label": "Search Notes",
      "deeplink": "raycast://extensions/raycast/raycast-notes/search-notes",
      "passSelectionAs": "fallbackText"
    }
  ]
}
```

`passSelectionAs` accepts `fallbackText`, `argument:<name>`, or `context:<key>`.

## Security

The loopback server is reachable by any local process, so without authentication anything
on the machine could inject text into your editor. Mitigations:

- binds `127.0.0.1` only, on an OS-assigned ephemeral port
- per-session random token, compared with `timingSafeEqual`
- requests carrying an `Origin` header are rejected (blocks browser-driven DNS rebinding;
  Raycast's own fetch sends no Origin)
- jobs are deleted on completion and expire after 5 minutes

## Known limits

- **Raycast AI quota: 10 requests/minute, 100/hour.** Heavy use hits this quickly.
- Installed Raycast extensions cannot be enumerated; command lists are manual.
- The Raycast side is installed via `ray develop`, so it is a personal tool unless published.
- A dev extension's deeplink identity is fixed at **first import**. Changing `author` in
  `package.json` afterwards does not move it: `ray develop` rebuilds the code but Raycast keeps
  serving the original `<author>` segment. To change it, remove the extension in Raycast and
  re-import.

## Development

```bash
cd vscode && npm test        # 15 tests, no VSCode host required
cd vscode && npm run typecheck
cd raycast && npx tsc --noEmit
```

`src/bridge/server.ts` deliberately has no `vscode` import so it can be tested against a
real HTTP client.
