import { describe, expect, it } from "vitest";
import {
  lineRangeLabel,
  paragraphAround,
  selectionOrCursorLine,
  type DocumentLines,
} from "./selectionTarget";

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

/**
 * A document built from a plain string, so the tests read as the text they
 * are about. Blankness matches `TextLine.isEmptyOrWhitespace`.
 */
function linesOf(text: string): DocumentLines {
  const lines = text.split("\n");
  return {
    count: lines.length,
    isBlank: (line) => lines[line].trim() === "",
    lengthOf: (line) => lines[line].length,
  };
}

describe("paragraphAround", () => {
  const doc = linesOf("alpha\nbeta\n\ngamma\ndelta\nepsilon\n\n  \nzeta");

  it("spans the run of non-blank lines the cursor sits in", () => {
    expect(paragraphAround(4, doc)).toEqual([3, 0, 5, 7]);
  });

  it("stops at the start of the document rather than running off it", () => {
    expect(paragraphAround(1, doc)).toEqual([0, 0, 1, 4]);
  });

  it("stops at the end of the document rather than running off it", () => {
    expect(paragraphAround(8, doc)).toEqual([8, 0, 8, 4]);
  });

  it("treats a whitespace-only line as a paragraph break", () => {
    expect(paragraphAround(5, doc)).toEqual([3, 0, 5, 7]);
  });

  it("returns nothing for a cursor on a blank line", () => {
    expect(paragraphAround(2, doc)).toBeUndefined();
  });

  it("returns nothing for a cursor on a whitespace-only line", () => {
    expect(paragraphAround(7, doc)).toBeUndefined();
  });

  it("returns nothing for an empty document", () => {
    expect(paragraphAround(0, linesOf(""))).toBeUndefined();
  });

  it("finds a paragraph of a single line", () => {
    expect(paragraphAround(2, linesOf("alpha\n\nbeta\n\ngamma"))).toEqual([2, 0, 2, 4]);
  });
})

describe("lineRangeLabel", () => {
  it("names a one-line range in the singular", () => {
    expect(lineRangeLabel([11, 0, 11, 6])).toBe("Line 12");
  });

  it("names a many-line range in the plural", () => {
    expect(lineRangeLabel([3, 0, 8, 4])).toBe("Lines 4-9");
  });

  it("counts from one, the way the editor's gutter does", () => {
    expect(lineRangeLabel([0, 0, 0, 5])).toBe("Line 1");
  });
})
