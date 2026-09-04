import { AI, environment, LaunchProps, showHUD } from "@raycast/api";
import { TOKEN_HEADER, type BridgeContext, type Job } from "./protocol";

/** Batching interval for streamed chunks. Keeps the POST rate sane while still feeling live. */
const FLUSH_MS = 120;

export default async function command(props: LaunchProps<{ launchContext: BridgeContext }>) {
  const context = props.launchContext;
  if (!context?.jobId || !context.port || !context.token) {
    await showHUD("VSCode Bridge: launched without a job context");
    return;
  }

  const base = `http://127.0.0.1:${context.port}/job/${context.jobId}`;
  const authHeader = { [TOKEN_HEADER]: context.token };
  const jsonHeaders = { ...authHeader, "content-type": "application/json" };

  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });

  const fail = async (error: string) => {
    await post("/done", { ok: false, error });
    await showHUD(`VSCode Bridge: ${error}`);
  };

  try {
    // Checked up front so the user gets an error in VSCode rather than a
    // Raycast upgrade prompt that silently strands the pending job.
    if (!environment.canAccess(AI)) {
      await fail("Raycast AI requires a Raycast Pro subscription.");
      return;
    }

    const response = await fetch(base, { headers: authHeader });
    if (!response.ok) {
      await showHUD(`VSCode Bridge: could not fetch job (${response.status})`);
      return;
    }
    const job = (await response.json()) as Job;

    let buffer = "";
    let inFlight: Promise<unknown> = Promise.resolve();
    const flush = async () => {
      if (!buffer) return;
      const text = buffer;
      buffer = "";
      await post("/chunk", { text });
    };

    const stream = AI.ask(job.prompt, {
      model: job.model as AI.Model | undefined,
      creativity: job.creativity as AI.Creativity | undefined,
    });
    stream.on("data", (chunk) => {
      buffer += chunk;
    });

    const ticker = setInterval(() => {
      inFlight = inFlight.then(flush).catch(() => undefined);
    }, FLUSH_MS);

    try {
      await stream;
    } finally {
      clearInterval(ticker);
    }

    await inFlight;
    await flush();
    await post("/done", { ok: true });
  } catch (error) {
    await fail(error instanceof Error ? error.message : String(error));
  }
}
