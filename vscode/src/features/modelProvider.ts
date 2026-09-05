import * as vscode from "vscode";
import { askRaycast } from "../bridge/ask";
import { composePrompt, type Turn } from "../bridge/composePrompt";
import type { BridgeServer } from "../bridge/server";
import type { RaycastModel } from "../bridge/catalog";
import type { CatalogStore } from "./catalogStore";

/** Must match contributes.languageModelChatProviders[].vendor in package.json. */
const VENDOR = "raycast";

/** Sends no model id, so Raycast applies whatever its own default is. */
const DEFAULT_MODEL_ID = "default";

/**
 * Input budgets come from Raycast's catalog; this is only the floor used when a
 * model is missing from it.
 *
 * These are NOT display-only. Reporting 0 -- which VSCode core tolerates, since
 * its own uses are all guarded -- makes Copilot Chat's prompt renderer fail with
 * "No lowest priority node found" before it ever calls this provider: it prunes
 * the prompt to fit maxInputTokens, and a zero budget leaves nothing to keep.
 */
const FALLBACK_INPUT_TOKENS = 128_000;

/** Raycast publishes no output limit anywhere, so this one stays an estimate. */
const OUTPUT_TOKENS = 8_192;

/** No tokenizer is available, so token counts are a characters-per-token estimate. */
const CHARS_PER_TOKEN = 4;

export function registerModelProvider(
  context: vscode.ExtensionContext,
  server: BridgeServer,
  log: vscode.LogOutputChannel,
  catalog: CatalogStore,
): void {
  const provider = new RaycastModelProvider(server, log, catalog);
  context.subscriptions.push(
    provider,
    vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("raycastBridge.models")) {
        provider.refresh();
      }
    }),
  );
}

/**
 * The model picker filters on `isUserSelectable`, which the extension host
 * reads ungated but which is absent from the stable LanguageModelChatInformation
 * typings (checked against @types/vscode 1.136.0). Omitting it leaves the models
 * registered but invisible, so the provider is parameterised to carry it.
 */
type SelectableModel = vscode.LanguageModelChatInformation & { readonly isUserSelectable: boolean };

/**
 * Puts Raycast AI in VSCode's model picker. Answers never touch Copilot: every
 * request is forwarded over the loopback bridge to Raycast.
 *
 * Tool calling is impossible -- `AI.ask` takes a string and returns a string --
 * so VSCode filters these models out of Agent mode. Ask mode is unaffected.
 */
