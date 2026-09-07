/**
 * Which text a quick action runs on.
 *
 * Deliberately free of any `vscode` import, so a range is the plain
 * `[startLine, startCharacter, endLine, endCharacter]` tuple the quick-action
 * command already passes across the command boundary.
 */

export type RangeTuple = [number, number, number, number];

/**
 * Widens a bare cursor to the whole line it sits on.
 *
 * A keybinding pressed with nothing selected used to do nothing at all, which
 * reads as a broken binding. Acting on the current line is what the user meant
 * often enough to be worth guessing, and the line is visible on screen, so the
 * guess is never a surprise.
 *
 * A blank line widens to an empty range rather than to nothing: the caller
 * already has to reject whitespace-only text, and rejecting it in one place
 * keeps the two entry points saying the same thing.
 */
export function selectionOrCursorLine(range: RangeTuple, lineLength: number): RangeTuple {
  const [startLine, startCharacter, endLine, endCharacter] = range;
  if (startLine !== endLine || startCharacter !== endCharacter) {
    return range;
  }
  return [startLine, 0, startLine, lineLength];
}

/**
 * The three things a paragraph scan needs from a document.
 *
 * A narrow shape rather than a `TextDocument`, for the same reason as the
 * range tuple above: this file stays free of `vscode`, and the tests build a
 * document out of a plain string.
 */
export type DocumentLines = {
  count: number;
  /** Whitespace-only counts as blank, matching `TextLine.isEmptyOrWhitespace`. */
  isBlank(line: number): boolean;
  lengthOf(line: number): number;
};

/**
 * The run of non-blank lines around `line`: a natural paragraph.
 *
 * Deliberately the literal reading of "consecutive non-blank lines", with no
 * language awareness. A Markdown fence with a blank line inside it will split
 * in two, and a heading will merge into the paragraph below it; both are
 * wrong in principle and predictable in practice, which is the trade this
 * makes. Anything smarter needs a `SelectionRangeProvider`, which most
 * languages do not have.
 *
 * A cursor on a blank line is in no paragraph at all, so it gets nothing
 * rather than the paragraph above or below: guessing a direction there would
 * act on text the user is not looking at.
 */
export function paragraphAround(line: number, lines: DocumentLines): RangeTuple | undefined {
  if (lines.isBlank(line)) {
    return undefined;
  }
  let first = line;
  while (first > 0 && !lines.isBlank(first - 1)) {
    first -= 1;
  }
  let last = line;
  while (last + 1 < lines.count && !lines.isBlank(last + 1)) {
    last += 1;
  }
  return [first, 0, last, lines.lengthOf(last)];
}

/**
 * "Lines 4-9": which lines an action is about to run on.
 *
 * A paragraph is chosen for the reader rather than by them, so the extent has
 * to be said out loud somewhere before the quota is spent. Numbered from one,
 * to match the gutter the reader is looking at rather than the tuple.
 */
export function lineRangeLabel(range: RangeTuple): string {
  const [startLine, , endLine] = range;
  return startLine === endLine ? `Line ${startLine + 1}` : `Lines ${startLine + 1}-${endLine + 1}`;
}
