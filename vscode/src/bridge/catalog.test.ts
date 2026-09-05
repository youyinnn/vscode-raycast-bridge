import { describe, expect, it } from "vitest";
import { parseCatalog, unlistedModels } from "./catalog";

const payload = {
  models: [
    {
      id: "openai-gpt-5-mini",
      name: "GPT-5 mini",
      description: "A fast, cheap model.",
      context: 400,
      features: ["chat", "api"],
      availability: "public",
      requires_better_ai: false,
      provider_name: "OpenAI",
      speed: 4,
      intelligence: 2,
      cost: 2,
      pricing: { typical_message_usd: "0.00377" },
      abilities: { temperature: { supported: false } },
    },
    {
      id: "anthropic-claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      context: 200,
      features: ["chat", "api"],
      availability: "public",
      requires_better_ai: true,
    },
    {
      id: "no-api-model",
      name: "Emoji Only",
      context: 128,
      features: ["emoji_search"],
      availability: "public",
      requires_better_ai: false,
    },
    {
      id: "old-model",
      name: "Retired",
      context: 128,
      features: ["api"],
      availability: "deprecated",
      requires_better_ai: false,
      deprecation_replacement_model_id: "openai-gpt-5-mini",
    },
    {
      id: "no-context",
      name: "Unknown Budget",
      features: ["api"],
      availability: "public",
      requires_better_ai: false,
    },
    {
      id: "soft-retired",
      name: "Still Works",
      context: 200,
      features: ["api"],
      availability: "public",
      status: "deprecated",
      requires_better_ai: false,
      deprecation_replacement_model_id: "anthropic-claude-sonnet-4-6",
    },
  ],
  default_models: { chat: "openai-gpt-5-mini", api: "anthropic-claude-sonnet-4-6" },
};

describe("parseCatalog", () => {
  it("keeps only models reachable through the extension API", () => {
    expect(parseCatalog(payload).models.map((m) => m.id)).toEqual([
      "openai-gpt-5-mini",
      "anthropic-claude-sonnet-4-6",
    ]);
  });

  it("converts Raycast's thousands-of-tokens context into a token count", () => {
    const [mini] = parseCatalog(payload).models;
    expect(mini.contextTokens).toBe(400_000);
  });

  it("carries the display name and the Advanced AI requirement", () => {
    const [, sonnet] = parseCatalog(payload).models;
    expect(sonnet).toMatchObject({ name: "Claude Sonnet 4.6", requiresBetterAi: true });
  });

  it("reads the model AI.ask falls back to", () => {
    expect(parseCatalog(payload).defaultModelId).toBe("anthropic-claude-sonnet-4-6");
  });

  it("drops models with no usable context budget, since 0 breaks chat", () => {
    expect(parseCatalog(payload).models.map((m) => m.id)).not.toContain("no-context");
  });

  it("keeps only ids the local Raycast can decode when an allowlist is given", () => {
    const catalog = parseCatalog(payload, { allowIds: ["anthropic-claude-sonnet-4-6"] });
    expect(catalog.models.map((m) => m.id)).toEqual(["anthropic-claude-sonnet-4-6"]);
  });

  it("offers everything when no allowlist is given", () => {
    expect(parseCatalog(payload).models.length).toBe(2);
  });

  it("returns an empty catalog rather than throwing on a malformed payload", () => {
    expect(parseCatalog(null)).toEqual({ models: [], describedIds: [], replacements: {} });
    expect(parseCatalog({ models: "nope" })).toEqual({ models: [], describedIds: [], replacements: {} });
    expect(parseCatalog({ models: [{ id: 1 }] }).models).toEqual([]);
  });

  it("carries the metadata that helps a user choose a model", () => {
    const [mini] = parseCatalog(payload).models;
    expect(mini).toMatchObject({
      description: "A fast, cheap model.",
      provider: "OpenAI",
      speed: 4,
      intelligence: 2,
      cost: 2,
      typicalMessageUsd: 0.00377,
    });
  });

  it("records which models reject a creativity setting", () => {
    const [mini, sonnet] = parseCatalog(payload).models;
    expect(mini.supportsTemperature).toBe(false);
    // Absent ability block: assume supported, which is the long-standing behaviour.
    expect(sonnet.supportsTemperature).toBe(true);
  });

  it("maps deprecated ids to their replacements so configs can be migrated", () => {
    expect(parseCatalog(payload).replacements).toEqual({
      "old-model": "openai-gpt-5-mini",
      "soft-retired": "anthropic-claude-sonnet-4-6",
    });
  });

  it("hides status-deprecated models while still recording their replacement", () => {
    const catalog = parseCatalog(payload);
    expect(catalog.models.map((m) => m.id)).not.toContain("soft-retired");
    expect(catalog.replacements["soft-retired"]).toBe("anthropic-claude-sonnet-4-6");
  });

  it("omits metadata that Raycast did not publish rather than inventing it", () => {
    const [, sonnet] = parseCatalog(payload).models;
    expect(sonnet.typicalMessageUsd).toBeUndefined();
    expect(sonnet.speed).toBeUndefined();
  });
});

describe("unlistedModels", () => {
  const catalog = parseCatalog(payload);

  it("covers SDK ids the catalog says nothing about", () => {
    const extra = unlistedModels(["openai-gpt-5-mini", "baseten-deepseek-ai/DeepSeek-V4-Pro"], catalog, 64_000);
    expect(extra.map((m) => m.id)).toEqual(["baseten-deepseek-ai/DeepSeek-V4-Pro"]);
  });

  it("does not resurrect models the catalog describes but filters out", () => {
    // "old-model" and "soft-retired" are deprecated, so absent from models[]
    // but present in the payload; they must not come back as undescribed.
    const extra = unlistedModels(["old-model", "soft-retired"], catalog, 64_000);
    expect(extra).toEqual([]);
  });

  it("marks them unlisted and falls back to the given budget", () => {
    const [only] = unlistedModels(["groq-qwen/qwen3-32b"], catalog, 64_000);
    expect(only).toMatchObject({
      id: "groq-qwen/qwen3-32b",
      name: "groq-qwen/qwen3-32b",
      contextTokens: 64_000,
      unlisted: true,
      requiresBetterAi: false,
      supportsTemperature: true,
    });
  });

  it("returns nothing when every id is already catalogued", () => {
    expect(unlistedModels(["openai-gpt-5-mini"], catalog, 64_000)).toEqual([]);
  });
});
