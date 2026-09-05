import * as vscode from "vscode";
import { askRaycast } from "../bridge/ask";
import { buildQuickPrompt, findQuickAction, parseQuickActions, type QuickAction } from "../bridge/quickActions";
import type { BridgeServer } from "../bridge/server";
import type { AnswerSink } from "./answerSink";

const RUN_COMMAND = "raycastBridge.quickAction";

/** The two rendering backends, selected per call by `raycastBridge.quickActionsDisplay`. */
export type AnswerSinks = { hover: AnswerSink; inline: AnswerSink };

/**
 * Everything the command needs, in shapes that survive the command boundary.
 * A `Uri` or `Range` would arrive as an anonymous object with no methods, so
 * both are passed as plain data and rebuilt on the far side.
 */
type RunArgs = { index: number; uri: string; range: [number, number, number, number] };

/**
 * What a keybinding can supply. A keybinding has no editor, document or
 * selection to hand over, only the literal `args` object from
 * keybindings.json, so it names the action by label and the selection is
 * resolved from the active editor at press time.
 */
type KeyArgs = { action: unknown };

function isKeyArgs(args: RunArgs | KeyArgs | undefined): args is KeyArgs {
  return !!args && "action" in args;
}

/** Recomputing lenses relayouts the document, and dragging a selection fires per pixel. */
const SELECTION_DEBOUNCE_MS = 150;

export function registerQuickActions(
  context: vscode.ExtensionContext,
  server: BridgeServer,
  log: vscode.LogOutputChannel,
  sinks: AnswerSinks,
): void {
  const provider = new QuickActionProvider();
  context.subscriptions.push(
    provider,
    vscode.languages.registerCodeActionsProvider("*", provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite],
    }),
    vscode.languages.registerCodeLensProvider("*", provider),
    vscode.commands.registerCommand(RUN_COMMAND, (args: RunArgs | KeyArgs | undefined) =>
      isKeyArgs(args) ? runByLabel(args.action, server, log, sinks) : run(args as RunArgs, server, log, sinks),
    ),
  );
}

/**
 * Offers the configured quick actions on the current selection, as both a
 * lightbulb entry and a code lens. Which of the two appear is a setting; the
 * action list behind them is the same.
 */
class QuickActionProvider implements vscode.CodeActionProvider, vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private refresh: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners: vscode.Disposable[];

  constructor() {
    this.listeners = [
      // `provideCodeLenses` is handed a document, never a selection, so the
      // only way to follow the selection is to invalidate on every move.
      vscode.window.onDidChangeTextEditorSelection(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("raycastBridge.quickActions") ||
          event.affectsConfiguration("raycastBridge.quickActionsUI")
        ) {
          this.changed.fire();
        }
      }),
    ];
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!surfaces().lightbulb || range.isEmpty) {
      return [];
    }
    return quickActions().map((action, index) => {
      // RefactorRewrite is a taxonomy choice, not a claim: it is the kind the
      // lightbulb offers for a selection, which is where these belong.
      const item = new vscode.CodeAction(action.label, vscode.CodeActionKind.RefactorRewrite);
      item.command = { command: RUN_COMMAND, title: action.label, arguments: [runArgs(index, document.uri, range)] };
      return item;
    });
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const editor = vscode.window.activeTextEditor;
    if (!surfaces().codeLens || !editor || editor.document.uri.toString() !== document.uri.toString()) {
      return [];
    }
    const { selection } = editor;
    if (selection.isEmpty) {
      return [];
    }
    // Lenses sharing one empty range render side by side on the row above it.
    const anchor = new vscode.Range(selection.start, selection.start);
    return quickActions().map(
      (action, index) =>
        new vscode.CodeLens(anchor, {
          command: RUN_COMMAND,
          title: action.label,
          arguments: [runArgs(index, document.uri, selection)],
        }),
    );
  }

  dispose(): void {
    clearTimeout(this.refresh);
    this.changed.dispose();
    for (const listener of this.listeners) {
      listener.dispose();
    }
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refresh);
    this.refresh = setTimeout(() => this.changed.fire(), SELECTION_DEBOUNCE_MS);
  }
}

