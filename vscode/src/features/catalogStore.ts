import * as vscode from "vscode";
import {
  fetchPayload,
  parseCatalog,
  unlistedModels,
  type Catalog,
  type RaycastModel,
} from "../bridge/catalog";
import { SDK_MODEL_IDS, SDK_VERSION } from "../models.sdk";
import { raycastAppVersion } from "../bridge/raycastApp";
import { PROBE_METHOD } from "../bridge/fallback";

/**
 * Holds the raw response, not the parsed catalog. Caching parsed data means a
 * change to the parsing rules -- which models are hidden, say -- has no effect
 * until the cache happens to expire, which is a bug that is invisible in tests.
 */
const CACHE_KEY = "raycastBridge.catalogPayload";

/**
 * Probe results, keyed by model id: "ok", or the error Raycast returned.
 * Which ids are accepted changes with the Raycast app, and with the SDK the
 * extension is built against, so verdicts recorded under either an older app or
 * an older SDK are discarded rather than left hiding models that now work.
 */
const SUPPORT_KEY = "raycastBridge.modelSupport";

/** Verdicts only hold for the app, SDK and probe method that produced them. */
function probedBy(): string {
  return `raycast@${raycastAppVersion() ?? "unknown"}/sdk@${SDK_VERSION}/probe@${PROBE_METHOD}`;
}

/** Stand-in budget for models the catalog does not describe. Must not be 0. */
const FALLBACK_CONTEXT_TOKENS = 128_000;

/**
 * Keeps Raycast's model catalog available without a build step.
 *
 * Fetched on first use and cached in global state, so a later start works
 * offline and new Raycast models appear without republishing the extension.
 */
export class CatalogStore {
  private payload: unknown;
  private catalog: Catalog;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.payload = memento.get<unknown>(CACHE_KEY);
    this.catalog = parseCatalog(this.payload);
  }

  /** Returns the cached catalog, fetching once if nothing has been cached yet. */
  async ensure(): Promise<Catalog> {
    if (this.catalog.models.length) {
      return this.catalog;
    }
    return this.refresh();
  }

  async refresh(): Promise<Catalog> {
    try {
      const payload = await fetchPayload();
      const fetched = parseCatalog(payload);
      if (!fetched.models.length) {
        this.log.warn("model catalog came back empty; keeping the cached one");
        return this.catalog;
      }
      this.payload = payload;
      this.catalog = fetched;
      await this.memento.update(CACHE_KEY, payload);
      this.log.info(`model catalog refreshed: ${fetched.models.length} model(s)`);
    } catch (error) {
      this.log.warn(
        `could not refresh the model catalog (${error instanceof Error ? error.message : String(error)}); using ${this.catalog.models.length} cached model(s)`,
      );
    }
    return this.catalog;
  }

  /**
   * Everything worth trying: every model the catalog describes, plus SDK ids it
   * does not mention. The SDK enum is deliberately not a filter -- it was never
   * shown to bound what works, its keys and values disagree, and the probe now
   * detects silent substitution, so guessing up front buys nothing.
   */
  probeCandidates(): RaycastModel[] {
    return [
      ...this.catalog.models,
      ...unlistedModels(SDK_MODEL_IDS, this.catalog, FALLBACK_CONTEXT_TOKENS),
    ];
  }

  /**
   * What the pickers show: described models that have not been proved broken,
   * plus undescribed ones only once a real call has proved they answer.
   */
  offered(): RaycastModel[] {
    const support = this.support();
    return this.probeCandidates().filter((model) =>
      model.unlisted ? support[model.id] === "ok" : support[model.id] !== undefined ? support[model.id] === "ok" : true,
    );
  }

  find(id: string): RaycastModel | undefined {
    return this.probeCandidates().find((model) => model.id === id);
  }

  /**
   * Raycast publishes models its own `AI.ask` then refuses, so support is
   * recorded from real calls. Unprobed models stay on offer -- absence of
   * evidence is not evidence of failure.
   */
  support(): Record<string, string> {
    const stored = this.memento.get<{ probedBy?: string; results?: Record<string, string> }>(SUPPORT_KEY);
    return stored?.probedBy === probedBy() && stored.results ? stored.results : {};
  }

  isKnownBad(id: string): boolean {
    const result = this.support()[id];
    return result !== undefined && result !== "ok";
  }

  async recordSupport(id: string, result: string): Promise<void> {
    await this.memento.update(SUPPORT_KEY, {
      probedBy: probedBy(),
      results: { ...this.support(), [id]: result },
    });
  }

  async clearSupport(): Promise<void> {
    await this.memento.update(SUPPORT_KEY, undefined);
  }
}

/**
 * Raycast retires models, and a configured id that no longer exists would just
 * go missing from the picker with no explanation. Say what happened, and offer
 * the published replacements where Raycast names one.
 */
export async function migrateDeprecatedModels(
  catalog: CatalogStore,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const { replacements } = await catalog.ensure();
  const config = vscode.workspace.getConfiguration("raycastBridge");
  const configured = config.get<string[]>("models", []);
  const stale = configured.filter((id) => !catalog.find(id));
  if (!stale.length) {
    return;
  }

  const replaceable = stale.filter((id) => replacements[id]);
  const orphaned = stale.filter((id) => !replacements[id]);
  const detail = [
    ...replaceable.map((id) => `${id} -> ${replacements[id]}`),
    ...orphaned.map((id) => `${id} (no replacement published)`),
  ].join("\n");
  log.warn(`configured models are no longer offered by Raycast:\n${detail}`);

  const choice = await vscode.window.showWarningMessage(
    `Raycast retired ${stale.length} of your configured model(s).`,
    { detail, modal: false },
    "Update settings",
    "Choose models...",
  );
  if (choice === "Choose models...") {
    await vscode.commands.executeCommand("raycastBridge.selectModels");
    return;
  }
  if (choice !== "Update settings") {
    return;
  }

  // Replaceable ids move to their successor; orphans are removed, since they
  // are the ones that would otherwise sit in settings doing nothing.
  const updated = [...new Set(configured.map((id) => replacements[id] ?? id))].filter((id) =>
    catalog.find(id),
  );
  await config.update("models", updated, vscode.ConfigurationTarget.Global);
  log.info(`migrated configured models to: ${updated.join(", ") || "(none)"}`);
  void vscode.window.showInformationMessage(
    orphaned.length
      ? `Raycast Bridge: migrated ${replaceable.length} model(s) and removed ${orphaned.length} with no replacement.`
      : `Raycast Bridge: migrated ${replaceable.length} model(s).`,
  );
}
