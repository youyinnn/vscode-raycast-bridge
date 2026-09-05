/**
 * Turns the `raycastBridge.quickActions` setting into prompts.
 *
 * A quick action is one entry in that setting: a label for the menu and a
 * prompt template whose `{{selection}}` placeholder is replaced by whatever
 * the user has selected in the editor.
 *
 * Deliberately free of any `vscode` import so it stays unit-testable; the
 * features layer reads the setting and supplies the selected text.
 */

export type QuickAction = { label: string; prompt: string; model?: string };

/** Raycast AI charges per request, so an oversized selection is trimmed. */
export const MAX_SELECTION_CHARS = 20_000;

const PLACEHOLDER = /\{\{\s*selection\s*\}\}/;

/**
 * Filters a raw settings value down to usable actions.
 *
 * Settings are user-editable JSON, so anything malformed reaches us as-is.
 * Bad entries are dropped rather than surfaced: a menu item with no label is
 * an invisible click target, and one with no prompt asks Raycast nothing.
 */
export function parseQuickActions(raw: unknown): QuickAction[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const actions: QuickAction[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { label, prompt, model } = entry as Record<string, unknown>;
    const trimmedLabel = text(label);
    const trimmedPrompt = text(prompt);
    if (!trimmedLabel || !trimmedPrompt) {
      continue;
    }
    const trimmedModel = text(model);
    actions.push({
      label: trimmedLabel,
      prompt: trimmedPrompt,
      ...(trimmedModel ? { model: trimmedModel } : {}),
    });
  }
  return actions;
}

/** Builds the prompt for one action against the selected text. */
export function buildQuickPrompt(action: QuickAction, selection: string): string {
  const selected = selection.slice(0, MAX_SELECTION_CHARS);
  // Replacing via a function, not a string: a selection containing `$&` or
  // `$1` would otherwise be read as replacement syntax and mangled.
  const body = PLACEHOLDER.test(action.prompt)
    ? action.prompt.replace(new RegExp(PLACEHOLDER, "g"), () => selected)
    : `${action.prompt}\n\n${selected}`;
  return body.trim();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
