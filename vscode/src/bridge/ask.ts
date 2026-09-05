import { randomUUID } from "node:crypto";
import { buildDeeplink, openDeeplink } from "./deeplink";
import type { BridgeContext, DonePayload, Job } from "./protocol";
import type { BridgeServer } from "./server";

const EXTENSION_NAME = "vscode-bridge";
const COMMAND_NAME = "ask-ai";

export type AskParams = {
  owner: string;
  prompt: string;
  model?: string;
  creativity?: string;
  signal?: AbortSignal;
};

/** Seams for tests, which must not spawn `open` or depend on a random id. */
export type AskDeps = {
  open?: (url: string) => Promise<void>;
  newId?: () => string;
  log?: (message: string) => void;
};

/**
 * Runs one prompt through Raycast AI and resolves once Raycast reports done.
 *
 * Cancellation is one-sided: aborting stops the stream and forgets the job,
 * but Raycast has already been launched and keeps generating -- and keeps
 * spending quota -- because deeplinks carry no channel back into it.
 */
export async function askRaycast(
  server: BridgeServer,
  params: AskParams,
  onChunk: (text: string) => void,
  deps: AskDeps = {},
): Promise<DonePayload> {
  const { open = openDeeplink, newId = randomUUID, log = () => undefined } = deps;
  const cancelled: DonePayload = { ok: false, error: "Cancelled." };
  if (params.signal?.aborted) {
    return cancelled;
  }

  const job: Job = {
    id: newId(),
    kind: "ai.ask",
    prompt: params.prompt,
    ...(params.creativity ? { creativity: params.creativity } : {}),
    ...(params.model ? { model: params.model } : {}),
  };

  const finished = new Promise<DonePayload>((resolve) => {
    server.register(job, { onChunk, onDone: resolve });
    params.signal?.addEventListener(
      "abort",
      () => {
        server.unregister(job.id);
        resolve(cancelled);
      },
      { once: true },
    );
  });

  const port = await server.listen();
  const context: BridgeContext = { jobId: job.id, port, token: server.token };
  const url = buildDeeplink({
    owner: params.owner,
    extension: EXTENSION_NAME,
    command: COMMAND_NAME,
    launchType: "background",
    context,
  });
  log(`opening ${url.replace(server.token, "<token>")}`);
  await open(url);

  const result = await finished;
  log(`job ${job.id} finished: ${JSON.stringify(result)}`);
  return result;
}
