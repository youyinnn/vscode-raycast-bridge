import * as vscode from "vscode";
import { AnswerHover } from "./features/answerHover";
import { AnswerThread } from "./features/answerThread";
import { askAI } from "./features/askAI";
import { registerModelProvider } from "./features/modelProvider";
import { selectModels } from "./features/selectModels";
import { CatalogStore, migrateDeprecatedModels } from "./features/catalogStore";
import { diagnose } from "./features/diagnose";
import { testModel } from "./features/testModel";
import { probeModels } from "./features/probeModels";
import { registerQuickActions } from "./features/quickActions";
import { runCommand } from "./features/runCommand";
import { BridgeServer } from "./bridge/server";

export function activate(context: vscode.ExtensionContext): void {
  // Raycast is macOS only, and the bridge shells out to `open`.
  if (process.platform !== "darwin") {
    void vscode.window.showWarningMessage("Raycast Bridge requires macOS; its commands are disabled.");
    return;
  }

  const log = vscode.window.createOutputChannel("Raycast Bridge", { log: true });
  const server = new BridgeServer((message) => log.info(message));
  context.subscriptions.push(log, { dispose: () => server.dispose() });

  const catalog = new CatalogStore(context.globalState, log);
  registerModelProvider(context, server, log, catalog);
  void migrateDeprecatedModels(catalog, log);

  const hover = new AnswerHover();
  hover.register(context);
  const inline = new AnswerThread();
  inline.register(context);
  registerQuickActions(context, server, log, { hover, inline });

  context.subscriptions.push(
    vscode.commands.registerCommand("raycastBridge.askAI", () => askAI()),
    vscode.commands.registerCommand("raycastBridge.runCommand", () => runCommand()),
    vscode.commands.registerCommand("raycastBridge.selectModels", () => selectModels(catalog)),
    vscode.commands.registerCommand("raycastBridge.diagnose", () => diagnose()),
    vscode.commands.registerCommand("raycastBridge.showLog", () => log.show()),
    vscode.commands.registerCommand("raycastBridge.testModel", () => testModel(log, catalog, server)),
    vscode.commands.registerCommand("raycastBridge.probeModels", () => probeModels(log, catalog, server)),
  );
}

export function deactivate(): void {
  // Server teardown is handled through context.subscriptions.
}
