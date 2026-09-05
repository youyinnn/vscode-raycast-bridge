import * as vscode from "vscode";
import { raycastAppVersion } from "../bridge/raycastApp";
import { SDK_VERSION } from "../models.sdk";

/**
 * Reports what the language model service actually sees, so provider problems
 * can be diagnosed from a dialog instead of by hunting through trace logs.
 */
export async function diagnose(): Promise<void> {
  const config = vscode.workspace.getConfiguration("raycastBridge");
  const configured = config.get<string[]>("models", []);

  let discovered: string;
  try {
    const models = await vscode.lm.selectChatModels({ vendor: "raycast" });
    discovered = models.length
      ? `${models.length} model(s):\n${models.map((m) => `  - ${m.id}  (${m.name})`).join("\n")}`
      : "0 models -- the provider registered nothing, or registration failed.";
  } catch (error) {
    discovered = `selectChatModels threw: ${error instanceof Error ? error.message : String(error)}`;
  }

  let allModels: string;
  try {
    const models = await vscode.lm.selectChatModels();
    allModels = models.length
      ? models.map((m) => `  - ${m.vendor} / ${m.id}  (${m.name})`).join("\n")
      : "  (none)";
  } catch (error) {
    allModels = `  threw: ${error instanceof Error ? error.message : String(error)}`;
  }

  const detail = [
    `Extension active: yes (this command ran)`,
    `vscode.lm.registerLanguageModelChatProvider: ${
      typeof vscode.lm.registerLanguageModelChatProvider === "function" ? "available" : "MISSING"
    }`,
    `VSCode version: ${vscode.version}`,
    `Raycast app: ${raycastAppVersion() ?? "not found"}   (@raycast/api ${SDK_VERSION})`,
    ``,
    `Models the LM service sees for vendor "raycast": ${discovered}`,
    ``,
    `Every model the extension API can see:`,
    allModels,
    ``,
    `raycastBridge.owner: ${config.get<string>("owner")?.trim() || "(not set)"}`,
    `raycastBridge.models: ${configured.length ? configured.join(", ") : "(empty -- default entry only)"}`,
  ].join("\n");

  const choice = await vscode.window.showInformationMessage(
    "Raycast Bridge diagnostics",
    { modal: true, detail },
    "Copy",
  );
  if (choice === "Copy") {
    await vscode.env.clipboard.writeText(detail);
  }
}
