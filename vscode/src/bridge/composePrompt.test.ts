import { describe, expect, it } from "vitest";
import { composePrompt } from "./composePrompt";

describe("composePrompt", () => {
  it("passes a bare question through untouched", () => {
    expect(composePrompt({ question: "What is a monad?" })).toBe("What is a monad?");
  });

  it("appends referenced code as a fenced block", () => {
    const prompt = composePrompt({
      question: "Explain this.",
      references: [{ label: "src/a.ts", language: "typescript", content: "const x = 1;" }],
    });
    expect(prompt).toBe(
      ["Explain this.", "", "src/a.ts:", "", "```typescript", "const x = 1;", "```"].join("\n"),
    );
  });

  it("widens the fence so content containing backticks stays inside it", () => {
    const prompt = composePrompt({
      question: "Explain this.",
      references: [{ label: "notes.md", language: "markdown", content: "```js\nlet a;\n```" }],
    });
    expect(prompt).toContain("````markdown\n```js\nlet a;\n```\n````");
  });

  it("keeps several references in order", () => {
    const prompt = composePrompt({
      question: "Compare them.",
      references: [
        { label: "a.ts", language: "typescript", content: "1" },
        { label: "b.ts", language: "typescript", content: "2" },
      ],
    });
    expect(prompt.indexOf("a.ts:")).toBeLessThan(prompt.indexOf("b.ts:"));
  });

  it("replays history before the question, since Raycast AI has no session", () => {
    const prompt = composePrompt({
      question: "And the second one?",
      history: [
        { role: "user", text: "Name a colour." },
        { role: "assistant", text: "Blue." },
      ],
    });
    expect(prompt).toBe(
      [
        "Earlier in this conversation:",
        "",
        "User: Name a colour.",
        "",
        "Assistant: Blue.",
        "",
        "---",
        "",
        "And the second one?",
      ].join("\n"),
    );
  });

  it("drops blank turns rather than emitting empty roles", () => {
    const prompt = composePrompt({
      question: "Go on.",
      history: [
        { role: "user", text: "Hi" },
        { role: "assistant", text: "   " },
      ],
    });
    expect(prompt).not.toContain("Assistant:");
    expect(prompt).toContain("User: Hi");
  });

  it("omits the history block entirely when every turn is blank", () => {
    const prompt = composePrompt({ question: "Go on.", history: [{ role: "user", text: "" }] });
    expect(prompt).toBe("Go on.");
  });

  it("orders history, then question, then references", () => {
    const prompt = composePrompt({
      question: "Now refactor it.",
      history: [{ role: "user", text: "Explain it." }],
      references: [{ label: "a.ts", language: "typescript", content: "1" }],
    });
    expect(prompt.indexOf("Earlier in this conversation")).toBeLessThan(prompt.indexOf("Now refactor it."));
    expect(prompt.indexOf("Now refactor it.")).toBeLessThan(prompt.indexOf("a.ts:"));
  });
});
