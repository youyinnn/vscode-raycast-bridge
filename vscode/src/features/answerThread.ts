import * as vscode from "vscode";
import { preserveLineBreaks } from "../bridge/markdown";
import type { AnswerSession, AnswerSink, AnswerTarget } from "./answerSink";

const CONTROLLER_ID = "raycastBridge.answers";
const DISMISS_COMMAND = "raycastBridge.dismissAnswer";
const DISMISS_ALL_COMMAND = "raycastBridge.dismissAllAnswers";
const PLACEHOLDER = "_Asking Raycast..._";
/** Names the Comments panel group, and stands in when no model is known. */
const CONTROLLER_NAME = "Raycast AI";

/**
 * Renders an answer as a comment thread anchored under the selection.
 *
 * Unlike a hover this survives scrolling, clicking elsewhere and switching
 * files: it goes away only when dismissed. Its body can also be reassigned
 * mid-flight, so the answer streams in as Raycast generates it.
 *
 * Any number of threads coexist. Re-running an action over the same text
 * replaces that answer instead of stacking a second block on the same line.
 */
export class AnswerThread implements AnswerSink {
  private controller: vscode.CommentController | undefined;
  private readonly threads = new Map<string, vscode.CommentThread>();

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      // VSCode marshals the thread whose title bar was clicked into the argument.
      vscode.commands.registerCommand(DISMISS_COMMAND, (thread?: vscode.CommentThread) =>
        this.dismiss(thread),
      ),
      vscode.commands.registerCommand(DISMISS_ALL_COMMAND, () => this.dismissAll()),
      {
        dispose: () => {
          this.dismissAll();
          this.controller?.dispose();
          this.controller = undefined;
        },
      },
    );
  }

  open(target: AnswerTarget): AnswerSession {
    const key = anchor(target);
    this.threads.get(key)?.dispose();

    // The comment's author line is where "who answered this" belongs, and
    // VSCode renders it in bold above the body: the bridge, then the model.
    const author = target.model ? `${CONTROLLER_NAME} · ${target.model}` : CONTROLLER_NAME;
    const thread = this.ensureController().createCommentThread(target.uri, target.range, [
      comment(PLACEHOLDER, author),
    ]);
    // The title bar says which action ran; the author line says which model.
    thread.label = target.title;
    thread.canReply = false;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    // Gates the Dismiss button's `when` clause in the thread's title bar.
    thread.contextValue = CONTROLLER_ID;
    this.threads.set(key, thread);

    // Guarded against this thread having been dismissed or replaced already:
    // an in-flight request must not write into a block that is gone.
    const render = (body: string) => {
      if (this.threads.get(key) === thread) {
        thread.comments = [comment(body, author)];
      }
    };

    return {
      update: (body) => render(body.trim() || PLACEHOLDER),
      done: async (body) => render(body),
      dispose: () => this.remove(key, thread),
    };
  }

  private dismiss(thread?: vscode.CommentThread): void {
    for (const [key, open] of this.threads) {
      if (open === thread) {
        this.remove(key, open);
        return;
      }
    }
    // Not one of ours to track, but the user still asked for it to go.
    thread?.dispose();
  }

  private dismissAll(): void {
    for (const thread of this.threads.values()) {
      thread.dispose();
    }
    this.threads.clear();
  }

  private remove(key: string, thread: vscode.CommentThread): void {
    if (this.threads.get(key) === thread) {
      this.threads.delete(key);
    }
    thread.dispose();
  }

  /** Created on first use, so choosing the hover never adds a Comments panel entry. */
  private ensureController(): vscode.CommentController {
    this.controller ??= vscode.comments.createCommentController(CONTROLLER_ID, CONTROLLER_NAME);
    return this.controller;
  }
}

/**
 * Identifies the text an answer belongs to.
 *
 * Taken once, at creation: VSCode shifts a thread's range as the document is
 * edited, so a drifted thread stops matching this key and a later action over
 * the same text opens a second block rather than replacing it. That is the
 * lesser evil -- tracking the live range would mean replacing an answer the
 * user is still reading.
 */
function anchor({ uri, range }: AnswerTarget): string {
  return `${uri.toString()}#${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

/** Left untrusted deliberately: the body is model output, so no command links. */
function comment(body: string, author: string): vscode.Comment {
  return {
    body: new vscode.MarkdownString(preserveLineBreaks(body)),
    mode: vscode.CommentMode.Preview,
    // Required by the API, and rendered whatever it holds, so it carries the
    // model rather than a constant that says nothing.
    author: { name: author },
  };
}
