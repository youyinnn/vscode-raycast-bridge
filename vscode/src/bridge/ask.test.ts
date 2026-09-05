import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askRaycast } from "./ask";
import { BridgeServer } from "./server";
import { TOKEN_HEADER, type BridgeContext } from "./protocol";

describe("askRaycast", () => {
  let server: BridgeServer;
  let opened: string[];

  beforeEach(() => {
    server = new BridgeServer();
    opened = [];
  });

  afterEach(() => server.dispose());

  const open = async (url: string) => void opened.push(url);

  const contextOf = (url: string): BridgeContext =>
    JSON.parse(decodeURIComponent(new URL(url).searchParams.get("context") ?? ""));

  const post = (context: BridgeContext, action: string, body: unknown) =>
    fetch(`http://127.0.0.1:${context.port}/job/${context.jobId}/${action}`, {
      method: "POST",
      headers: { [TOKEN_HEADER]: server.token, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("streams chunks and resolves with the done payload", async () => {
    const chunks: string[] = [];
    const pending = askRaycast(server, { owner: "Youyinnn", prompt: "hi" }, (t) => chunks.push(t), { open });

    await waitFor(() => opened.length === 1);
    const context = contextOf(opened[0]);
    await post(context, "chunk", { text: "Hel" });
    await post(context, "chunk", { text: "lo" });
    await post(context, "done", { ok: true });

    expect(await pending).toEqual({ ok: true });
    expect(chunks.join("")).toBe("Hello");
  });

  it("serves the composed prompt and options over the bridge", async () => {
    const pending = askRaycast(
      server,
      { owner: "Youyinnn", prompt: "explain", model: "openai-gpt-4o", creativity: "high" },
      () => undefined,
      { open },
    );

    await waitFor(() => opened.length === 1);
    const context = contextOf(opened[0]);
    const res = await fetch(`http://127.0.0.1:${context.port}/job/${context.jobId}`, {
      headers: { [TOKEN_HEADER]: server.token },
    });
    expect(await res.json()).toMatchObject({
      kind: "ai.ask",
      prompt: "explain",
      model: "openai-gpt-4o",
      creativity: "high",
    });

    await post(context, "done", { ok: true });
    await pending;
  });

  it("targets the ask-ai command of the configured owner", async () => {
    const pending = askRaycast(server, { owner: "Someone", prompt: "hi" }, () => undefined, { open });
    await waitFor(() => opened.length === 1);
    expect(opened[0]).toContain("raycast://extensions/Someone/vscode-bridge/ask-ai");
    expect(opened[0]).toContain("launchType=background");
    await post(contextOf(opened[0]), "done", { ok: true });
    await pending;
  });

  it("omits model when it was not configured", async () => {
    const pending = askRaycast(server, { owner: "Youyinnn", prompt: "hi" }, () => undefined, { open });
    await waitFor(() => opened.length === 1);
    const context = contextOf(opened[0]);
    const res = await fetch(`http://127.0.0.1:${context.port}/job/${context.jobId}`, {
      headers: { [TOKEN_HEADER]: server.token },
    });
    expect(await res.json()).not.toHaveProperty("model");
    await post(context, "done", { ok: true });
    await pending;
  });

  it("gives up and forgets the job when the caller aborts mid-stream", async () => {
    const controller = new AbortController();
    const chunks: string[] = [];
    const pending = askRaycast(
      server,
      { owner: "Youyinnn", prompt: "hi", signal: controller.signal },
      (t) => chunks.push(t),
      { open },
    );

    await waitFor(() => opened.length === 1);
    const context = contextOf(opened[0]);
    await post(context, "chunk", { text: "Hel" });
    controller.abort();

    expect(await pending).toEqual({ ok: false, error: "Cancelled." });
    expect(server.pending()).toBe(0);
    expect(chunks.join("")).toBe("Hel");
  });

  it("never launches Raycast when the signal is already aborted", async () => {
    const result = await askRaycast(
      server,
      { owner: "Youyinnn", prompt: "hi", signal: AbortSignal.abort() },
      () => undefined,
      { open },
    );
    expect(result).toEqual({ ok: false, error: "Cancelled." });
    expect(opened).toEqual([]);
    expect(server.pending()).toBe(0);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never became true");
}
