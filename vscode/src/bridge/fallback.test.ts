import { describe, expect, it } from "vitest";
import { looksLikeFallback } from "./fallback";

const DEFAULT_ID = "openai-gpt-5.6-luna";

describe("looksLikeFallback", () => {
  it("spots the documented silent fallback to Raycast's default model", () => {
    // Observed: asking for DeepSeek V4 Pro, the answer identified as gpt-5.6-luna.
    expect(looksLikeFallback("gpt-5.6-luna", "baseten-deepseek-ai/DeepSeek-V4-Pro", DEFAULT_ID)).toBe(
      true,
    );
  });

  it("matches however the model spaces or capitalises its name", () => {
    expect(looksLikeFallback("I am GPT-5.6 Luna.", "xai-grok-4.6", DEFAULT_ID)).toBe(true);
  });

  it("clears a model that identifies as itself", () => {
    expect(looksLikeFallback("DeepSeek-V4-Pro", "gateway-deepseek/deepseek-v4-pro-0813", DEFAULT_ID)).toBe(
      false,
    );
  });

  it("never flags the default model itself", () => {
    expect(looksLikeFallback("gpt-5.6-luna", DEFAULT_ID, DEFAULT_ID)).toBe(false);
  });

  it("draws no conclusion when the reply names both models", () => {
    expect(
      looksLikeFallback("grok-4.6, not gpt-5.6-luna", "xai-grok-4.6", DEFAULT_ID),
    ).toBe(false);
  });

  it("draws no conclusion without a known default", () => {
    expect(looksLikeFallback("gpt-5.6-luna", "xai-grok-4.6", undefined)).toBe(false);
  });

  it("draws no conclusion from a reply that names no model", () => {
    expect(looksLikeFallback("I am an AI assistant.", "xai-grok-4.6", DEFAULT_ID)).toBe(false);
  });
});
