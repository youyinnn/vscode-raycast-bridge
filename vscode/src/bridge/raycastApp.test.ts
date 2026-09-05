import { describe, expect, it } from "vitest";
import { parseAppVersion } from "./raycastApp";

const plist = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<plist version="1.0">',
  "<dict>",
  "  <key>CFBundleName</key>",
  "  <string>Raycast</string>",
  "  <key>CFBundleShortVersionString</key>",
  "  <string>2.2.0.0</string>",
  "  <key>CFBundleVersion</key>",
  "  <string>0</string>",
  "</dict>",
  "</plist>",
].join("\n");

describe("parseAppVersion", () => {
  it("reads the marketing version from an XML plist", () => {
    expect(parseAppVersion(plist)).toBe("2.2.0.0");
  });

  it("does not pick up a neighbouring key's value", () => {
    expect(parseAppVersion(plist)).not.toBe("0");
  });

  it("returns undefined when the key is absent", () => {
    expect(parseAppVersion("<plist><dict></dict></plist>")).toBeUndefined();
  });

  it("returns undefined for a binary or unreadable plist", () => {
    expect(parseAppVersion("bplist00 garbage")).toBeUndefined();
  });
});
