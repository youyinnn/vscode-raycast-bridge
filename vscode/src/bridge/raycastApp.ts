import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Raycast app's version, which is what decides the model ids `AI.ask`
 * accepts.
 *
 * The SDK version is not: on Raycast 1.104.28 with @raycast/api 2.2.0 every id
 * the SDK had newly added was rejected, and upgrading the app to 2.2 is what
 * unlocked them. Probe verdicts are keyed on this so an app upgrade discards
 * them instead of leaving models hidden that now work.
 */

const CANDIDATES = [
  "/Applications/Raycast.app/Contents/Info.plist",
  join(homedir(), "Applications", "Raycast.app", "Contents", "Info.plist"),
];

/** Info.plist is XML in every Raycast build seen so far; a binary plist yields undefined. */
export function parseAppVersion(plist: string): string | undefined {
  const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  return match?.[1]?.trim() || undefined;
}

export function raycastAppVersion(paths: readonly string[] = CANDIDATES): string | undefined {
  for (const path of paths) {
    try {
      const version = parseAppVersion(readFileSync(path, "utf8"));
      if (version) {
        return version;
      }
    } catch {
      // Raycast may be installed elsewhere, or not installed at all.
    }
  }
  return undefined;
}
