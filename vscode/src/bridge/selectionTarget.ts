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
