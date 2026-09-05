import * as vscode from "vscode";
import type { CatalogStore } from "./catalogStore";

/**
 * Lets the user choose which Raycast models appear in VSCode's model picker.
 *
 * The settings editor has no multi-select control, so this is a QuickPick
 * rather than a bespoke settings webview: native filtering and theming, and
 * the value still lives in ordinary settings.
 */
export async function selectModels(catalog: CatalogStore): Promise<void> {
  await catalog.ensure();
  const models = catalog.offered();
  if (!models.length) {
    void vscode.window.showErrorMessage(
      "Raycast Bridge: could not load Raycast's model catalog. Check your connection and try again.",
    );
    return;
  }

  const config = vscode.workspace.getConfiguration("raycastBridge");
  const enabled = new Set(config.get<string[]>("models", []));

  const picked = await vscode.window.showQuickPick(
    models.map((model) => ({
      label: model.name,
      description: model.description ?? model.id,
      detail: [
        model.provider,
        `${Math.round(model.contextTokens / 1000)}K context`,
        model.typicalMessageUsd !== undefined ? `~$${model.typicalMessageUsd.toFixed(4)}/msg` : undefined,
        model.speed !== undefined ? `speed ${model.speed}/5` : undefined,
        model.intelligence !== undefined ? `intelligence ${model.intelligence}/5` : undefined,
        model.cost !== undefined ? `cost ${model.cost}/5` : undefined,
        model.requiresBetterAi ? "needs Advanced AI" : undefined,
        model.unlisted ? "no metadata published" : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      picked: enabled.has(model.id),
      id: model.id,
    })),
    {
      canPickMany: true,
      placeHolder: "Models to offer in the chat model picker (Raycast AI's default is always offered)",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!picked) {
    return;
  }

  await config.update(
    "models",
    [...new Set(picked.map((item) => item.id))],
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(
    picked.length
      ? `Raycast Bridge: offering ${picked.length} model(s) plus Raycast's default.`
      : "Raycast Bridge: offering Raycast's default model only.",
  );
}
