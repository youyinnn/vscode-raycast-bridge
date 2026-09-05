import * as vscode from "vscode";
import { composePrompt, type Reference } from "../bridge/composePrompt";

/**
 * Entry point from the command palette. Answers render in the native Chat view
 * against the Raycast model (see modelProvider.ts), so this only composes a
 * query -- including the selection, which chat would not otherwise carry --
 * and hands it over.
 */

/** Raycast AI charges per request, so an oversized selection is trimmed. */
const MAX_SELECTION_CHARS = 20_000;

type Preset = { label: string; detail: string; instruction?: string };

const PRESETS: Preset[] = [
  {
    label: "Explain",
    detail: "Explain what the selected code does",
    instruction: "Explain what this code does.",
  },
  {
    label: "Refactor",
    detail: "Suggest a cleaner version",
    instruction: "Refactor this code for clarity. Return the rewritten code plus a short rationale.",
  },
  {
    label: "Write tests",
    detail: "Generate tests for the selection",
    instruction: "Write tests for this code.",
  },
  {
    label: "Find bugs",
    detail: "Review the selection for defects",
    instruction: "Review this code for bugs. For each issue give the failure scenario.",
  },
  { label: "Custom...", detail: "Type your own instruction" },
];

export async function askAI(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    PRESETS.map((preset) => ({ label: preset.label, detail: preset.detail, preset })),
    { placeHolder: "What should Raycast AI do with this code?" },
  );
  if (!picked) {
    return;
  }

  let instruction = picked.preset.instruction;
  if (!instruction) {
    instruction = await vscode.window.showInputBox({
      prompt: "Instruction for Raycast AI",
      placeHolder: "e.g. Convert this to async/await",
    });
    if (!instruction) {
      return;
    }
  }

  const selected = selectionReference();
  const query = composePrompt({ question: instruction, references: selected ? [selected] : [] });

  try {
    // modelSelector switches the chat to Raycast, so this command cannot
    // silently send the query to whichever model happened to be selected.
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query,
      modelSelector: { vendor: "raycast" },
    });
  } catch {
    void vscode.window.showInformationMessage(
      "Raycast Bridge: could not open the Chat view. Ask there directly with a Raycast AI model selected.",
    );
  }
}

function selectionReference(): Reference | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const range = editor.selection.isEmpty ? undefined : editor.selection;
  const content = editor.document.getText(range).slice(0, MAX_SELECTION_CHARS);
  if (!content.trim()) {
    return undefined;
  }
  const name = vscode.workspace.asRelativePath(editor.document.uri);
  return {
    label: range ? `${name}:${range.start.line + 1}-${range.end.line + 1}` : name,
    language: editor.document.languageId,
    content,
  };
}
