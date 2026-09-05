import * as vscode from "vscode";
import { askRaycast } from "../bridge/ask";
import type { BridgeServer } from "../bridge/server";
import type { CatalogStore } from "./catalogStore";

/**
 * Calls the Raycast model directly through the extension API, bypassing the
 * chat view and whichever agent normally drives it. This separates "our
 * provider is broken" from "the chat agent never called our provider".
 */
export async function testModel(
  log: vscode.LogOutputChannel,
  catalog: CatalogStore,
  server: BridgeServer,
): Promise<void> {
  // Goes straight down the bridge rather than through vscode.lm, so any model
  // in Raycast's catalog can be tried -- not just the ones added to settings.
  await catalog.ensure();
  const models = catalog.probeCandidates();
  const picked = await vscode.window.showQuickPick(
    models.map((m) => ({
      label: m.name,
      description: m.id,
      detail: [
        m.provider,
        `${Math.round(m.contextTokens / 1000)}K`,
        m.requiresBetterAi ? "needs Advanced AI" : undefined,
        m.unlisted ? "no metadata" : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      id: m.id,
    })),
    { placeHolder: "Which Raycast model should be tested?", matchOnDescription: true },
  );
  if (!picked) {
    return;
  }

  log.show();
  log.info(`--- direct bridge test: ${picked.id} ---`);

  const owner = vscode.workspace.getConfiguration("raycastBridge").get<string>("owner")?.trim();
  if (!owner) {
    void vscode.window.showErrorMessage("Raycast Bridge: set raycastBridge.owner first.");
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Asking ${picked.label}...` },
    async () => {
      let answer = "";
      const result = await askRaycast(
        server,
        { owner, prompt: "Reply with exactly: hello from Raycast", model: picked.id },
        (text) => {
          answer += text;
        },
        { log: (message) => log.info(message) },
      );
      if (result.ok) {
        log.info(`--- ${picked.id} OK, ${answer.length} char(s) ---`);
        void vscode.window.showInformationMessage(`${picked.label} works`, {
          modal: true,
          detail: answer || "(empty response)",
        });
      } else {
        log.error(`--- ${picked.id} FAILED: ${result.error} ---`);
        void vscode.window.showErrorMessage(`${picked.label} failed`, {
          modal: true,
          detail: `${result.error}\n\nmodel id: ${picked.id}`,
        });
      }
    },
  );
}