class RaycastModelProvider
  implements vscode.LanguageModelChatProvider<SelectableModel>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changed.event;

  constructor(
    private readonly server: BridgeServer,
    private readonly log: vscode.LogOutputChannel,
    private readonly catalog: CatalogStore,
  ) {}

  refresh(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }

  async provideLanguageModelChatInformation(): Promise<SelectableModel[]> {
    const configured = vscode.workspace
      .getConfiguration("raycastBridge")
      .get<string[]>("models", [])
      .map((id) => id.trim())
      .filter(Boolean);

    const catalog = await this.catalog.ensure();

    // A configured model Raycast has retired is dropped rather than offered
    // with a guessed budget and its raw id for a name. migrateDeprecatedModels
    // is what tells the user, so this stays silent apart from the log.
    const offered = new Set(this.catalog.offered().map((model) => model.id));
    const known = configured.filter((id) => offered.has(id));
    const dropped = configured.filter((id) => !known.includes(id));
    if (dropped.length) {
      this.log.warn(`skipping models Raycast no longer offers: ${dropped.join(", ")}`);
    }
    const ids = [...new Set([DEFAULT_MODEL_ID, ...known])];
    this.log.info(`provideLanguageModelChatInformation -> ${ids.join(", ")}`);

    // The default entry sends no model id, so its budget is whatever AI.ask
    // falls back to on Raycast's side.
    const fallbackId = catalog.defaultModelId;
    return ids.map((id) => {
      const model = this.catalog.find(id === DEFAULT_MODEL_ID ? (fallbackId ?? id) : id);
      return {
        id,
        name: id === DEFAULT_MODEL_ID ? "Raycast AI" : (model?.name ?? id),
        family: VENDOR,
        version: "1.0",
        maxInputTokens: model?.contextTokens ?? FALLBACK_INPUT_TOKENS,
        maxOutputTokens: OUTPUT_TOKENS,
        tooltip: model?.description
          ? `${model.description}\n\nAnswered by Raycast AI, not Copilot.`
          : "Answers come from Raycast AI, not from Copilot.",
        isUserSelectable: true,
        detail: describe(id, model, fallbackId),
        // Declared despite AI.ask having no function calling, because VSCode 1.117
        // hides models without it from the picker entirely -- established by
        // experiment, not by reading the filter, which appears not to check it in
        // Ask mode. The cost is that these models also show up in Agent mode,
        // where the tool definitions VSCode sends are ignored and the agent loop
        // stalls on a plain text reply. Ask mode is what this is for.
        capabilities: { toolCalling: true, imageInput: false },
      };
    });
  }

  async provideLanguageModelChatResponse(
    model: SelectableModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    _options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.log.info(
      `chat request: model=${model.id}, ${messages.length} message(s), ${_options.tools?.length ?? 0} tool(s), toolMode=${_options.toolMode}`,
    );
    const config = vscode.workspace.getConfiguration("raycastBridge");
    const owner = config.get<string>("owner")?.trim();
    if (!owner) {
      this.log.error("raycastBridge.owner is not set");
      throw new Error("Set raycastBridge.owner to your Raycast Store handle.");
    }

    // Raycast has no session, so the whole exchange is replayed every turn.
    const turns = toTurns(messages);
    const question = turns.pop();
    if (!question) {
      throw new Error("Nothing to ask Raycast AI.");
    }

    // Cancelling only stops this side; Raycast keeps generating and keeps spending quota.
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());

    let chunks = 0;
    let characters = 0;
    // 41 of Raycast's 80 models reject a temperature, so creativity is only
    // sent to the ones that take one.
    const catalog = await this.catalog.ensure();
    const resolvedId = model.id === DEFAULT_MODEL_ID ? catalog.defaultModelId : model.id;
    const creativity = resolvedId && this.catalog.find(resolvedId)?.supportsTemperature === false
      ? undefined
      : config.get<string>("creativity") ?? "none";

    const result = await askRaycast(
      this.server,
      {
        owner,
        prompt: composePrompt({ question: question.text, history: turns }),
        ...(creativity ? { creativity } : {}),
        ...(model.id === DEFAULT_MODEL_ID ? {} : { model: model.id }),
        signal: controller.signal,
      },
      (text) => {
        chunks += 1;
        characters += text.length;
        progress.report(new vscode.LanguageModelTextPart(text));
      },
      { log: (message) => this.log.info(message) },
    );
    this.log.info(`streamed ${chunks} chunk(s), ${characters} char(s)`);

    if (!result.ok && !token.isCancellationRequested) {
      this.log.error(`request failed: ${result.error}`);
      // Raycast rejects some of its own catalogued models outright. Remember
      // that so the model stops being offered instead of failing again.
      if (resolvedId && looksUnsupported(result.error)) {
        await this.catalog.recordSupport(resolvedId, result.error);
        this.log.warn(`${resolvedId} marked unsupported and hidden from the pickers`);
      }
      throw new Error(result.error);
    }
  }

  async provideTokenCount(
    _model: SelectableModel,
    text: string | vscode.LanguageModelChatRequestMessage,
  ): Promise<number> {
    const value = typeof text === "string" ? text : textOf(text);
    return Math.ceil(value.length / CHARS_PER_TOKEN);
  }
}

/**
 * Raycast surfaces an unknown model id as a Swift decoding failure rather than
 * anything model-specific, so the message is what there is to match on.
 */
function looksUnsupported(error: string): boolean {
  return /isn.t in the correct format|correct format|unsupported model|unknown model/i.test(error);
}

/** One line under the model name in the picker. */
function describe(id: string, model: RaycastModel | undefined, fallbackId: string | undefined): string {
  const parts: string[] = [];
  if (id === DEFAULT_MODEL_ID) {
    parts.push(`Raycast's default${fallbackId ? ` (${fallbackId})` : ""}`);
  } else {
    parts.push(id);
  }
  if (model) {
    parts.push(`${Math.round(model.contextTokens / 1000)}K context`);
    if (model.typicalMessageUsd !== undefined) {
      parts.push(`~$${model.typicalMessageUsd.toFixed(4)}/message`);
    }
    if (model.requiresBetterAi) {
      parts.push("needs Advanced AI");
    }
  }
  return parts.join(" · ");
}

function toTurns(messages: readonly vscode.LanguageModelChatRequestMessage[]): Turn[] {
  return messages
    .map((message) => ({
      role:
        message.role === vscode.LanguageModelChatMessageRole.Assistant
          ? ("assistant" as const)
          : ("user" as const),
      text: textOf(message),
    }))
    .filter((turn) => turn.text.trim());
}

/** Tool and data parts are dropped: this provider declares no tool calling. */
function textOf(message: vscode.LanguageModelChatRequestMessage): string {
  return message.content
    .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
    .map((part) => part.value)
    .join("");
}
