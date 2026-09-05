/**
 * Whether VSCode's "Focus Comment on Current Line" would land on the answer.
 *
 * That command looks for a comment glyph on the line where the selection
 * ends, and the answer's glyph sits on the last line of the text it was run
 * on. It also raises an error notification when it finds nothing, so it is
 * only worth invoking while the two still coincide.
 */
export function cursorOnAnswerLine(
  active: { uri: string; line: number } | undefined,
  answer: { uri: string; endLine: number },
): boolean {
  return active !== undefined && active.uri === answer.uri && active.line === answer.endLine;
}
