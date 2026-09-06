import * as vscode from "vscode";
import { preserveLineBreaks } from "../bridge/markdown";
import type { AnswerSession, AnswerSink, AnswerTarget } from "./answerSink";

const COPY_COMMAND = "raycastBridge.copyAnswer";
const REGENERATE_COMMAND = "raycastBridge.regenerateAnswer";

/**
 * Shows an answer in a hover next to the text it is about.
 *
 * VSCode has no API for putting a panel at a position, so this works the
 * other way round: the answer is parked where a `HoverProvider` can find it,
 * and the built-in `editor.action.showHover` command forces the hover open.
 * That command acts on the editor's cursor, which is why the caller must not
 * steal focus first -- a notification-style progress indicator would.
 *
 * A hover is dismissed by scrolling or clicking elsewhere and VSCode exposes
 * no way to change that, so the answer stays cached until the document is
 * edited: hovering the same text again brings it back without a second call
 * to Raycast. `AnswerThread` is the alternative for anyone who wants the
 * answer to stay put.
 */
export class AnswerHover implements vscode.HoverProvider, AnswerSink {
  private answer: { target: AnswerTarget; body: string } | undefined;

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider("*", this),
      vscode.commands.registerCommand(COPY_COMMAND, () => this.copy()),
      // An edit shifts the text the answer was about, so the range stops
      // pointing at what was asked and the answer is dropped.
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!event.contentChanges.length) {
          return;
        }
        if (this.answer && event.document.uri.toString() === this.answer.target.uri.toString()) {
          this.answer = undefined;
        }
      }),
    );
  }

  open(target: AnswerTarget): AnswerSession {
    this.answer = undefined;
    return {
      // A hover's content is fixed once it opens, so there is nothing to stream into.
      update: () => undefined,
      done: async (body) => {
        this.answer = { target, body };
        await vscode.commands.executeCommand("editor.action.showHover");
      },
      dispose: () => undefined,
    };
  }

  /**
   * A hover link carries no argument, so anything that does came from the
   * other sink's title bar and is not this one's to answer.
   */
  rerun(arg: unknown): (() => void) | undefined {
    return arg === undefined ? this.answer?.target.regenerate : undefined;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const answer = this.answer;
    if (!answer || document.uri.toString() !== answer.target.uri.toString()) {
      return undefined;
    }
    if (!answer.target.range.contains(position)) {
      return undefined;
    }
    const content = new vscode.MarkdownString();
    // Scoped trust rather than `isTrusted = true`: the body is model output,
    // and blanket trust would let a returned `[x](command:...)` link run any
    // command in VSCode the moment it is clicked.
    content.isTrusted = { enabledCommands: [COPY_COMMAND, REGENERATE_COMMAND] };
    // The model is outside the bold run: the action's name is what the reader
    // is looking for, and the model is the footnote that says who answered.
    // "cached" is said out loud: an answer that arrives instantly is otherwise
    // indistinguishable from a very fast one, and Regenerate reads differently
    // once the reader knows this one was not just generated.
    const heading = [
      `**${answer.target.title}**`,
      answer.target.model,
      answer.target.cached ? "cached" : undefined,
      `[Copy](command:${COPY_COMMAND})`,
      answer.target.regenerate ? `[Regenerate](command:${REGENERATE_COMMAND})` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    content.appendMarkdown(`${heading}\n\n`);
    if (answer.target.render === false) {
      // Escaped rather than rendered: a hover has no plain-text mode.
      content.appendText(answer.body);
    } else {
      content.appendMarkdown(preserveLineBreaks(answer.body));
    }
    return new vscode.Hover(content, answer.target.range);
  }

  private async copy(): Promise<void> {
    if (this.answer) {
      await vscode.env.clipboard.writeText(this.answer.body);
    }
  }
}
