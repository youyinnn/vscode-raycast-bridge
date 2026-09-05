# Changelog

All notable changes to the Raycast Bridge extension are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.2.0] - 2026-09-05

- Quick action answers are remembered. Running the same text through the same action and
  model again replays the stored answer instead of spending Raycast AI quota, which the
  per-minute and per-hour limits make worth doing. A replayed answer is labelled `cached`
  and carries a Regenerate button that asks Raycast afresh. The last 100 answers are kept.
  `Raycast: Clear Quick Action Cache` forgets them, `raycastBridge.quickActionCache` turns
  the whole thing off, and an action can opt out with `"cache": false`.

  An action with a model pinned is keyed to that model; one with no model pinned is keyed
  to the installed Raycast version instead, since that is what decides which model answers.
  Whitespace at the end of the selection is ignored when matching, since a drag easily
  overshoots into the newline; indentation at the start is not, since it is what an
  indented answer was written to match.

- A quick action bound to a key runs on the line the cursor is on when nothing is selected.
  Bind it with `"when": "editorTextFocus"` rather than `"when": "editorHasSelection"` to
  reach this.

- An inline answer takes keyboard focus when it appears, so Escape dismisses it without a
  click first. `raycastBridge.quickActionsFocus` turns this off. Dismissing an answer hands
  focus back to the editor.

- A quick action can set `"render": false` to show its answer as plain text instead of
  Markdown: lines wrap, newlines are kept, and LaTeX characters appear as written.

## [0.1.1] - 2026-09-05

- Escape dismisses the focused inline answer instead of collapsing it.
- Long inline answers were cut off at VS Code's 20-line comment cap with no working
  scrollbar. The extension now offers, once, to turn off `comments.maxHeight` so answers
  expand in full.

## [0.1.0] - 2026-09-05

Initial release.

- Raycast AI models in the native Chat view, registered as the `raycast` model vendor.
- `Raycast: Ask AI` sends the selection or the whole file to Chat.
- Quick actions on the editor selection (lightbulb and code lens), with a configurable
  prompt, model and keyboard shortcut per action. Answers stream inline under the
  selection or into a hover.
- `Raycast: Run Command` fires any configured Raycast deeplink, optionally injecting
  the selection.
- `Raycast: Probe Which Models Work` finds out which model ids the installed Raycast
  actually honours and caches the verdicts.
- Diagnostics: `Raycast: Diagnose Model Provider`, `Raycast: Test Model Directly`,
  `Raycast: Show Log`.
