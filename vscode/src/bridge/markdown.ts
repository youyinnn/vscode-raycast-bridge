/**
 * Makes the line structure of an answer survive Markdown rendering.
 *
 * Both answer sinks render through `vscode.MarkdownString`, where a single
 * newline inside a paragraph is a soft break and collapses to a space. That
 * silently reflows anything line-oriented -- LaTeX, code, verse -- into one
 * long run, no matter how firmly the prompt asks the model to keep the
 * newlines. Two trailing spaces are Markdown's hard line break, so adding
 * them puts the model's own line structure back on screen.
 *
 * Blank lines are left untouched: they already separate paragraphs, and a
 * hard break before one only adds empty space.
 *
 * Applied when rendering, never to the stored answer, so Copy still yields
 * exactly what Raycast returned.
 */
export function preserveLineBreaks(text: string): string {
  return text.replace(/(\S)[ \t]*\r?\n(?=[ \t]*\S)/g, "$1  \n");
}
