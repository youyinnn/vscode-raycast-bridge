import { describe, expect, it } from "vitest";
import { commandUri, markdownLink, preserveLineBreaks } from "./markdown";

describe("preserveLineBreaks", () => {
  it("leaves text without newlines alone", () => {
    expect(preserveLineBreaks("one line")).toBe("one line");
  });

  it("turns a newline inside a paragraph into a Markdown hard break", () => {
    expect(preserveLineBreaks("\\section{Intro}\nThis is a file.")).toBe(
      "\\section{Intro}  \nThis is a file.",
    );
  });

  it("leaves a blank line alone, since that is already a paragraph break", () => {
    expect(preserveLineBreaks("first\n\nsecond")).toBe("first\n\nsecond");
  });

  it("leaves runs of blank lines alone", () => {
    expect(preserveLineBreaks("first\n\n\nsecond")).toBe("first\n\n\nsecond");
  });

  it("keeps every line of a block together", () => {
    expect(preserveLineBreaks("a\nb\nc")).toBe("a  \nb  \nc");
  });

  it("normalizes trailing whitespace rather than stacking more onto it", () => {
    expect(preserveLineBreaks("a \nb")).toBe("a  \nb");
    expect(preserveLineBreaks("a\t\nb")).toBe("a  \nb");
    expect(preserveLineBreaks("a   \nb")).toBe("a  \nb");
  });

  it("preserves leading indentation on the following line", () => {
    expect(preserveLineBreaks("\\begin{equation}\n    \\int e^{-x^2}\n\\end{equation}")).toBe(
      "\\begin{equation}  \n    \\int e^{-x^2}  \n\\end{equation}",
    );
  });

  it("handles CRLF", () => {
    expect(preserveLineBreaks("a\r\nb")).toBe("a  \nb");
  });

  it("leaves a trailing newline alone, since no line follows it", () => {
    expect(preserveLineBreaks("a\n")).toBe("a\n");
  });
});

describe("commandUri", () => {
  it("encodes the argument list so VSCode hands it back unchanged", () => {
    const args = { index: 2, uri: "file:///a b.md", range: [3, 0, 8, 4] };
    const uri = commandUri("raycastBridge.quickAction", args);

    const [scheme, query] = uri.split("?");
    expect(scheme).toBe("command:raycastBridge.quickAction");
    expect(JSON.parse(decodeURIComponent(query))).toEqual([args]);
  });

  it("percent-encodes the characters that would end the link early", () => {
    const uri = commandUri("cmd", { label: 'a "b" (c) d' });

    expect(uri).not.toContain('"');
    expect(uri).not.toContain("(");
    expect(uri).not.toContain(")");
    expect(uri).not.toContain(" ");
  });
})

describe("markdownLink", () => {
  it("writes a link", () => {
    expect(markdownLink("Explain", "command:x")).toBe("[Explain](command:x)");
  });

  it("escapes brackets in the text, which would otherwise end the link early", () => {
    expect(markdownLink("Translate [zh]", "command:x")).toBe("[Translate \\[zh\\]](command:x)");
  });
})
