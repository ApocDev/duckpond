import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Message } from "../lib/room";
import { dataDirectory } from "./store.server";

// Stay below the provider's one-million-character request limit, including tool overhead.
export const promptCharacterBudget = 250000;
export const handoffCharacterBudget = 32000;
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
  const budget = handoffCharacterBudget;
  const directory = join(dataDirectory, "context");
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, `${crypto.randomUUID()}.jsonl`);
  const instructions = `\n\nContext handoff: the full visible room transcript is saved as JSONL at ${JSON.stringify(archive)}. This prompt contains selected original messages, not a generated summary. Search the archive by message ID or topic when earlier context matters. Before claiming an agreement, reopening a rejected option, or executing work, verify the original human decision and the proposal it answers. Preserve constraints, minority views, approvals and unfinished work. A duck's summary is a report, not human authorization. Shared notes and action records above remain authoritative room state. Earlier native tool output is not included; reopen cited files when those details matter. Read any omitted latest human message before answering. Do not rerun the panel just to reconstruct history.`;
  const latestHumanIndex = messages.findLastIndex((message) => !message.duckId);
  const latestHuman = messages[latestHumanIndex];
  const notice = latestHuman
    ? `\nLatest human message ${latestHuman.id} is in the archive and MUST be read before replying.`
    : "";
  const overhead = instructions.length + notice.length;
  if (makePrompt([]).length + overhead > budget)
    throw new Error(
      "Room instructions and action state exceed the request budget. No provider call was started; the conversation is saved.",
    );
  const chosen = new Set<Message>();
  // Keep approvals with the proposal they answer, before filling with older context.
  const candidates = [
    ...(latestHuman ? [latestHuman] : []),
    ...messages.slice(Math.max(0, latestHumanIndex - 1), Math.max(0, latestHumanIndex)),
    ...messages.slice(-8).reverse(),
    ...messages
      .flatMap((message, index) =>
        !message.duckId ? [message, ...messages.slice(Math.max(0, index - 1), index)] : [],
      )
      .reverse(),
    ...messages
      .filter((message) => message.duckId === "mediator" || message.phase === "guide")
      .slice(-3)
      .reverse(),
  ];
  for (const message of candidates) {
    if (chosen.has(message)) continue;
    chosen.add(message);
    if (makePrompt(messages.filter((item) => chosen.has(item))).length + overhead > budget)
      chosen.delete(message);
  }
  writeFileSync(archive, messages.map((message) => JSON.stringify(message)).join("\n"), {
    mode: 0o600,
  });
  const omitted = messages.filter((message) => !chosen.has(message));
  const prompt =
    makePrompt(messages.filter((message) => chosen.has(message))) +
    instructions +
    (latestHuman && !chosen.has(latestHuman) ? notice : "");
  if (prompt.length > budget)
    throw new Error("Context handoff exceeds the request budget. No provider call was started.");
  return { prompt, omitted: omitted.length };
}
