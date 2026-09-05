import * as vscode from "vscode";

/**
 * `model` is a display name, not an id: it is shown so an answer says which
 * model produced it, which the action's label alone never revealed.
 *
 * `render: false` shows the answer as plain text. Markdown is the default,
 * but it eats LaTeX's `_` and `\`, refuses to wrap code blocks, and turns a
 * fenced answer into a horizontally scrolling box, so an action whose output
 * is meant to be read or copied verbatim can opt out.
 *
 * `cached` and `regenerate` come as a pair, set when the answer was replayed
 * from an earlier run rather than asked for again. A sink is told only that
 * there is a rerun available; it never learns what a cache is.
 */
export type AnswerTarget = {
  uri: vscode.Uri;
  range: vscode.Range;
  title: string;
  model?: string;
  render?: false;
  cached?: true;
  regenerate?: () => void;
};

/**
 * Where a quick action's answer is rendered.
 *
 * There are two implementations, chosen by `raycastBridge.quickActionsDisplay`,
 * because the two VSCode widgets that can show text beside a selection have
 * opposite trade-offs. A hover costs no layout but is dismissed by a scroll or
 * a click elsewhere, and its content is fixed the moment it opens. A comment
 * thread survives both and can be rewritten while Raycast is still generating,
 * at the price of pushing the following lines down.
 */
export interface AnswerSink {
  /** Starts an answer for `target`. The previous answer, if any, is dropped. */
  open(target: AnswerTarget): AnswerSession;
  /**
   * The rerun offered by the answer `arg` names, or `undefined` if that
   * answer is not this sink's.
   *
   * Both sinks put a Regenerate affordance on a replayed answer, and a
   * command id can only be registered once, so the command is owned by the
   * quick action feature and asks each sink whether the click was on one of
   * its own. `arg` is whatever VSCode marshals in: the comment thread whose
   * title bar was clicked, or nothing at all from a hover link.
   */
  rerun(arg: unknown): (() => void) | undefined;
}

export interface AnswerSession {
  /** The full text so far. Sinks that cannot render incrementally ignore it. */
  update(body: string): void;
  /** The complete text. Resolves once it is on screen. */
  done(body: string): Promise<void>;
  /** Abandons the answer: the request failed, or came back empty. */
  dispose(): void;
}
