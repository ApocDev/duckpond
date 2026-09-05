import { createHash } from "node:crypto";
import { z } from "zod";
import type { Duck, Message } from "../lib/room";
import type { RoomTools } from "./room-tools.server";
import { readProviderSession, saveProviderSession, saveProviderUsage } from "./store.server";

export const tokenUsageSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative().nullable(),
  reasoning: z.number().nonnegative().nullable(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
const sessionSchema = z.object({
  fingerprint: z.string(),
  nativeId: z.string().optional(),
  delivered: z.record(z.string(), z.string()),
});
export type ReplyContext = {
  roomId?: string;
  reuse?: boolean;
  messages: Message[];
  responseId?: string;
  makePrompt: (messages: Message[]) => string;
};
export type NativeSession = {
  id?: string;
  opened: (id: string) => void;
  accepted: () => void;
  usage: (usage: TokenUsage) => void;
};
export const usageRecordSchema = z.object({
  id: z.string(),
  roomId: z.string().nullable(),
  duckId: z.string(),
  duckName: z.string(),
  provider: z.enum(["claude", "codex"]),
  model: z.string(),
  reasoning: z.string().nullable(),
  responseId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(["running", "complete", "error", "stopped"]),
  resumed: z.boolean(),
  newMessages: z.number().nullable(),
  promptCharacters: z.number(),
  tokens: tokenUsageSchema.nullable(),
});

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function messageHash({ id, duckId, speaker, text, status, tools }: Message) {
  return hash({ id, duckId, speaker, text, status, tools });
}
const storage = { readProviderSession, saveProviderSession, saveProviderUsage };

/** Keep delivery state separate from the room. Never silently replace a failed resume. */
export function prepareReply(
  duck: Duck,
  system: string,
  originalPrompt: string,
  cwd: string,
  tools?: RoomTools,
  context?: ReplyContext,
  store = storage,
) {
  const key =
    context?.roomId && context.reuse !== false ? `${context.roomId}/${duck.id}` : undefined;
  const fingerprint = hash({
    provider: duck.provider,
    model: duck.model,
    system,
    cwd,
    tools: tools?.definitions.map(({ name, description, inputSchema }) => ({
      name,
      description,
      schema: z.toJSONSchema(inputSchema),
    })),
  });
  const previous = key ? sessionSchema.optional().parse(store.readProviderSession(key)) : undefined;
  const session: z.infer<typeof sessionSchema> =
    previous?.fingerprint === fingerprint
      ? previous
      : { fingerprint, delivered: {}, nativeId: undefined };
  const unseen = context?.messages.filter((message) => {
    const delivered = session.delivered[message.id];
    return delivered !== "native" && delivered !== messageHash(message);
  });
  const prompt = context ? context.makePrompt(unseen!) : originalPrompt;
  const record = usageRecordSchema.parse({
    id: crypto.randomUUID(),
    roomId: context?.roomId ?? null,
    duckId: duck.id,
    duckName: duck.name,
    provider: duck.provider,
    model: duck.model,
    reasoning: duck.reasoning ?? null,
    responseId: context?.responseId ?? null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    resumed: !!session.nativeId,
    newMessages: unseen?.length ?? null,
    promptCharacters: prompt.length,
    tokens: null,
  });
  const save = () => {
    if (key) store.saveProviderSession(key, session);
  };
  store.saveProviderUsage(record.id, record);
  let accepted = false;
  const native: NativeSession = {
    id: session.nativeId,
    opened(id) {
      if (session.nativeId === id) return;
      session.nativeId = id;
      save();
    },
    accepted() {
      if (accepted) return;
      accepted = true;
      for (const message of unseen ?? []) session.delivered[message.id] = messageHash(message);
      save();
    },
    usage(tokens) {
      record.tokens = tokens;
      store.saveProviderUsage(record.id, record);
    },
  };
  return {
    prompt,
    native,
    finish(status: "complete" | "error" | "stopped") {
      if (status === "complete") {
        native.accepted();
        // The provider already has its own answer in its native transcript.
        if (context?.responseId) session.delivered[context.responseId] = "native";
        save();
      }
      record.status = status;
      record.finishedAt = new Date().toISOString();
      store.saveProviderUsage(record.id, record);
    },
  };
}

/** Sum each inference's last usage once. Native cumulative totals can reset on reconnect. */
export function codexUsageTracker(report: (usage: TokenUsage) => void) {
  const schema = z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedInputTokens: z.number(),
    cacheWriteInputTokens: z.number().optional(),
    reasoningOutputTokens: z.number().optional(),
  });
  let lastNotification: string | undefined;
  let active = false;
  const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  return {
    start() {
      active = true;
    },
    update(value: unknown) {
      const { total, last } = z.object({ total: schema, last: schema }).parse(value);
      const notification = JSON.stringify(total);
      if (notification === lastNotification) return;
      lastNotification = notification;
      if (!active) return;
      tokens.input += last.inputTokens;
      tokens.output += last.outputTokens;
      tokens.cacheRead += last.cachedInputTokens;
      tokens.cacheWrite =
        tokens.cacheWrite === null || last.cacheWriteInputTokens === undefined
          ? null
          : tokens.cacheWrite + last.cacheWriteInputTokens;
      tokens.reasoning =
        tokens.reasoning === null || last.reasoningOutputTokens === undefined
          ? null
          : tokens.reasoning + last.reasoningOutputTokens;
      report({ ...tokens });
    },
  };
}

/** Claude's result.modelUsage includes subagents and compaction; result.usage covers only the main loop. */
export function claudeUsage(
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
  modelUsage?: Record<
    string,
    {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
    }
  >,
): TokenUsage {
  const models = Object.values(modelUsage ?? {});
  if (models.length)
    return models.reduce<TokenUsage>(
      (total, model) => ({
        input:
          total.input +
          model.inputTokens +
          model.cacheReadInputTokens +
          model.cacheCreationInputTokens,
        output: total.output + model.outputTokens,
        cacheRead: total.cacheRead + model.cacheReadInputTokens,
        cacheWrite: (total.cacheWrite ?? 0) + model.cacheCreationInputTokens,
        reasoning: null,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null },
    );
  return {
    input:
      usage.input_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    reasoning: null,
  };
}
