import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type DeeplinkOptions = {
  owner: string;
  extension: string;
  command: string;
  launchType?: "userInitiated" | "background";
  context?: unknown;
  args?: Record<string, string>;
  fallbackText?: string;
};

/**
 * Builds a raycast:// deeplink as a raw string.
 *
 * Deliberately not built through vscode.Uri: Uri.parse re-encodes the query,
 * which corrupts the already URL-encoded `context` payload.
 */
export function buildDeeplink(options: DeeplinkOptions): string {
  const base = `raycast://extensions/${options.owner}/${options.extension}/${options.command}`;
  const params = new URLSearchParams();
  if (options.launchType) {
    params.set("launchType", options.launchType);
  }
  if (options.context !== undefined) {
    params.set("context", JSON.stringify(options.context));
  }
  if (options.args) {
    params.set("arguments", JSON.stringify(options.args));
  }
  if (options.fallbackText !== undefined) {
    params.set("fallbackText", options.fallbackText);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * Hands the URL to macOS `open` rather than vscode.env.openExternal, whose
 * documented scheme support covers only http/https/mailto/vscode.
 * `-g` keeps VSCode focused, matching launchType=background.
 */
export async function openDeeplink(url: string): Promise<void> {
  await run("open", ["-g", url]);
}

export type SelectionTarget = {
  deeplink: string;
  /** "fallbackText" | "argument:<name>" | "context:<key>" */
  passSelectionAs?: string;
};

/** Injects an editor selection into an existing deeplink per passSelectionAs. */
export function withSelection(target: SelectionTarget, selection: string): string {
  if (!target.passSelectionAs || !selection) {
    return target.deeplink;
  }

  const url = new URL(target.deeplink.replace(/^raycast:\/\//, "https://raycast.invalid/"));
  const [kind, key] = target.passSelectionAs.split(":", 2);

  if (kind === "fallbackText") {
    url.searchParams.set("fallbackText", selection);
  } else if (kind === "argument" && key) {
    url.searchParams.set("arguments", JSON.stringify({ ...parseJsonParam(url.searchParams.get("arguments")), [key]: selection }));
  } else if (kind === "context" && key) {
    url.searchParams.set("context", JSON.stringify({ ...parseJsonParam(url.searchParams.get("context")), [key]: selection }));
  } else {
    return target.deeplink;
  }

  return url.toString().replace(/^https:\/\/raycast\.invalid\//, "raycast://");
}

function parseJsonParam(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
