/**
 * Flattens a conversation into the single string `AI.ask` accepts.
 *
 * Raycast AI has no session concept: `AI.ask(prompt, options)` takes one
 * string, and Raycast unloads the command process after every run, so no
 * state survives on that side. Multi-turn therefore means replaying the
 * whole exchange in the prompt each time.
 *
 * Deliberately free of any `vscode` import so it stays unit-testable; the
 * features layer converts `ChatRequestTurn`/`ChatResponseTurn` into `Turn`.
 */

export type Turn = { role: "user" | "assistant"; text: string };

export type Reference = { label: string; language: string; content: string };

export type ComposeInput = {
  question: string;
  history?: readonly Turn[];
  references?: readonly Reference[];
};

const ROLE_LABELS: Record<Turn["role"], string> = { user: "User", assistant: "Assistant" };

export function composePrompt({ question, history = [], references = [] }: ComposeInput): string {
  const blocks: string[] = [];

  const transcript = history
    .filter((turn) => turn.text.trim())
    .map((turn) => `${ROLE_LABELS[turn.role]}: ${turn.text.trim()}`);
  if (transcript.length) {
    blocks.push(["Earlier in this conversation:", ...transcript, "---"].join("\n\n"));
  }

  blocks.push(question.trim());

  for (const reference of references) {
    blocks.push(`${reference.label}:\n\n${fence(reference.content, reference.language)}`);
  }

  return blocks.join("\n\n");
}

/** Picks a fence longer than any backtick run in the content, so code containing fences survives. */
function fence(content: string, language: string): string {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${language}\n${content}\n${ticks}`;
}
