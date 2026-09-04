import { describe, expect, it } from "vitest";
import { withSelection } from "./deeplink";

const base = "raycast://extensions/me/ext/cmd";
const params = (url: string) => new URL(url.replace("raycast://", "https://")).searchParams;

describe("withSelection", () => {
  it("leaves the deeplink alone when no injection is requested", () => {
    expect(withSelection({ deeplink: base }, "code")).toBe(base);
  });

  it("leaves the deeplink alone when the selection is empty", () => {
    expect(withSelection({ deeplink: base, passSelectionAs: "fallbackText" }, "")).toBe(base);
  });

  it("injects the selection as fallbackText", () => {
    const url = withSelection({ deeplink: base, passSelectionAs: "fallbackText" }, "a&b=c");
    expect(params(url).get("fallbackText")).toBe("a&b=c");
    expect(url.startsWith("raycast://extensions/me/ext/cmd")).toBe(true);
  });

  it("merges into existing arguments rather than clobbering them", () => {
    const deeplink = `${base}?arguments=${encodeURIComponent(JSON.stringify({ keep: "1" }))}`;
    const url = withSelection({ deeplink, passSelectionAs: "argument:code" }, "sel");
    expect(JSON.parse(params(url).get("arguments")!)).toEqual({ keep: "1", code: "sel" });
  });

  it("merges into existing context", () => {
    const deeplink = `${base}?context=${encodeURIComponent(JSON.stringify({ keep: true }))}`;
    const url = withSelection({ deeplink, passSelectionAs: "context:body" }, "sel");
    expect(JSON.parse(params(url).get("context")!)).toEqual({ keep: true, body: "sel" });
  });

  it("ignores an unrecognised passSelectionAs spec", () => {
    expect(withSelection({ deeplink: base, passSelectionAs: "bogus" }, "sel")).toBe(base);
  });
});
