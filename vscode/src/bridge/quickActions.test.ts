import { describe, expect, it } from "vitest";
import {
  MAX_SELECTION_CHARS,
  buildQuickPrompt,
  findQuickAction,
  parseQuickActions,
  quickActionModelLabel,
  setQuickActionModel,
} from "./quickActions";

describe("parseQuickActions", () => {
  it("returns nothing when the setting is not an array", () => {
    expect(parseQuickActions(undefined)).toEqual([]);
    expect(parseQuickActions("translate")).toEqual([]);
    expect(parseQuickActions({ label: "a", prompt: "b" })).toEqual([]);
  });

  it("keeps well-formed entries in order", () => {
    expect(
      parseQuickActions([
        { label: "Translate", prompt: "Translate {{selection}}" },
        { label: "Explain", prompt: "Explain {{selection}}" },
      ]),
    ).toEqual([
      { label: "Translate", prompt: "Translate {{selection}}" },
      { label: "Explain", prompt: "Explain {{selection}}" },
    ]);
  });

  it("drops entries missing a label or a prompt rather than showing a blank menu item", () => {
    expect(
      parseQuickActions([
        { label: "Translate" },
        { prompt: "Explain this" },
        { label: "   ", prompt: "Explain this" },
        { label: "Explain", prompt: "  " },
        { label: 1, prompt: "Explain this" },
        null,
        "nope",
      ]),
    ).toEqual([]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseQuickActions([{ label: "  Translate  ", prompt: "  Do it  " }])).toEqual([
      { label: "Translate", prompt: "Do it" },
    ]);
  });

  it("carries an optional per-action model", () => {
    expect(parseQuickActions([{ label: "a", prompt: "b", model: "openai-gpt-4" }])).toEqual([
      { label: "a", prompt: "b", model: "openai-gpt-4" },
    ]);
  });

  it("ignores a model that is not a non-empty string, keeping the action itself", () => {
    expect(parseQuickActions([{ label: "a", prompt: "b", model: 7 }])).toEqual([{ label: "a", prompt: "b" }]);
    expect(parseQuickActions([{ label: "a", prompt: "b", model: "  " }])).toEqual([{ label: "a", prompt: "b" }]);
  });
});

describe("buildQuickPrompt", () => {
  const action = (prompt: string) => ({ label: "x", prompt });

  it("substitutes the selection for the placeholder", () => {
    expect(buildQuickPrompt(action("Translate to Chinese:\n\n{{selection}}"), "Hello")).toBe(
      "Translate to Chinese:\n\nHello",
    );
  });

  it("substitutes every occurrence", () => {
    expect(buildQuickPrompt(action("{{selection}} / {{selection}}"), "a")).toBe("a / a");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(buildQuickPrompt(action("Say {{ selection }}"), "hi")).toBe("Say hi");
  });

  it("appends the selection when the prompt has no placeholder", () => {
    expect(buildQuickPrompt(action("Translate to Chinese."), "Hello")).toBe("Translate to Chinese.\n\nHello");
  });

  it("gives the same prompt whether a trailing placeholder is written out or left off", () => {
    // The shipped defaults rely on this: they omit the placeholder entirely.
    const instruction = "Translate the following text into Chinese. Output only the translation.";
    const selection = "High RCAP scores are not evidence.";
    expect(buildQuickPrompt(action(instruction), selection)).toBe(
      buildQuickPrompt(action(`${instruction}\n\n{{selection}}`), selection),
    );
  });

  it("inserts dollar patterns literally, since they are replacement syntax", () => {
    expect(buildQuickPrompt(action("[{{selection}}]"), "$& $' $` $1")).toBe("[$& $' $` $1]");
  });

  it("trims the prompt but leaves the selection's own whitespace alone", () => {
    expect(buildQuickPrompt(action("  Explain:\n{{selection}}  "), "  indented  ")).toBe(
      "Explain:\n  indented",
    );
  });

  it("truncates an oversized selection, because Raycast AI charges per request", () => {
    const huge = "x".repeat(MAX_SELECTION_CHARS + 500);
    expect(buildQuickPrompt(action("{{selection}}"), huge)).toBe("x".repeat(MAX_SELECTION_CHARS));
  });

  it("truncates before substituting, not after, so the prompt itself survives", () => {
    const huge = "x".repeat(MAX_SELECTION_CHARS + 500);
    expect(buildQuickPrompt(action("Explain:\n\n{{selection}}"), huge)).toBe(
      `Explain:\n\n${"x".repeat(MAX_SELECTION_CHARS)}`,
    );
  });
});

