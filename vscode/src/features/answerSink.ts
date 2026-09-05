import * as vscode from "vscode";

export type AnswerTarget = { uri: vscode.Uri; range: vscode.Range; title: string };

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
}

export interface AnswerSession {
  /** The full text so far. Sinks that cannot render incrementally ignore it. */
  update(body: string): void;
  /** The complete text. Resolves once it is on screen. */
  done(body: string): Promise<void>;
  /** Abandons the answer: the request failed, or came back empty. */
  dispose(): void;
}
