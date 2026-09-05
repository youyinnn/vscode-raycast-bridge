# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# VSCode side
cd vscode
npm run typecheck                        # tsc --noEmit
npm test                                 # vitest run (59 tests, no VSCode host needed)
npx vitest run src/bridge/server.test.ts # single file
npx vitest run -t "rejects a browser"    # single test by name
npm run build                            # esbuild bundle -> dist/extension.js
npm run gen:models                       # regenerate src/models.sdk.ts from @raycast/api
npm run package                          # vsce package -> vscode-raycast-bridge-<version>.vsix (runs typecheck+test+build first)
npm run publish                          # vsce publish; needs `npx vsce login Jun` once

# Raycast side
cd raycast
npx tsc --noEmit
npx ray lint                             # validates manifest; hits the live Raycast Store API
npx ray develop                          # builds and imports into Raycast; watch mode, Ctrl+C when built
```

There is no automated end-to-end test: the real chain needs a running Raycast with a Pro
account, and each run spends AI quota (10/minute, 100/hour). Use the extension's own commands
to exercise it — `Raycast: Test Model Directly` and `Raycast: Probe Which Models Work`.

## Architecture

Two independent npm packages, deliberately not a workspace (npm workspaces confuse `ray`'s
assumptions about extension directory layout).

The shape of this repo follows from three external constraints. Do not redesign around them
without re-checking:

1. **Raycast exposes no API to external processes.** `raycast://` deeplinks are the only
   supported entry point. There is no CLI command to launch a command, no AppleScript
   dictionary, no REST API. The WebSocket on `127.0.0.1:7265` is the private Browser Extension
   channel, not an entry point.
2. **Deeplinks are one-way with no return value.** Anything that needs a result requires a
   return path built by hand.
3. **Raycast unloads command processes as soon as they finish.** It cannot host a long-lived
   server. The VSCode extension host can, so the server lives on the VSCode side and Raycast
   connects back into it.

Resulting data flow:

```
VSCode  register job in BridgeServer, listen on ephemeral loopback port
        │
        ├─ open -g "raycast://extensions/<owner>/vscode-bridge/ask-ai
        │            ?launchType=background&context={jobId,port,token}"
        ▼
Raycast ask-ai (no-view) reads props.launchContext
        ├─ GET  /job/<id>          fetch the prompt
        ├─ POST /job/<id>/chunk    stream AI.ask output, batched every 120ms
        └─ POST /job/<id>/done     { ok: true } | { ok: false, error }
```

Only `{jobId, port, token}` travels through the URL (~200 bytes); the prompt and the answer go
over HTTP, which sidesteps URL length limits and makes streaming possible.

Answers render in VSCode's native Chat view. Raycast is registered as a language model provider
(`vendor: "raycast"`, `features/modelProvider.ts`), so its models appear in the chat model
picker and whatever the picker shows is what answers. `Raycast: Ask AI` only composes a query
and hands it to `workbench.action.chat.open`, so there is a single rendering path.

Raycast AI has no session — `AI.ask` takes one string and its process is unloaded after each run
— so `bridge/composePrompt.ts` replays the message history into every prompt. Cancelling stops
rendering and unregisters the job, but Raycast keeps generating and keeps spending quota.

## Invariants

Breaking any of these produces silence, not an error.

- **`vscode/src/bridge/` must not import `vscode`.** Its tests drive it with real HTTP and plain
  values; a `vscode` import would force mocking and kill that. Pure logic lives there,
  vscode-facing code in `features/`. `withSelection` once lived in `features/` and needed a mock
  that passed vitest but failed `tsc`.
- **`protocol.ts` is duplicated by hand** in `vscode/src/bridge/` and `raycast/src/`. Changing
  the wire contract means editing both.
- **Fire deeplinks with `open`, never `vscode.env.openExternal`.** VSCode documents scheme
  support only for `http`/`https`/`mailto`/`vscode`, and `vscode.Uri.parse` re-encodes the query
  string, corrupting the already-encoded `context` payload.
- **Three fields in `provideLanguageModelChatInformation` are load-bearing and undocumented.**
  Do not "clean them up":
  - `isUserSelectable: true` — absent from `LanguageModelChatInformation` in @types/vscode
    1.136.0, but the model picker filters on it. Without it the models register and stay
    invisible. The provider is parameterised (`LanguageModelChatProvider<T>`) to carry it.
  - `capabilities.toolCalling: true` — a false declaration (`AI.ask` has no function calling)
    that is nonetheless required, or the models are filtered out of the picker even in Ask mode.
    Established by experiment; VSCode's own filters appear to check it only for Agent mode, so
    the mechanism is unexplained. The price is that the models also appear in Agent mode, where
    they stall. Setting it to `false` makes the extension unusable, not merely honest.
  - `maxInputTokens`/`maxOutputTokens` must be non-zero. Copilot Chat prunes the prompt to fit
    `maxInputTokens`; a zero budget makes its renderer throw before the provider is called, and
    it surfaces as an empty chat reply with no error.
- **Probe verdicts are keyed `raycast@<app>/sdk@<sdk>/probe@<method>`** and `CatalogStore` caches
  the raw payload, re-parsing on read. Bump `PROBE_METHOD` in `bridge/fallback.ts` whenever the
  probe's prompt or judgement changes, or stale conclusions outlive the logic that made them.

## Publishing

The Marketplace publisher is `Jun` (same as latex-non-academic-word-check), not the GitHub
handle. `engines.vscode` and `@types/vscode` are pinned to `^1.104.0`: that is where the
Language Model Chat Provider API went stable, and the source typechecks against the 1.104.0
typings. Bumping `@types/vscode` alone makes vsce refuse to package. No `activationEvents`
are declared on purpose: VS Code derives `onLanguageModelChatProvider:raycast` from the
`languageModelChatProviders` contribution and `onCommand:*` from the commands. Only
`vscode/README.md` reaches the Marketplace; the root README is for the repo.

## Security model

The loopback server is reachable by any local process, so `server.ts` enforces: bind
`127.0.0.1` only, OS-assigned ephemeral port, per-session random token compared with
`timingSafeEqual`, rejection of any request carrying an `Origin` header (Raycast's own fetch
sends none, so this only blocks browsers), and job deletion on completion with a 5-minute
expiry. Treat these as load-bearing, not decoration.

## Background

Hard-won detail lives in Claude's memory for this project rather than here — how Raycast's model
catalog is shaped and where it lies, why the app version rather than the SDK decides which
models work, why a successful call proves nothing, the SDK/app version-pinning trap, the
Raycast-side dev workflow, and which diagnostic command rules out which layer.
