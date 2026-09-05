/** Characters a comment body fits per line at a typical editor width. */
const WRAP = 90;
/**
 * VSCode caps a comment body at 20em (`comments.maxHeight`), which is about a
 * dozen wrapped lines of prose once paragraph spacing is counted.
 */
const CAP_LINES = 12;

/** Whether `body` would be cut off by VSCode's default comment height cap. */
export function isLongAnswer(body: string): boolean {
  const lines = body
    .split("\n")
    .filter((line) => line.trim() !== "")
    .reduce((sum, line) => sum + Math.ceil(line.length / WRAP), 0);
  return lines >= CAP_LINES;
}
