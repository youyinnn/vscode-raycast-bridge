import { describe, expect, it } from "vitest";
import {
  MAX_CACHED_ANSWER_CHARS,
  MAX_CACHED_ANSWERS,
  answerCacheKey,
  cacheableSelection,
  parseCache,
  readCachedAnswer,
  touchCachedAnswer,
  writeCachedAnswer,
  type AnswerCache,
} from "./answerCache";
import { buildQuickPrompt } from "./quickActions";

const at = 1_000;

describe("answerCacheKey", () => {
  it("is stable for the same prompt and model", () => {
    const first = answerCacheKey({ prompt: "Translate this", model: "openai-gpt-4" });
    const second = answerCacheKey({ prompt: "Translate this", model: "openai-gpt-4" });
    expect(first).toBe(second);
  });

  it("changes with the prompt", () => {
    expect(answerCacheKey({ prompt: "a", model: "m" })).not.toBe(answerCacheKey({ prompt: "b", model: "m" }));
  });

  it("changes with the model", () => {
    expect(answerCacheKey({ prompt: "a", model: "m" })).not.toBe(answerCacheKey({ prompt: "a", model: "n" }));
  });

  it("separates the prompt from the model, so a shared boundary cannot collide", () => {
    expect(answerCacheKey({ prompt: "a", model: "bc" })).not.toBe(answerCacheKey({ prompt: "ab", model: "c" }));
  });

  it("changes with the Raycast app version when no model is pinned", () => {
    expect(answerCacheKey({ prompt: "a", appVersion: "1.104.28" })).not.toBe(
      answerCacheKey({ prompt: "a", appVersion: "2.2.0" }),
    );
  });

  it("ignores the Raycast app version when a model is pinned", () => {
    expect(answerCacheKey({ prompt: "a", model: "m", appVersion: "1.104.28" })).toBe(
      answerCacheKey({ prompt: "a", model: "m", appVersion: "2.2.0" }),
    );
  });

  it("does not confuse an unpinned model with one literally named after the default", () => {
    expect(answerCacheKey({ prompt: "a", appVersion: "2.2.0" })).not.toBe(
      answerCacheKey({ prompt: "a", model: "default@2.2.0" }),
    );
  });
});

describe("parseCache", () => {
  it("treats anything malformed as empty", () => {
    expect(parseCache(undefined)).toEqual({});
    expect(parseCache("nope")).toEqual({});
    expect(parseCache([1, 2])).toEqual({});
  });

  it("drops entries that are not a body and a timestamp", () => {
    expect(parseCache({ a: { body: "hi", at }, b: { body: 1, at }, c: "hi", d: { body: "hi" } })).toEqual({
      a: { body: "hi", at },
    });
  });
});

describe("readCachedAnswer", () => {
  it("returns nothing for a key that was never written", () => {
    expect(readCachedAnswer({}, "k")).toBeUndefined();
  });

  it("returns the stored body", () => {
    expect(readCachedAnswer({ k: { body: "hello", at } }, "k")).toBe("hello");
  });
});

describe("writeCachedAnswer", () => {
  it("stores the body under the key", () => {
    expect(writeCachedAnswer({}, "k", "hello", at)).toEqual({ k: { body: "hello", at } });
  });

  it("replaces an earlier answer for the same key", () => {
    const cache = writeCachedAnswer({ k: { body: "old", at } }, "k", "new", at + 1);
    expect(cache).toEqual({ k: { body: "new", at: at + 1 } });
  });

  it("refuses an answer too large to sit in a settings-sized store", () => {
    const huge = "x".repeat(MAX_CACHED_ANSWER_CHARS + 1);
    expect(writeCachedAnswer({}, "k", huge, at)).toEqual({});
  });

  it("evicts the least recently used entry once the cap is reached", () => {
    let cache: AnswerCache = {};
    for (let i = 0; i < MAX_CACHED_ANSWERS; i++) {
      cache = writeCachedAnswer(cache, `k${i}`, `body ${i}`, at + i);
    }
    cache = writeCachedAnswer(cache, "fresh", "new body", at + MAX_CACHED_ANSWERS);
    expect(Object.keys(cache)).toHaveLength(MAX_CACHED_ANSWERS);
    expect(cache.k0).toBeUndefined();
    expect(cache.fresh?.body).toBe("new body");
  });
});

describe("touchCachedAnswer", () => {
  it("moves a hit to the front of the eviction queue", () => {
    let cache: AnswerCache = {};
    for (let i = 0; i < MAX_CACHED_ANSWERS; i++) {
      cache = writeCachedAnswer(cache, `k${i}`, `body ${i}`, at + i);
    }
    cache = touchCachedAnswer(cache, "k0", at + MAX_CACHED_ANSWERS);
    cache = writeCachedAnswer(cache, "fresh", "new body", at + MAX_CACHED_ANSWERS + 1);
    expect(cache.k0?.body).toBe("body 0");
    expect(cache.k1).toBeUndefined();
  });

  it("leaves the cache alone when the key is absent", () => {
    const cache = { k: { body: "hi", at } };
    expect(touchCachedAnswer(cache, "missing", at + 1)).toEqual(cache);
  });
});

describe("cacheableSelection", () => {
  it("ignores whitespace at the end, which a drag easily overshoots into", () => {
    expect(cacheableSelection("hello  \n\n")).toBe("hello");
  });

  it("keeps leading indentation, which decides how a code or LaTeX answer is indented", () => {
    expect(cacheableSelection("    return x")).toBe("    return x");
  });

  it("keeps the interior alone", () => {
    expect(cacheableSelection("a\n\n  b  \nc  ")).toBe("a\n\n  b  \nc");
  });
});

describe("the key a quick action actually computes", () => {
  // The pair that broke: with the placeholder in the middle, the selection's
  // trailing whitespace lands inside the prompt, where buildQuickPrompt's own
  // trim cannot reach it.
  const keyFor = (template: string, selection: string) =>
    answerCacheKey({
      prompt: buildQuickPrompt({ label: "x", prompt: template }, cacheableSelection(selection)),
      model: "m",
    });

  it("hits whether or not the selection overshot into trailing whitespace", () => {
    expect(keyFor("Explain {{selection}} briefly", "hello  \n")).toBe(
      keyFor("Explain {{selection}} briefly", "hello"),
    );
    expect(keyFor("Explain this.", "hello  \n")).toBe(keyFor("Explain this.", "hello"));
  });

  it("misses when the selection is indented differently", () => {
    expect(keyFor("Explain this.", "  hello")).not.toBe(keyFor("Explain this.", "hello"));
  });
});
