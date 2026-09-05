import { describe, expect, it } from "vitest";
import { cursorOnAnswerLine } from "./focusTarget";

describe("cursorOnAnswerLine", () => {
  it("is true when the selection ends on the answer's last line in the same document", () => {
    expect(cursorOnAnswerLine({ uri: "file:///a", line: 7 }, { uri: "file:///a", endLine: 7 })).toBe(true);
  });

  it("is false in another document", () => {
    expect(cursorOnAnswerLine({ uri: "file:///b", line: 7 }, { uri: "file:///a", endLine: 7 })).toBe(false);
  });

  it("is false once the cursor has moved off the line", () => {
    expect(cursorOnAnswerLine({ uri: "file:///a", line: 8 }, { uri: "file:///a", endLine: 7 })).toBe(false);
  });

  it("is false without an active editor", () => {
    expect(cursorOnAnswerLine(undefined, { uri: "file:///a", endLine: 7 })).toBe(false);
  });
});
