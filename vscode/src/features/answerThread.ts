import * as vscode from "vscode";
import { pickDismissTarget } from "../bridge/dismissTarget";
import { cursorOnAnswerLine } from "../bridge/focusTarget";
import { isLongAnswer } from "../bridge/longAnswer";
import { preserveLineBreaks } from "../bridge/markdown";
import type { AnswerSession, AnswerSink, AnswerTarget } from "./answerSink";

const CONTROLLER_ID = "raycastBridge.answers";
/** `contextValue` for a replayed answer, which alone offers Regenerate. */
const RERUNNABLE_CONTEXT = "raycastBridge.answers.cached";
const DISMISS_COMMAND = "raycastBridge.dismissAnswer";
const DISMISS_ALL_COMMAND = "raycastBridge.dismissAllAnswers";
const PLACEHOLDER = "Asking Raycast...";
/** Names the Comments panel group, and stands in when no model is known. */
const CONTROLLER_NAME = "Raycast AI";
/**
 * How long to wait before asking VSCode to focus a new thread. The widget is
 * built on the main thread after an async hop or two -- more on the first
 * answer, when the comment controller itself is still being set up -- and
 * the focus command reports "no comment on this line" as an error notification
 * if it runs too early.
 */
const FOCUS_DELAY_MS = 150;
/** globalState key: the user declined the offer to lift VSCode's comment height cap. */
const CAP_PROMPT_DECLINED = "raycastBridge.answerCapPromptDeclined";

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
  /**
   * Kept beside the threads rather than on them: `CommentThread` carries no
   * field an extension may attach a callback to, and the title bar command is
   * handed the thread itself, which is enough to look one up.
   */
  private readonly reruns = new Map<vscode.CommentThread, () => void>();
  private state: vscode.Memento | undefined;

  register(context: vscode.ExtensionContext): void {
    this.state = context.globalState;
    context.subscriptions.push(
      // VSCode marshals the thread whose title bar was clicked into the
      // argument. The Escape keybinding passes nothing, so the target is guessed.
      vscode.commands.registerCommand(DISMISS_COMMAND, (thread?: vscode.CommentThread) =>
        this.dismiss(thread ?? this.focusedGuess()),
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
    const replaced = this.threads.get(key);
    if (replaced) {
      replaced.dispose();
      this.reruns.delete(replaced);
    }
    // Re-inserted below so the map's order stays "most recently opened last".
    this.threads.delete(key);

    // The comment's author line is where "who answered this" belongs, and
    // VSCode renders it in bold above the body: the bridge, then the model.
    // A replayed answer says so there too, since arriving instantly is
    // otherwise indistinguishable from arriving very fast.
    const author = [CONTROLLER_NAME, target.model, target.cached ? "cached" : undefined]
      .filter(Boolean)
      .join(" · ");
    const markdown = target.render !== false;
    const thread = this.ensureController().createCommentThread(target.uri, widgetAnchor(target.range), [
      comment(PLACEHOLDER, author, markdown),
    ]);
    // The title bar says which action ran; the author line says which model.
    thread.label = target.title;
    thread.canReply = false;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    // Gates the title bar buttons' `when` clauses. Regenerate is offered only
    // on a replayed answer: on a fresh one it would just repeat the call that
    // has this second finished.
    thread.contextValue = target.regenerate ? RERUNNABLE_CONTEXT : CONTROLLER_ID;
    this.threads.set(key, thread);
    if (target.regenerate) {
      this.reruns.set(thread, target.regenerate);
    }
    void this.focusSoon(key, thread, target);

    // Guarded against this thread having been dismissed or replaced already:
    // an in-flight request must not write into a block that is gone.
    const render = (body: string) => {
      if (this.threads.get(key) === thread) {
        thread.comments = [comment(body, author, markdown)];
      }
    };

    return {
      update: (body) => render(body.trim() || PLACEHOLDER),
      done: async (body) => {
        render(body);
        if (this.threads.get(key) === thread && isLongAnswer(body)) {
          await this.offerToLiftHeightCap();
        }
      },
      dispose: () => this.remove(key, thread),
    };
  }

  /** VSCode marshals in the thread whose title bar was clicked. */
  rerun(arg: unknown): (() => void) | undefined {
    return this.reruns.get(arg as vscode.CommentThread);
  }

  private dismiss(thread?: vscode.CommentThread): void {
    for (const [key, open] of this.threads) {
      if (open === thread) {
        this.remove(key, open);
        this.refocusEditor();
        return;
      }
    }
    // Not one of ours to track, but the user still asked for it to go.
    thread?.dispose();
  }

  /**
   * Moves keyboard focus into the thread once VSCode has rendered it, so
   * Escape dismisses it without a click first. There is no stable API for
   * this; the built-in command that focuses the comment under the cursor is
   * the nearest thing, and the cursor is still on the answer's line because
   * the action was just run on that selection.
   */
  private async focusSoon(key: string, thread: vscode.CommentThread, target: AnswerTarget): Promise<void> {
    if (!vscode.workspace.getConfiguration("raycastBridge").get<boolean>("quickActionsFocus", true)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, FOCUS_DELAY_MS));
    const editor = vscode.window.activeTextEditor;
    const active = editor && { uri: editor.document.uri.toString(), line: editor.selection.end.line };
    if (
      this.threads.get(key) !== thread ||
      !cursorOnAnswerLine(active, { uri: target.uri.toString(), endLine: target.range.end.line })
    ) {
      return;
    }
    await vscode.commands.executeCommand("workbench.action.focusCommentOnCurrentLine");
  }

  /** Disposing a focused thread leaves focus nowhere; hand it back to the editor. */
  private refocusEditor(): void {
    void vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  }

  /**
   * VSCode caps a comment body at 20em and, once the cap is hit, stops
   * refreshing the scrollbar, so the rest of a long answer is unreachable
   * until the widget is resized by hand. The only fix available from an
   * extension is the setting that removes the cap, and it is global to all
   * comment threads, so it is offered once rather than applied.
   */
  private async offerToLiftHeightCap(): Promise<void> {
    const comments = vscode.workspace.getConfiguration("comments");
    if (comments.get<boolean>("maxHeight") === false || this.state?.get(CAP_PROMPT_DECLINED)) {
      return;
    }
    const lift = "Show answers in full";
    const never = "Don't ask again";
    const choice = await vscode.window.showInformationMessage(
      "VS Code cuts a comment thread off at about 20 lines and this answer is longer. Let inline answers expand to their full height? This turns off the 'comments.maxHeight' setting for every comment thread.",
      lift,
      never,
    );
    if (choice === lift) {
      await comments.update("maxHeight", false, vscode.ConfigurationTarget.Global);
    } else if (choice === never) {
      await this.state?.update(CAP_PROMPT_DECLINED, true);
    }
  }

  /**
   * The thread Escape most likely means. VSCode reports that some comment
   * widget has focus, not which, so the cursor position stands in for it.
   */
  private focusedGuess(): vscode.CommentThread | undefined {
    const editor = vscode.window.activeTextEditor;
    const open = [...this.threads].map(([key, thread]) => ({
      key,
      uri: thread.uri.toString(),
      start: thread.range?.start.line ?? 0,
      end: thread.range?.end.line ?? 0,
    }));
    const key = pickDismissTarget(
      open,
      editor && { uri: editor.document.uri.toString(), line: editor.selection.active.line },
    );
    return key === undefined ? undefined : this.threads.get(key);
  }

  private dismissAll(): void {
    for (const thread of this.threads.values()) {
      thread.dispose();
    }
    this.threads.clear();
    this.reruns.clear();
  }

  private remove(key: string, thread: vscode.CommentThread): void {
    if (this.threads.get(key) === thread) {
      this.threads.delete(key);
    }
    this.reruns.delete(thread);
    thread.dispose();
  }

  /** Created on first use, so choosing the hover never adds a Comments panel entry. */
  private ensureController(): vscode.CommentController {
    this.controller ??= vscode.comments.createCommentController(CONTROLLER_ID, CONTROLLER_NAME);
    return this.controller;
  }
}

