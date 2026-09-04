import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { buildDeeplink, openDeeplink } from "../bridge/deeplink";
import type { BridgeContext, Job } from "../bridge/protocol";
import type { BridgeServer } from "../bridge/server";

const EXTENSION_NAME = "vscode-bridge";
const COMMAND_NAME = "ask-ai";

type Preset = { label: string; detail: string; build: (code: string, language: string) => string };

const PRESETS: Preset[] = [
  {
    label: "Explain",
    detail: "Explain what the selected code does",
    build: (code, language) => `Explain what this ${language} code does.\n\n\`\`\`${language}\n${code}\n\`\`\``,
  },
  {
    label: "Refactor",
    detail: "Suggest a cleaner version",
    build: (code, language) =>
      `Refactor this ${language} code for clarity. Return the rewritten code plus a short rationale.\n\n\`\`\`${language}\n${code}\n\`\`\``,
  },
  {
    label: "Write tests",
    detail: "Generate tests for the selection",
    build: (code, language) => `Write tests for this ${language} code.\n\n\`\`\`${language}\n${code}\n\`\`\``,
  },
  {
    label: "Find bugs",
    detail: "Review the selection for defects",
    build: (code, language) =>
      `Review this ${language} code for bugs. For each issue give the failure scenario.\n\n\`\`\`${language}\n${code}\n\`\`\``,
  },
  { label: "Custom...", detail: "Type your own instruction", build: (code) => code },
];

export async function askAI(server: BridgeServer): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Raycast Bridge: open a file first.");
    return;
  }

  const selection = editor.selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(editor.selection);
  if (!selection.trim()) {
    void vscode.window.showWarningMessage("Raycast Bridge: nothing to send.");
    return;
  }

  const language = editor.document.languageId;
  const picked = await vscode.window.showQuickPick(
    PRESETS.map((preset) => ({ label: preset.label, detail: preset.detail, preset })),
    { placeHolder: "What should Raycast AI do with this code?" },
  );
  if (!picked) {
    return;
  }

  let prompt: string;
  if (picked.preset.label === "Custom...") {
    const instruction = await vscode.window.showInputBox({
      prompt: "Instruction for Raycast AI",
      placeHolder: "e.g. Convert this to async/await",
    });
    if (!instruction) {
      return;
    }
    prompt = `${instruction}\n\n\`\`\`${language}\n${selection}\n\`\`\``;
  } else {
    prompt = picked.preset.build(selection, language);
  }

  const config = vscode.workspace.getConfiguration("raycastBridge");
  const owner = config.get<string>("owner")?.trim();
  if (!owner) {
    void vscode.window.showErrorMessage(
      "Raycast Bridge: set raycastBridge.owner to your Raycast Store handle.",
    );
    return;
  }

  const model = config.get<string>("model")?.trim();
  const job: Job = {
    id: randomUUID(),
    kind: "ai.ask",
    prompt,
    creativity: config.get<string>("creativity") ?? "none",
    ...(model ? { model } : {}),
  };

  const document = await vscode.workspace.openTextDocument({
    content: `# ${picked.preset.label}\n\n`,
    language: "markdown",
  });
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });

  const writer = createAppender(document);
  const finished = new Promise<void>((resolve) => {
    server.register(job, {
      onChunk: (text) => writer.push(text),
      onDone: async (result) => {
        await writer.drain();
        if (!result.ok) {
          void vscode.window.showErrorMessage(`Raycast AI: ${result.error}`);
        }
        resolve();
      },
    });
  });

  const port = await server.listen();
  const context: BridgeContext = { jobId: job.id, port, token: server.token };
  await openDeeplink(
    buildDeeplink({ owner, extension: EXTENSION_NAME, command: COMMAND_NAME, launchType: "background", context }),
  );

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Raycast AI: ${picked.preset.label}` },
    () => finished,
  );
}

/**
 * Serialises appends to the result document. Chunks arrive faster than
 * WorkspaceEdit can apply them, so they are queued rather than raced.
 */
function createAppender(document: vscode.TextDocument) {
  let queue = "";
  let pump: Promise<void> = Promise.resolve();

  const write = async () => {
    if (!queue) return;
    const text = queue;
    queue = "";
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, document.lineAt(document.lineCount - 1).range.end, text);
    await vscode.workspace.applyEdit(edit);
  };

  return {
    push(text: string) {
      queue += text;
      pump = pump.then(write).catch(() => undefined);
    },
    async drain() {
      await pump;
      await write();
    },
  };
}
