import { describe, expect, it } from "vitest";
import { isLongAnswer } from "./longAnswer";

describe("isLongAnswer", () => {
  it("is false for a short answer", () => {
    expect(isLongAnswer("Yes.\n\nIt is fine.")).toBe(false);
  });

  it("is true for many short lines", () => {
    expect(isLongAnswer(Array.from({ length: 14 }, (_, i) => `line ${i}`).join("\n"))).toBe(true);
  });

  it("counts a long paragraph as the lines it wraps into", () => {
    expect(isLongAnswer("word ".repeat(400))).toBe(true);
  });

  it("does not count blank lines as text", () => {
    expect(isLongAnswer("a\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nb")).toBe(false);
  });
});
