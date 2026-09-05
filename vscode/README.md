# Raycast Bridge

Use [Raycast AI](https://www.raycast.com/pro) as a chat model inside VS Code, run AI quick
actions on your selection, and fire any Raycast command from the editor.

Raycast exposes no API to other processes, so this extension pairs with a small companion
Raycast extension that lives in the same repository. See [Setup](#setup).

![A quick action answering under the selection](https://github.com/youyinnn/vscode-raycast-bridge/raw/main/vscode/img/quickaction.gif)

*A quick action on the editor selection: the answer streams in underneath and says which
model answered.*

## Features

**Raycast AI in the Chat view.** Raycast's models appear in the chat model picker under the
`Raycast AI` vendor. Pick one and chat as with any other model. `Raycast: Select Chat Models`
chooses which models are offered.

![Raycast models in the Chat view](https://github.com/youyinnn/vscode-raycast-bridge/raw/main/vscode/img/chat.gif)

**Ask AI.** `Raycast: Ask AI` sends the selection, or the whole file, to the Chat view with an
instruction you type.

**Quick actions on the selection.** Select text and a lightbulb entry and a code lens offer
actions such as *Translate to Chinese*, *Explain* and *Polish as Academic English*. The answer
streams in under the selection, or into a hover. Answers render as Markdown; give an
action `"render": false` to show its answer verbatim instead, which suits rewrites of
LaTeX or code where Markdown would eat characters or refuse to wrap. An inline answer takes keyboard focus when it
appears, so Escape dismisses it; set `raycastBridge.quickActionsFocus` to false to keep
focus in the editor. VS Code caps a comment thread at about 20 lines and does not
refresh its scrollbar after that, so the first time an answer is longer the extension
offers to turn off `comments.maxHeight`, which lets answers expand in full. Each action has its own prompt and can pin
its own model with `Raycast: Select Quick Action Model`. Bind one to a key by writing a
keybinding by hand:

```json
{
  "key": "cmd+k t",
  "command": "raycastBridge.quickAction",
  "args": { "action": "Translate to Chinese" },
  "when": "editorTextFocus"
}
```

A key press with nothing selected runs the action on the line the cursor is on, so short
edits need no selecting first. The lightbulb and the code lens still wait for a real
selection, since either would otherwise offer itself on every line of every file.

**Answers are cached.** Running the same text through the same action and model replays the
stored answer instead of spending Raycast AI quota again, which the per-minute and per-hour
limits make worth doing. A replayed answer is labelled *cached* and carries a Regenerate
button that asks Raycast afresh. The last 100 answers are kept; `Raycast: Clear Quick Action
Cache` forgets them. Turn the whole thing off with `raycastBridge.quickActionCache`, or one
action at a time by giving it `"cache": false`. Whitespace at the end of the selection is
ignored when matching, since a drag easily overshoots into the newline; indentation at the
start is not, since it is what an indented answer was written to match. Pinning a model keys the cache to that model;
an action with no model pinned is keyed to the installed Raycast version instead, since that
is what decides which model answers.

**Run Raycast commands.** `Raycast: Run Command` fires any deeplink listed in
`raycastBridge.commands`, optionally injecting the selection.

## Requirements

- macOS. Raycast is macOS only.
- Raycast 2.x with a **Pro** subscription for the AI features.
- The companion Raycast extension, installed once as described below.

## Setup

1. Install this extension from the Marketplace.
2. Install the companion Raycast extension. It is not on the Raycast Store, so it is imported
   from source with the Raycast CLI:

   ```bash
   git clone https://github.com/youyinnn/vscode-raycast-bridge.git
   cd vscode-raycast-bridge/raycast
   npm install
   npx ray develop
   ```

   `ray develop` builds the extension, imports it into Raycast and then keeps watching. Once
   Raycast shows *VS Code Bridge*, press Ctrl+C. The extension stays installed.
3. Open the Chat view, pick a Raycast model, and send a message. The first launch shows a
   Raycast confirmation dialog. Choose **Always** so later launches are silent.
4. Optionally run `Raycast: Probe Which Models Work`. Raycast silently answers with its
   default model when it does not accept the id you asked for, and the probe finds out which
   ids the installed Raycast actually honours.

## Commands

![The Raycast commands in the command palette](https://github.com/youyinnn/vscode-raycast-bridge/raw/main/vscode/img/commands.png)

| Command | What it does |
| --- | --- |
| `Raycast: Ask AI` | Send the selection or file to the Chat view |
| `Raycast: Run Command` | Fire a configured Raycast deeplink |
| `Raycast: Select Chat Models` | Choose which Raycast models the picker offers |
| `Raycast: Select Quick Action Model` | Pin a model to a quick action |
| `Raycast: Probe Which Models Work` | Test every model id against the installed Raycast |
| `Raycast: Test Model Directly` | Send one prompt to one model and show the raw result |
| `Raycast: Diagnose Model Provider` | Report what the language model service sees |
| `Raycast: Show Log` | Open the extension's log |
| `Raycast: Dismiss All Answers` | Remove inline quick-action answers |
| `Raycast: Clear Quick Action Cache` | Forget every remembered quick-action answer |

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| `raycastBridge.owner` | `Youyinnn` | The `<author>` segment of the companion extension's deeplink. Leave it unless you changed `author` in `raycast/package.json` before importing |
| `raycastBridge.models` | `[]` | Model ids offered in the picker. Edit with `Raycast: Select Chat Models` |
| `raycastBridge.creativity` | `none` | `none`, `low`, `medium`, `high` or `maximum` |
| `raycastBridge.quickActions` | three actions | Label, prompt and optional model per action. `{{selection}}` places the text inside the prompt |
| `raycastBridge.quickActionsUI` | `both` | `both`, `lightbulb`, `codeLens` or `none` |
| `raycastBridge.quickActionsDisplay` | `inline` | `inline` block under the selection, or `hover` |
| `raycastBridge.quickActionCache` | `true` | Replay a stored answer when the same text, action and model come round again |
| `raycastBridge.commands` | `[]` | Deeplinks for `Raycast: Run Command`. Copy each one with Raycast's *Copy Deeplink* action |

## How it works

VS Code starts a loopback HTTP server, registers a job, and opens a `raycast://` deeplink
carrying only a job id, port and one-time token. The Raycast command fetches the prompt over
HTTP, runs `AI.ask`, and streams the answer back. The server binds `127.0.0.1` on an
ephemeral port, checks the token with a constant-time compare, rejects any request carrying
an `Origin` header, and deletes jobs on completion.

## Known limits

- Raycast AI quota is 10 requests per minute and 100 per hour. Every chat turn and quick
  action spends one.
- Raycast AI has no session, so the chat history is replayed into every request.
- Cancelling a request stops rendering, but Raycast keeps generating and still spends quota.
- The models also appear in Agent mode, where they do not work: `AI.ask` cannot call tools.
- Raycast cannot list installed extensions, so `raycastBridge.commands` is filled by hand.

## License

MIT
