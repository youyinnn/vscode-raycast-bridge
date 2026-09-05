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

/**
 * `render: false` shows the answer verbatim instead of as Markdown. Present
 * only when set, so the default needs no field.
 */
export type QuickAction = { label: string; prompt: string; model?: string; render?: false };

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
    const { label, prompt, model, render } = entry as Record<string, unknown>;
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
      ...(render === false ? { render: false } : {}),
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

/**
 * Resolves the action a keybinding names.
 *
 * Keybindings carry a label rather than a position, so reordering the setting
 * does not silently repoint a key at a different action. Matching is
 * case-insensitive because the label is retyped by hand into keybindings.json,
 * where a mismatch would fail silently at press time.
 */
export function findQuickAction(actions: QuickAction[], label: unknown): QuickAction | undefined {
  const wanted = text(label).toLowerCase();
  if (!wanted) {
    return undefined;
  }
  return actions.find((action) => action.label.toLowerCase() === wanted);
}

/**
 * Shown when an action pins no model, and Raycast picks for itself. Worded
 * without "Raycast", since it is rendered next to the bridge's own name.
 */
export const DEFAULT_MODEL_LABEL = "default model";

/**
 * Names the model an action will use, for display beside its answer.
 *
 * `lookup` resolves a model id to Raycast's display name. It returns
 * `undefined` for ids the catalog does not describe -- the SDK enumerates
 * models Raycast never publishes metadata for, and those still answer -- so
 * the id itself is shown rather than hiding the fact that one is pinned.
 */
export function quickActionModelLabel(
  action: QuickAction,
  lookup: (id: string) => string | undefined,
): string {
  if (!action.model) {
    return DEFAULT_MODEL_LABEL;
  }
  return lookup(action.model) ?? action.model;
}

/**
 * Pins or clears the model on one entry of the raw `quickActions` setting.
 *
 * Works on the raw value rather than parsed actions: parsing drops malformed
 * entries, which would shift every later index, and it discards fields we do
 * not read, which writing back would silently delete from a hand-edited file.
 */
export function setQuickActionModel(raw: unknown, index: number, model: string | undefined): unknown[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry, at) => {
    if (at !== index || typeof entry !== "object" || entry === null) {
      return entry;
    }
    const { model: _dropped, ...rest } = entry as Record<string, unknown>;
    return model ? { ...rest, model } : rest;
  });
}
