# vscode-raycast-bridge

Run Raycast AI and Raycast commands from inside VS Code.

This repository holds two extensions that only work together:

- [`vscode/`](vscode/) - the VS Code extension, published to the Marketplace as
  **Raycast Bridge** (`Jun.vscode-raycast-bridge`). Its [README](vscode/README.md) is the
  user-facing documentation: features, setup, commands and settings.
- [`raycast/`](raycast/) - the companion Raycast extension. It executes the work and streams
  results back. It is not on the Raycast Store; users import it once with `ray develop`.

## Why two extensions

Raycast exposes no API to external processes. `raycast://` deeplinks are the only supported
entry point, they are one-way, and Raycast unloads a command's process as soon as it finishes,
so the Raycast side cannot host anything long-lived. The VS Code extension host can, so the
server lives there and Raycast connects back into it:

```
VSCode ──raycast:// deeplink (jobId, port, token)──▶ Raycast command
   ▲                                                      │
   └──── HTTP GET job / POST chunks / POST done ──────────┘
                  (127.0.0.1, token-authenticated)
```

Only the job id, port and token travel through the URL. The prompt and the answer go over
HTTP, which sidesteps URL length limits and makes streaming possible.

## Install

Users: install **Raycast Bridge** from the VS Code Marketplace, then follow the Setup section
of [vscode/README.md](vscode/README.md) to import the Raycast side.

## Development

```bash
# Raycast side: build and import into Raycast, then Ctrl+C once it shows up
cd raycast && npm install && npx ray develop

# VS Code side
cd vscode && npm install
npm run typecheck
npm test                 # vitest, no VS Code host needed
npm run build            # esbuild bundle -> dist/extension.js
```

Then press F5 in this folder to launch an Extension Development Host with `vscode/` loaded.

Things that bite:

- `src/bridge/` must not import `vscode`; its tests drive it with real HTTP.
- `protocol.ts` is duplicated by hand in `vscode/src/bridge/` and `raycast/src/`.
- A dev Raycast extension's deeplink identity is fixed at first import. Changing `author`
  afterwards does nothing until the extension is removed inside Raycast and imported again.
- Keep the Raycast app and `@raycast/api` on the same major line, then run
  `npm run gen:models` and `Raycast: Probe Which Models Work`.
- There is no automated end-to-end test. Each real run spends Raycast AI quota
  (10/minute, 100/hour). Use `Raycast: Test Model Directly` instead.

## Release

```bash
cd vscode
npm version minor          # or patch; update CHANGELOG.md first
npm run package            # writes vscode-raycast-bridge-<version>.vsix, runs typecheck+test+build first
npx vsce login Jun         # once per machine, needs a Marketplace PAT
npm run publish
```

## License

MIT
