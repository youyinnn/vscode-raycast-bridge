/**
 * Detects Raycast serving a different model than the one that was asked for.
 *
 * Raycast documents that "if a model isn't available to the user (or has been
 * disabled by the user), Raycast will fallback to a similar one", and it does
 * so silently: the request succeeds and streams a normal answer. Asking for
 * `baseten-deepseek-ai/DeepSeek-V4-Pro` produced a reply identifying itself as
 * `gpt-5.6-luna`, Raycast's default for the extension API.
 *
 * This is a heuristic on the model's own self-report. It reliably catches the
 * fallback-to-default case; it cannot prove a model is genuinely running, since
 * models misname themselves and some decline to answer at all.
 */

/**
 * Identifies how a verdict was reached. Bump it whenever the probe's prompt or
 * its judgement changes, so verdicts from the old method are discarded instead
 * of surviving as stale conclusions.
 *
 * 1: "reply ok" -- proved only that a call succeeded, which substitution does too.
 * 2: self-identification, compared against the default model.
 */
export const PROBE_METHOD = 2;

/** Drops the vendor prefix and any punctuation: `openai-gpt-5.6-luna` -> `gpt56luna`. */
function core(id: string): string {
  const withoutVendor = id.includes("-") ? id.slice(id.indexOf("-") + 1) : id;
  return withoutVendor.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mentions(reply: string, id: string): boolean {
  const needle = core(id);
  return needle.length > 3 && reply.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle);
}

export function looksLikeFallback(
  reply: string,
  requestedId: string,
  defaultId: string | undefined,
): boolean {
  if (!defaultId || requestedId === defaultId) {
    return false;
  }
  // Naming the requested model too means the reply is not evidence either way.
  return mentions(reply, defaultId) && !mentions(reply, requestedId);
}
