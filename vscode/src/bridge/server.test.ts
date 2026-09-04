import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeServer } from "./server";
import { TOKEN_HEADER, type DonePayload, type Job } from "./protocol";

const job: Job = { id: "job-1", kind: "ai.ask", prompt: "hello" };

describe("BridgeServer", () => {
  let server: BridgeServer;
  let base: string;

  beforeEach(async () => {
    server = new BridgeServer();
    base = `http://127.0.0.1:${await server.listen()}`;
  });

  afterEach(() => server.dispose());

  const auth = () => ({ [TOKEN_HEADER]: server.token });

  it("rejects a request with no token", async () => {
    const res = await fetch(`${base}/job/${job.id}`);
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong token", async () => {
    const res = await fetch(`${base}/job/${job.id}`, {
      headers: { [TOKEN_HEADER]: "f".repeat(server.token.length) },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a browser-originated request even with a valid token", async () => {
    const res = await fetch(`${base}/job/${job.id}`, {
      headers: { ...auth(), origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown job", async () => {
    const res = await fetch(`${base}/job/nope`, { headers: auth() });
    expect(res.status).toBe(404);
  });

  it("runs a full job lifecycle and forgets the job afterwards", async () => {
    const chunks: string[] = [];
    let done: DonePayload | undefined;
    server.register(job, {
      onChunk: (text) => chunks.push(text),
      onDone: (result) => (done = result),
    });
    expect(server.pending()).toBe(1);

    const fetched = await fetch(`${base}/job/${job.id}`, { headers: auth() });
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({ id: job.id, prompt: "hello" });

    for (const text of ["Hel", "lo!"]) {
      const res = await fetch(`${base}/job/${job.id}/chunk`, {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      expect(res.status).toBe(200);
    }
    expect(chunks.join("")).toBe("Hello!");

    const finish = await fetch(`${base}/job/${job.id}/done`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    expect(finish.status).toBe(200);
    expect(done).toEqual({ ok: true });
    expect(server.pending()).toBe(0);

    const after = await fetch(`${base}/job/${job.id}`, { headers: auth() });
    expect(after.status).toBe(404);
  });

  it("propagates a failure reported by Raycast", async () => {
    let done: DonePayload | undefined;
    server.register(job, { onChunk: () => {}, onDone: (r) => (done = r) });
    await fetch(`${base}/job/${job.id}/done`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: "quota exceeded" }),
    });
    expect(done).toEqual({ ok: false, error: "quota exceeded" });
  });

  it("rejects a malformed chunk body", async () => {
    server.register(job, { onChunk: () => {}, onDone: () => {} });
    const res = await fetch(`${base}/job/${job.id}/chunk`, {
      method: "POST",
      headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({ nope: 1 }),
    });
    expect(res.status).toBe(400);
  });
});