/**
 * The keybinding entry point: `{ "action": "<label>" }` in keybindings.json.
 *
 * Every failure here is announced. A key press that quietly does nothing is
 * indistinguishable from a broken binding, and the label is hand-typed into a
 * file VSCode does not validate.
 */
async function runByLabel(
  label: unknown,
  server: BridgeServer,
  log: vscode.LogOutputChannel,
  sinks: AnswerSinks,
): Promise<void> {
  const actions = quickActions();
  const action = findQuickAction(actions, label);
  if (!action) {
    const named = typeof label === "string" && label.trim() ? `"${label.trim()}"` : "that";
    void vscode.window.showWarningMessage(`Raycast: no quick action named ${named}.`);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("Raycast: select some text first.");
    return;
  }
  await run(runArgs(actions.indexOf(action), editor.document.uri, editor.selection), server, log, sinks);
}

async function run(
  args: RunArgs,
  server: BridgeServer,
  log: vscode.LogOutputChannel,
  sinks: AnswerSinks,
): Promise<void> {
  const action: QuickAction | undefined = quickActions()[args.index];
  if (!action) {
    return; // The setting changed between rendering the entry and clicking it.
  }
  const uri = vscode.Uri.parse(args.uri);
  const range = new vscode.Range(args.range[0], args.range[1], args.range[2], args.range[3]);
  const document = vscode.workspace.textDocuments.find((open) => open.uri.toString() === uri.toString());
  const selected = document?.getText(range) ?? "";
  if (!selected.trim()) {
    return;
  }

  const owner = vscode.workspace.getConfiguration("raycastBridge").get<string>("owner")?.trim();
  if (!owner) {
    void vscode.window.showErrorMessage("Raycast Bridge: set raycastBridge.owner first.");
    return;
  }

  // Creativity is deliberately not passed: half of Raycast's models reject a
  // temperature outright, and a quick action can name any of them.
  const request = {
    owner,
    prompt: buildQuickPrompt(action, selected),
    ...(action.model ? { model: action.model } : {}),
  };

  const session = display(sinks).open({ uri, range, title: action.label });

  // Window progress, not a notification: a notification takes focus, and
  // `editor.action.showHover` is a no-op unless the editor still has it.
  const { result, body } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Raycast: ${action.label}` },
    async () => {
      let collected = "";
      const done = await askRaycast(server, request, (text) => {
        collected += text;
        // Already batched to one call per 120ms by the Raycast side.
        session.update(collected);
      }, { log: (message) => log.info(message) });
      return { result: done, body: collected };
    },
  );

  if (!result.ok) {
    session.dispose();
    log.error(`quick action "${action.label}" failed: ${result.error}`);
    void vscode.window.showErrorMessage(`Raycast: ${action.label} failed. ${result.error}`);
    return;
  }
  if (!body.trim()) {
    session.dispose();
    log.warn(`quick action "${action.label}" returned nothing`);
    void vscode.window.showWarningMessage(`Raycast: ${action.label} returned an empty answer.`);
    return;
  }
  await session.done(body.trim());
}

function runArgs(index: number, uri: vscode.Uri, range: vscode.Range): RunArgs {
  return {
    index,
    uri: uri.toString(),
    range: [range.start.line, range.start.character, range.end.line, range.end.character],
  };
}

function quickActions(): QuickAction[] {
  return parseQuickActions(vscode.workspace.getConfiguration("raycastBridge").get("quickActions"));
}

function display(sinks: AnswerSinks): AnswerSink {
  const mode = vscode.workspace.getConfiguration("raycastBridge").get<string>("quickActionsDisplay");
  return mode === "hover" ? sinks.hover : sinks.inline;
}

function surfaces(): { lightbulb: boolean; codeLens: boolean } {
  const mode = vscode.workspace.getConfiguration("raycastBridge").get<string>("quickActionsUI") ?? "both";
  return {
    lightbulb: mode === "both" || mode === "lightbulb",
    codeLens: mode === "both" || mode === "codeLens",
  };
}
