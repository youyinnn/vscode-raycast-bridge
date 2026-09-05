import * as vscode from "vscode";
import { askRaycast } from "../bridge/ask";
import type { BridgeServer } from "../bridge/server";
import { looksLikeFallback } from "../bridge/fallback";
import type { CatalogStore } from "./catalogStore";

/**
 * Finds out which catalogued models this Raycast install actually accepts.
 *
 * Raycast's catalog lists models its own `AI.ask` rejects with a decode error,
 * and nothing published says which. Rejections come back in milliseconds
 * without reaching the AI service, so probing is mostly free; only the models
 * that work cost a request, and those are paced to stay under the quota.
 */

/**
 * Self-identification, because a plain success proves nothing: Raycast answers
 * happily while silently serving its default model instead.
 */
const PROBE_PROMPT = "Which model are you? Reply with only the model identifier.";

/** Self-reports are kept for inspection, but not at unbounded length. */
const MAX_REPLY_CHARS = 80;
const PROBE_TIMEOUT_MS = 45_000;

/** Raycast allows 10 requests/minute. Only successes are believed to count. */
const PACE_MS = 7_000;

export async function probeModels(
  log: vscode.LogOutputChannel,
  catalog: CatalogStore,
  server: BridgeServer,
): Promise<void> {
  const owner = vscode.workspace.getConfiguration("raycastBridge").get<string>("owner")?.trim();
  if (!owner) {
    void vscode.window.showErrorMessage("Raycast Bridge: set raycastBridge.owner first.");
    return;
  }

  const { defaultModelId } = await catalog.ensure();
  const models = catalog.probeCandidates();
  const known = catalog.support();
  const pending = models.filter((model) => known[model.id] === undefined);
  if (!pending.length) {
    const choice = await vscode.window.showInformationMessage(
      `All ${models.length} model(s) have been probed already.`,
      { modal: true, detail: summarise(models.length, known) },
      "Probe again from scratch",
    );
    if (choice !== "Probe again from scratch") {
      return;
    }
    await catalog.clearSupport();
    return probeModels(log, catalog, server);
  }

  log.show();
  log.info(`--- probing ${pending.length} model(s) ---`);

  let ok = 0;
  let failed = 0;
  let substituted = 0;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Probing Raycast models", cancellable: true },
    async (progress, token) => {
      for (const [index, model] of pending.entries()) {
        if (token.isCancellationRequested) {
          break;
        }
        progress.report({
          message: `${index + 1}/${pending.length}  ${model.name}`,
          increment: 100 / pending.length,
        });

        let reply = "";
        const result = await askRaycast(
          server,
          {
            owner,
            prompt: PROBE_PROMPT,
            model: model.id,
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          },
          (text) => {
            reply += text;
          },
        );

        if (!result.ok) {
          failed += 1;
          await catalog.recordSupport(model.id, result.error);
          log.warn(`  REJECTED ${model.id}: ${result.error}`);
          continue;
        }

        const said = reply.trim().replace(/\s+/g, " ").slice(0, MAX_REPLY_CHARS);
        if (looksLikeFallback(reply, model.id, defaultModelId)) {
          substituted += 1;
          await catalog.recordSupport(model.id, `substituted: answered as "${said}"`);
          log.warn(`  FALLBACK ${model.id}: answered as "${said}"`);
        } else {
          ok += 1;
          await catalog.recordSupport(model.id, "ok");
          log.info(`  OK       ${model.id}  ("${said}")`);
        }
        // Only calls that reach the AI service are paced; rejections never do.
        await new Promise((resolve) => setTimeout(resolve, PACE_MS));
      }
    },
  );

  log.info(`--- probe done: ${ok} usable, ${substituted} substituted, ${failed} rejected ---`);
  void vscode.window.showInformationMessage("Raycast Bridge: model probe finished", {
    modal: true,
    detail: [
      `${ok} model(s) answered as themselves.`,
      `${substituted} silently answered as Raycast's default model instead.`,
      `${failed} were rejected outright.`,
      ``,
      `Only the first group is offered. Run "Raycast: Select Chat Models" to choose from them.`,
    ].join("\n"),
  });
}

function summarise(total: number, known: Record<string, string>): string {
  const values = Object.values(known);
  const ok = values.filter((value) => value === "ok").length;
  const substituted = values.filter((value) => value.startsWith("substituted:")).length;
  return `${ok} of ${total} answer as themselves; ${substituted} fall back to the default; ${values.length - ok - substituted} are rejected.`;
}