/**
 * Where the widget hangs: the end of the selection, as an empty range.
 *
 * VSCode turns a thread's range into the view zone's `afterColumn` -- the
 * midpoint of a single-line range, column 1 of a multi-line one -- and a zone
 * is inserted after the *visual* row that column falls on. With word wrap on
 * (Option+Z), a whole-line range puts that column halfway along the text, so
 * the answer lands between the wrapped halves of the line it is answering
 * about. Collapsing the range to its end pins the column past the last
 * character, which clamps to the final visual row.
 *
 * The price is the faint highlight VSCode paints over a commented range:
 * `CommentThreadRangeDecorator` skips empty ranges. The line numbers are
 * unchanged, so dismissal and focus, which read only those, still work.
 */
function widgetAnchor(range: vscode.Range): vscode.Range {
  return new vscode.Range(range.end, range.end);
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

/**
 * Left untrusted deliberately: the body is model output, so no command links.
 * A plain string body is shown verbatim by VSCode, wrapped and with its
 * newlines intact, so it needs none of the Markdown line-break repair.
 */
function comment(body: string, author: string, markdown: boolean): vscode.Comment {
  return {
    body: markdown ? new vscode.MarkdownString(preserveLineBreaks(body)) : body,
    mode: vscode.CommentMode.Preview,
    // Required by the API, and rendered whatever it holds, so it carries the
    // model rather than a constant that says nothing.
    author: { name: author },
  };
}
