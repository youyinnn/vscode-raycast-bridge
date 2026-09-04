import { describe, expect, it } from "vitest";
import { buildDeeplink } from "./deeplink";

describe("buildDeeplink", () => {
  it("builds a bare command deeplink", () => {
    expect(buildDeeplink({ owner: "me", extension: "ext", command: "cmd" })).toBe(
      "raycast://extensions/me/ext/cmd",
    );
  });

  it("url-encodes the context payload so JSON survives the round trip", () => {
    const url = buildDeeplink({
      owner: "me",
      extension: "ext",
      command: "cmd",
      launchType: "background",
      context: { jobId: "a/b c", port: 1234, token: "t&t" },
    });
    const context = new URL(url.replace("raycast://", "https://")).searchParams.get("context");
    expect(JSON.parse(context!)).toEqual({ jobId: "a/b c", port: 1234, token: "t&t" });
    expect(url).toContain("launchType=background");
  });
});
