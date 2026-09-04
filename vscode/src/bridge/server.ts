import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { TOKEN_HEADER, type ChunkPayload, type DonePayload, type Job } from "./protocol";

const JOB_TTL_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;

export type JobHandlers = {
  onChunk: (text: string) => void;
  onDone: (result: DonePayload) => void;
};

type Entry = JobHandlers & { job: Job; timer: NodeJS.Timeout };

/**
 * Localhost job broker. Raycast cannot host a long-lived server because its
 * command processes are unloaded after each run, so the VSCode extension host
 * owns the socket and Raycast connects back into it.
 */
export class BridgeServer {
  readonly token = randomBytes(32).toString("hex");

  private server: Server | undefined;
  private readonly jobs = new Map<string, Entry>();

  /** Starts listening on an ephemeral loopback port. Idempotent. */
  async listen(): Promise<number> {
    if (this.server) {
      return (this.server.address() as AddressInfo).port;
    }
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => respond(res, 500, { error: "internal" }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    this.server = server;
    return (server.address() as AddressInfo).port;
  }

  register(job: Job, handlers: JobHandlers): void {
    const timer = setTimeout(() => {
      this.jobs.delete(job.id);
      handlers.onDone({ ok: false, error: "Timed out waiting for Raycast." });
    }, JOB_TTL_MS);
    timer.unref?.();
    this.jobs.set(job.id, { job, ...handlers, timer });
  }

  pending(): number {
    return this.jobs.size;
  }

  dispose(): void {
    for (const [id, entry] of this.jobs) {
      clearTimeout(entry.timer);
      this.jobs.delete(id);
    }
    this.server?.close();
    this.server = undefined;
  }

  /**
   * Any local process can reach a loopback port, so an unauthenticated server
   * would let anything inject text into the user's editor. The Origin check
   * blocks browser-driven DNS rebinding: Raycast's own fetch sends no Origin.
   */
  private authorized(req: IncomingMessage): boolean {
    if (req.headers.origin) {
      return false;
    }
    const given = req.headers[TOKEN_HEADER];
    if (typeof given !== "string") {
      return false;
    }
    const a = Buffer.from(given);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.origin) {
      respond(res, 403, { error: "origin not allowed" });
      return;
    }
    if (!this.authorized(req)) {
      respond(res, 401, { error: "unauthorized" });
      return;
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = /^\/job\/([^/]+)(?:\/(chunk|done))?$/.exec(url.pathname);
    if (!match) {
      respond(res, 404, { error: "not found" });
      return;
    }

    const [, jobId, action] = match;
    const entry = this.jobs.get(jobId);
    if (!entry) {
      respond(res, 404, { error: "unknown job" });
      return;
    }

    if (!action && req.method === "GET") {
      respond(res, 200, entry.job);
      return;
    }
    if (action && req.method !== "POST") {
      respond(res, 405, { error: "method not allowed" });
      return;
    }

    if (action === "chunk") {
      const body = await readJson<ChunkPayload>(req);
      if (typeof body?.text !== "string") {
        respond(res, 400, { error: "expected { text: string }" });
        return;
      }
      entry.onChunk(body.text);
      respond(res, 200, { ok: true });
      return;
    }

    if (action === "done") {
      const body = await readJson<DonePayload>(req);
      if (typeof body?.ok !== "boolean") {
        respond(res, 400, { error: "expected { ok: boolean }" });
        return;
      }
      clearTimeout(entry.timer);
      this.jobs.delete(jobId);
      entry.onDone(body);
      respond(res, 200, { ok: true });
      return;
    }

    respond(res, 405, { error: "method not allowed" });
  }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}
