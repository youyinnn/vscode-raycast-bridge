import * as vscode from "vscode";
import { askAI } from "./features/askAI";
import { runCommand } from "./features/runCommand";
import { BridgeServer } from "./bridge/server";

export function activate(context: vscode.ExtensionContext): void {
  // Raycast is macOS only, and the bridge shells out to `open`.
  if (process.platform !== "darwin") {
    void vscode.window.showWarningMessage("Raycast Bridge requires macOS; its commands are disabled.");
    return;
  }

  const server = new BridgeServer();
  context.subscriptions.push({ dispose: () => server.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("raycastBridge.askAI", () => askAI(server)),
    vscode.commands.registerCommand("raycastBridge.runCommand", () => runCommand()),
  );
}

export function deactivate(): void {
  // Server teardown is handled through context.subscriptions.
}
