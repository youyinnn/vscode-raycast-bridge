import { describe, expect, it } from "vitest";
import { selectionOrCursorLine } from "./selectionTarget";

describe("selectionOrCursorLine", () => {
  it("keeps a selection made within one line", () => {
    expect(selectionOrCursorLine([1, 2, 1, 5], 40)).toEqual([1, 2, 1, 5]);
  });

  it("keeps a selection spanning several lines", () => {
    expect(selectionOrCursorLine([1, 2, 3, 4], 40)).toEqual([1, 2, 3, 4]);
  });

  it("widens a bare cursor to the whole line it sits on", () => {
    expect(selectionOrCursorLine([7, 3, 7, 3], 42)).toEqual([7, 0, 7, 42]);
  });

  it("widens a cursor already at the start of its line", () => {
    expect(selectionOrCursorLine([7, 0, 7, 0], 42)).toEqual([7, 0, 7, 42]);
  });

  it("leaves a cursor on a blank line empty, so the caller can reject it", () => {
    expect(selectionOrCursorLine([7, 0, 7, 0], 0)).toEqual([7, 0, 7, 0]);
  });
});
