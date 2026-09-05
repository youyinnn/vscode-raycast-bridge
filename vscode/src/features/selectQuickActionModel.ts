import * as vscode from "vscode";
import {
  DEFAULT_MODEL_LABEL,
  parseQuickActions,
  quickActionModelLabel,
  setQuickActionModel,
} from "../bridge/quickActions";
import type { CatalogStore } from "./catalogStore";

/** The entry that clears the pin and hands the choice back to Raycast. */
const CLEAR = "";

/**
 * Pins a Raycast model on one quick action, without hand-typing a model id.
 *
 * Two QuickPicks rather than a settings webview, for the same reason
 * `selectModels` is one: the value stays ordinary settings JSON, and the
 * filtering and theming come free.
 */
export async function selectQuickActionModel(catalog: CatalogStore): Promise<void> {
  const config = vscode.workspace.getConfiguration("raycastBridge");
  // The raw array is what gets written back: parsing drops malformed entries,
  // so parsed positions are not the positions the setting is indexed by.
  const raw = config.get<unknown[]>("quickActions", []);
  const entries = (Array.isArray(raw) ? raw : []).flatMap((entry, index) => {
    const [action] = parseQuickActions([entry]);
    return action ? [{ action, index }] : [];
  });
  if (!entries.length) {
    void vscode.window.showErrorMessage(
      "Raycast Bridge: no quick actions are configured. Add some under raycastBridge.quickActions first.",
    );
    return;
  }

  await catalog.ensure();
  const models = catalog.offered();
  if (!models.length) {
    void vscode.window.showErrorMessage(
      "Raycast Bridge: could not load Raycast's model catalog. Check your connection and try again.",
    );
    return;
  }

  const name = (id: string) => catalog.find(id)?.name;
  const chosen = await vscode.window.showQuickPick(
    entries.map(({ action, index }) => ({
      label: action.label,
      description: quickActionModelLabel(action, name),
      index,
    })),
    { placeHolder: "Quick action to set a model for" },
  );
  if (!chosen) {
    return;
  }

  const picked = await vscode.window.showQuickPick(
    [
      { label: `(${DEFAULT_MODEL_LABEL})`, description: "Let Raycast choose", detail: "", id: CLEAR },
      ...models.map((model) => ({
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
        id: model.id,
      })),
    ],
    {
      placeHolder: `Model for "${chosen.label}"`,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!picked) {
    return;
  }

  await config.update(
    "quickActions",
    setQuickActionModel(raw, chosen.index, picked.id || undefined),
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(
    picked.id
      ? `Raycast Bridge: "${chosen.label}" now uses ${picked.label}.`
      : `Raycast Bridge: "${chosen.label}" now uses Raycast's default model.`,
  );
}
