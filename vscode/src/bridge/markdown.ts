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

/**
 * A `command:` link for a `MarkdownString`, with its arguments attached.
 *
 * VSCode expects the arguments as a URI-encoded JSON *array*, so a single
 * argument object still has to be wrapped in one. Only a string with
 * `isTrusted` naming the command will actually run it; encoding one here
 * grants nothing on its own.
 *
 * `encodeURIComponent` leaves parentheses alone, which is safe in a URI and
 * not safe here: the link is about to be written as `[text](uri)`, and the
 * first `)` in the payload would end it early and spill the rest as text.
 */
export function commandUri(command: string, args: unknown): string {
  const encoded = encodeURIComponent(JSON.stringify([args])).replace(
    /[()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `command:${command}?${encoded}`;
}

/**
 * A Markdown link whose text is not trusted to be link-safe.
 *
 * Quick action labels are written by hand in settings, and a `]` in one would
 * close the link text early, leaving the rest of the label and the whole URI
 * on screen as literal text. Escaping both brackets is enough: the text sits
 * inside `[...]`, so nothing else in it can end the construct.
 */
export function markdownLink(text: string, uri: string): string {
  return `[${text.replace(/[[\]]/g, "\\$&")}](${uri})`;
}