describe("findQuickAction", () => {
  const actions = [
    { label: "Translate to Chinese", prompt: "Translate it." },
    { label: "Explain", prompt: "Explain it." },
  ];

  it("finds the action whose label matches", () => {
    expect(findQuickAction(actions, "Explain")).toBe(actions[1]);
  });

  it("ignores surrounding whitespace in the requested label", () => {
    expect(findQuickAction(actions, "  Explain  ")).toBe(actions[1]);
  });

  it("ignores case, so a keybinding need not reproduce it exactly", () => {
    expect(findQuickAction(actions, "translate TO chinese")).toBe(actions[0]);
  });

  it("returns undefined when no label matches", () => {
    expect(findQuickAction(actions, "Summarise")).toBeUndefined();
  });

  it("returns undefined for a label that is not a non-empty string", () => {
    expect(findQuickAction(actions, "   ")).toBeUndefined();
    expect(findQuickAction(actions, undefined)).toBeUndefined();
    expect(findQuickAction(actions, 1)).toBeUndefined();
  });

  it("takes the first of two actions sharing a label", () => {
    const duplicated = [...actions, { label: "Explain", prompt: "Explain it differently." }];
    expect(findQuickAction(duplicated, "Explain")).toBe(duplicated[1]);
  });
});

describe("quickActionModelLabel", () => {
  const named = (id: string) => (id === "anthropic-claude-sonnet-5" ? "Claude Sonnet 5" : undefined);

  it("names Raycast's default when the action pins no model", () => {
    expect(quickActionModelLabel({ label: "a", prompt: "b" }, named)).toBe("default model");
  });

  it("uses the catalog's display name for a model it describes", () => {
    expect(quickActionModelLabel({ label: "a", prompt: "b", model: "anthropic-claude-sonnet-5" }, named)).toBe(
      "Claude Sonnet 5",
    );
  });

  it("falls back to the raw id, since the catalog does not describe every usable model", () => {
    expect(quickActionModelLabel({ label: "a", prompt: "b", model: "gateway-deepseek/deepseek-v4-flash" }, named)).toBe(
      "gateway-deepseek/deepseek-v4-flash",
    );
  });
});

describe("setQuickActionModel", () => {
  const raw = () => [
    { label: "Translate", prompt: "Translate it.", model: "old-model" },
    { label: "Explain", prompt: "Explain it." },
  ];

  it("pins a model on the chosen entry", () => {
    expect(setQuickActionModel(raw(), 1, "anthropic-claude-opus-5")[1]).toEqual({
      label: "Explain",
      prompt: "Explain it.",
      model: "anthropic-claude-opus-5",
    });
  });

  it("removes the key rather than writing an empty one when clearing", () => {
    expect(setQuickActionModel(raw(), 0, undefined)[0]).toEqual({ label: "Translate", prompt: "Translate it." });
  });

  it("keeps fields it does not understand, since the setting is hand-edited", () => {
    const entry = [{ label: "a", prompt: "b", note: "mine" }];
    expect(setQuickActionModel(entry, 0, "m")[0]).toEqual({ label: "a", prompt: "b", note: "mine", model: "m" });
  });

  it("leaves the other entries untouched", () => {
    expect(setQuickActionModel(raw(), 1, "m")[0]).toEqual(raw()[0]);
  });

  it("does not mutate the array it was given", () => {
    const original = raw();
    setQuickActionModel(original, 0, "m");
    expect(original).toEqual(raw());
  });

  it("returns the entries unchanged when the index is out of range", () => {
    expect(setQuickActionModel(raw(), 5, "m")).toEqual(raw());
    expect(setQuickActionModel("not an array", 0, "m")).toEqual([]);
  });
});

describe("parseQuickActions render flag", () => {
  it("keeps an explicit render: false", () => {
    expect(parseQuickActions([{ label: "a", prompt: "p", render: false }])).toEqual([
      { label: "a", prompt: "p", render: false },
    ]);
  });

  it("omits the flag when rendering is the default", () => {
    expect(parseQuickActions([{ label: "a", prompt: "p" }])).toEqual([{ label: "a", prompt: "p" }]);
    expect(parseQuickActions([{ label: "a", prompt: "p", render: true }])).toEqual([{ label: "a", prompt: "p" }]);
  });

  it("ignores a render value that is not a boolean", () => {
    expect(parseQuickActions([{ label: "a", prompt: "p", render: "no" }])).toEqual([{ label: "a", prompt: "p" }]);
  });
});
