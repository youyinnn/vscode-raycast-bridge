import * as vscode from "vscode";
import { openDeeplink, withSelection, type SelectionTarget } from "../bridge/deeplink";

type ConfiguredCommand = SelectionTarget & { label: string };

export async function runCommand(): Promise<void> {
  const commands = vscode.workspace
    .getConfiguration("raycastBridge")
    .get<ConfiguredCommand[]>("commands", []);

  if (commands.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      "No Raycast commands configured. Copy a deeplink from Raycast (Copy Deeplink action) and add it to raycastBridge.commands.",
      "Open Settings",
    );
    if (choice) {
      await vscode.commands.executeCommand("workbench.action.openSettings", "raycastBridge.commands");
    }
    return;
  }

  const picked = await vscode.window.showQuickPick(
    commands.map((command) => ({ label: command.label, detail: command.deeplink, command })),
    { placeHolder: "Run a Raycast command" },
  );
  if (!picked) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const selection = editor
    ? editor.selection.isEmpty
      ? editor.document.getText()
      : editor.document.getText(editor.selection)
    : "";

  await openDeeplink(withSelection(picked.command, selection));
}
