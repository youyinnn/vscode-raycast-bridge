import { describe, expect, it } from "vitest";
import { pickDismissTarget, type OpenAnswer } from "./dismissTarget";

const a = (key: string, uri: string, start: number, end: number): OpenAnswer => ({ key, uri, start, end });

describe("pickDismissTarget", () => {
  it("returns undefined when nothing is open", () => {
    expect(pickDismissTarget([], { uri: "file:///a", line: 3 })).toBeUndefined();
  });

  it("picks the only open answer even in another document", () => {
    expect(pickDismissTarget([a("x", "file:///b", 0, 0)], { uri: "file:///a", line: 3 })).toBe("x");
  });

  it("prefers the answer whose range contains the cursor line", () => {
    const open = [a("far", "file:///a", 0, 1), a("here", "file:///a", 10, 12), a("near", "file:///a", 13, 13)];
    expect(pickDismissTarget(open, { uri: "file:///a", line: 11 })).toBe("here");
  });

  it("falls back to the nearest answer in the same document", () => {
    const open = [a("above", "file:///a", 0, 1), a("below", "file:///a", 20, 22)];
    expect(pickDismissTarget(open, { uri: "file:///a", line: 17 })).toBe("below");
  });

  it("ignores other documents when the active one has answers", () => {
    const open = [a("other", "file:///b", 17, 17), a("mine", "file:///a", 0, 0)];
    expect(pickDismissTarget(open, { uri: "file:///a", line: 17 })).toBe("mine");
  });

  it("falls back to the most recently opened answer without an active document", () => {
    const open = [a("old", "file:///a", 0, 0), a("new", "file:///b", 5, 5)];
    expect(pickDismissTarget(open, undefined)).toBe("new");
  });
});
