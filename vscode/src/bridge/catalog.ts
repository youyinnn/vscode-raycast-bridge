/**
 * Raycast's public model catalog.
 *
 * `https://www.raycast.com/api/v1/ai/models` needs no authentication and is the
 * only place the per-model context window is published: the `AI.Model` enum in
 * @raycast/api carries ids and nothing else, and the shipped runtime carries no
 * model data at all.
 *
 * No `vscode` import, so this stays unit-testable.
 */

export const MODELS_URL = "https://www.raycast.com/api/v1/ai/models";

export type RaycastModel = {
  id: string;
  name: string;
  /** Input budget in tokens. Raycast publishes `context` in thousands. */
  contextTokens: number;
  /** True when the model needs Raycast's Advanced AI subscription. */
  requiresBetterAi: boolean;
  /**
   * False for 41 of the 80 models (every GPT-5 and reasoning model). Sending a
   * creativity to one of those is at best ignored, so the job omits it.
   */
  supportsTemperature: boolean;
  description?: string;
  provider?: string;
  /** Raycast's own 1-5 scores. */
  speed?: number;
  intelligence?: number;
  cost?: number;
  /** Raycast's estimate of one message's cost, in USD. */
  typicalMessageUsd?: number;
  /**
   * True for ids the SDK accepts but the catalog does not describe -- retired
   * hosting routes, most likely. Nothing but the id is known about these, so
   * they are only worth offering once a real call has proved they answer.
   */
  unlisted?: boolean;
};

export type Catalog = {
  models: RaycastModel[];
  /**
   * Every id the payload mentions, including ones filtered out. Without this,
   * "undescribed" would wrongly include models the catalog does describe but
   * hides -- deprecated ones especially -- and reintroduce them with
   * placeholder metadata.
   */
  describedIds: string[];
  /** What `AI.ask` uses when the job carries no model id. */
  defaultModelId?: string;
  /** Deprecated id -> its replacement, so a stale configured model can be migrated. */
  replacements: Record<string, string>;
};

const EMPTY: Catalog = { models: [], describedIds: [], replacements: {} };

export type ParseOptions = {
  /**
   * Restricts the result to these ids. Left unused by the extension: the SDK
   * enum turned out not to bound what Raycast accepts, and probe results decide
   * instead. Kept because narrowing the catalog is still a sensible operation.
   */
  allowIds?: readonly string[];
};

export function parseCatalog(payload: unknown, options: ParseOptions = {}): Catalog {
  if (!isRecord(payload) || !Array.isArray(payload.models)) {
    return EMPTY;
  }
  const allowed = options.allowIds ? new Set(options.allowIds) : undefined;

  const models: RaycastModel[] = [];
  const describedIds: string[] = [];
  const replacements: Record<string, string> = {};
  for (const entry of payload.models) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      continue;
    }
    describedIds.push(entry.id);
    // "api" is the feature flag for models reachable through AI.ask; anything
    // else is chat-only or a Raycast-internal model we cannot drive.
    const features = Array.isArray(entry.features) ? entry.features : [];
    if (typeof entry.deprecation_replacement_model_id === "string") {
      replacements[entry.id] = entry.deprecation_replacement_model_id;
    }
    // Raycast deprecates in two stages and both must be read: `availability`
    // means gone, `status` means still answering but unmaintained. Neither is
    // offered; both keep their replacement mapping so configs can be migrated.
    if (
      entry.availability === "deprecated" ||
      entry.status === "deprecated" ||
      !features.includes("api") ||
      (allowed && !allowed.has(entry.id))
    ) {
      continue;
    }
    // A zero budget makes Copilot Chat's prompt renderer throw, so a model
    // without a published context window is not worth offering.
    const context = typeof entry.context === "number" ? entry.context : 0;
    if (context <= 0) {
      continue;
    }
    const abilities = isRecord(entry.abilities) ? entry.abilities : undefined;
    const temperature = isRecord(abilities?.temperature) ? abilities.temperature : undefined;
    const pricing = isRecord(entry.pricing) ? entry.pricing : undefined;

    models.push({
      id: entry.id,
      name: typeof entry.name === "string" && entry.name ? entry.name : entry.id,
      contextTokens: context * 1000,
      requiresBetterAi: entry.requires_better_ai === true,
      supportsTemperature: temperature?.supported !== false,
      ...optional("description", text(entry.description)),
      ...optional("provider", text(entry.provider_name)),
      ...optional("speed", score(entry.speed)),
      ...optional("intelligence", score(entry.intelligence)),
      ...optional("cost", score(entry.cost)),
      ...optional("typicalMessageUsd", money(pricing?.typical_message_usd)),
    });
  }

  const defaults = isRecord(payload.default_models) ? payload.default_models : undefined;
  const defaultModelId = typeof defaults?.api === "string" ? defaults.api : undefined;

  return defaultModelId
    ? { models, describedIds, replacements, defaultModelId }
    : { models, describedIds, replacements };
}

/** Returns the raw response so callers can cache it and parse with current rules. */
export async function fetchPayload(
  fetchImpl: typeof fetch = fetch,
  url: string = MODELS_URL,
): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Keeps absent metadata absent instead of turning it into a fabricated default. */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function score(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Raycast sends prices as decimal strings. */
function money(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Builds entries for SDK ids the catalog does not describe, so they can at
 * least be probed. Everything except the id is a placeholder.
 */
export function unlistedModels(
  allowIds: readonly string[],
  catalog: Catalog,
  contextTokens: number,
): RaycastModel[] {
  const described = new Set(catalog.describedIds);
  return allowIds
    .filter((id) => !described.has(id))
    .map((id) => ({
      id,
      name: id,
      contextTokens,
      requiresBetterAi: false,
      supportsTemperature: true,
      unlisted: true,
    }));
}
