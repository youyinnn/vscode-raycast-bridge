/**
 * Wire contract between the VSCode extension (server) and the Raycast
 * extension (client). Kept in sync by hand with raycast/src/protocol.ts.
 */

export type JobKind = "ai.ask";

export type Job = {
  id: string;
  kind: JobKind;
  prompt: string;
  model?: string;
  creativity?: string;
};

/** Payload carried in the deeplink's `context` query parameter. */
export type BridgeContext = {
  jobId: string;
  port: number;
  token: string;
};

export type ChunkPayload = { text: string };

export type DonePayload = { ok: true } | { ok: false; error: string };

export const TOKEN_HEADER = "x-bridge-token";
