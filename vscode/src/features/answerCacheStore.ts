import * as vscode from "vscode";
import {
  answerCacheKey,
  parseCache,
  readCachedAnswer,
  touchCachedAnswer,
  writeCachedAnswer,
  type AnswerCache,
} from "../bridge/answerCache";
import { raycastAppVersion } from "../bridge/raycastApp";

/**
 * Holds the raw stored value, not a parsed cache: the same reason
 * `CatalogStore` does. A change to what counts as a valid entry then takes
 * effect on the next read rather than whenever the store happens to be reset.
 */
const CACHE_KEY = "raycastBridge.answerCache";

/**
 * Remembers quick action answers between runs, so the same text run through
 * the same action does not spend Raycast AI quota twice.
 *
 * Global state rather than workspace state: the same paragraph gets pasted
 * between projects, and the answer does not depend on the workspace.
 */
export class AnswerCacheStore {
  constructor(private readonly memento: vscode.Memento) {}

  /** Identifies a request. `undefined` when caching is off for this action. */
  key(prompt: string, model: string | undefined): string | undefined {
    if (!vscode.workspace.getConfiguration("raycastBridge").get<boolean>("quickActionCache", true)) {
      return undefined;
    }
    // Read at call time rather than at construction: Raycast can be upgraded
    // while VSCode stays open, and that retires the default model's answers.
    return answerCacheKey({ prompt, model, appVersion: raycastAppVersion() });
  }

  /** The stored answer, if any. A hit is recorded so daily use resists eviction. */
  async take(key: string): Promise<string | undefined> {
    const cache = this.read();
    const body = readCachedAnswer(cache, key);
    if (body !== undefined) {
      await this.memento.update(CACHE_KEY, touchCachedAnswer(cache, key, Date.now()));
    }
    return body;
  }

  async put(key: string, body: string): Promise<void> {
    await this.memento.update(CACHE_KEY, writeCachedAnswer(this.read(), key, body, Date.now()));
  }

  /** Returns how many answers were dropped, so the command can say so. */
  async clear(): Promise<number> {
    const dropped = Object.keys(this.read()).length;
    await this.memento.update(CACHE_KEY, undefined);
    return dropped;
  }

  private read(): AnswerCache {
    return parseCache(this.memento.get<unknown>(CACHE_KEY));
  }
}
