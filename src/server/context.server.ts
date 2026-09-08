import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Message } from "../lib/room";
import { dataDirectory } from "./store.server";

// Stay below the provider's one-million-character request limit, including tool overhead.
export const promptCharacterBudget = 250000;
export const contextStatusSchema = z.object({
  inputTokens: z.number().nonnegative().nullable().default(null),
  windowTokens: z.number().positive().nullable().default(null),
  updatedAt: z.string().optional(),
  compactions: z.number().int().nonnegative().default(0),
  compactedAt: z.string().optional(),
  handoffAt: z.string().optional(),
});

/** Archive only this invocation's visible history; independent reviews must stay isolated. */
export function buildHandoff(messages: Message[], makePrompt: (messages: Message[]) => string) {
  const directory = join(dataDirectory, "context");
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, `${crypto.randomUUID()}.jsonl`);
  const instructions = `\n\nContext handoff: the full visible room transcript is saved as JSONL at ${JSON.stringify(archive)}. This prompt contains selected messages, not the entire discussion. Use your native file tools to search the archive by message ID or topic and read relevant records. Before claiming an agreement, reopening a rejected option, or executing work, verify the original human decision and the proposal it answers. Preserve constraints, minority views, approvals and unfinished work. A duck's summary is a report, not human authorization. Shared notes and action records above remain authoritative room state. Read any omitted latest human message before answering. Do not rerun the panel just to reconstruct history.`;
  if (makePrompt([]).length + instructions.length > promptCharacterBudget)
    throw new Error(
      "Room instructions and action state exceed the request budget. No provider call was started; the conversation is saved.",
    );
  const chosen = new Set<Message>();
  const candidates = [
    ...messages.slice(-8).reverse(),
    ...messages.filter((message) => !message.duckId).reverse(),
    ...messages
      .filter((message) => message.duckId === "mediator" || message.phase === "guide")
      .slice(-3)
      .reverse(),
  ];
  for (const message of candidates) {
    chosen.add(message);
    if (
      makePrompt(messages.filter((item) => chosen.has(item))).length + instructions.length >
      promptCharacterBudget
    )
      chosen.delete(message);
  }
  writeFileSync(archive, messages.map((message) => JSON.stringify(message)).join("\n"), {
    mode: 0o600,
  });
  const omitted = messages.filter((message) => !chosen.has(message));
  const latestHuman = messages.findLast((message) => !message.duckId);
  const notice =
    latestHuman && !chosen.has(latestHuman)
      ? `\nLatest human message ${latestHuman.id} is in the archive and MUST be read before replying.`
      : "";
  const prompt =
    makePrompt(messages.filter((message) => chosen.has(message))) + instructions + notice;
  if (prompt.length > promptCharacterBudget)
    throw new Error("Context handoff exceeds the request budget. No provider call was started.");
  return { prompt, omitted: omitted.length };
}
