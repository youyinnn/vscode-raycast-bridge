import { describe, expect, it } from "vitest";
import { MAX_SELECTION_CHARS, buildQuickPrompt, findQuickAction, parseQuickActions } from "./quickActions";

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
