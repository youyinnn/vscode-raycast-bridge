/** An inline answer that is currently on screen. Lines are zero-based and inclusive. */
export type OpenAnswer = { key: string; uri: string; start: number; end: number };

/**
 * Chooses which open answer an Escape press should dismiss.
 *
 * VSCode tells an extension that *a* comment thread has focus, never which
 * one, so this guesses from the cursor: the answer is anchored under the text
 * the action ran on, and the selection is still there when Escape is pressed.
 * Order of preference: the answer whose range holds the cursor line, then the
 * nearest one in the same document, then the most recently opened answer.
 */
export function pickDismissTarget(
  open: readonly OpenAnswer[],
  active: { uri: string; line: number } | undefined,
): string | undefined {
  if (open.length === 0) {
    return undefined;
  }
  const local = active ? open.filter((answer) => answer.uri === active.uri) : [];
  if (local.length === 0 || !active) {
    return open[open.length - 1].key;
  }
  const distance = ({ start, end }: OpenAnswer) =>
    active.line < start ? start - active.line : active.line > end ? active.line - end : 0;
  return local.reduce((best, answer) => (distance(answer) < distance(best) ? answer : best)).key;
}
