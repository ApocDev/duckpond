import { z } from "zod";
import { outfitSchema } from "./room";

/**
 * A duck in the shared library. Advisers weigh what's best for the person; people say what they
 * would do, buy, or skip. Every pond and conversation picks its panel from this one library.
 */
export const panelDuckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["adviser", "person"]),
  /** Who the duck is, written to the duck ("You are 15…"). */
  brief: z.string().trim().min(1).max(4000),
  /** Gateway model ID: a bare name runs on a subscription, `provider/model` is paid. */
  model: z.string().trim().min(1).max(120),
  avatar: outfitSchema,
});
export type PanelDuck = z.infer<typeof panelDuckSchema>;

export const replySchema = z.object({
  duckId: z.string(),
  status: z.enum(["thinking", "done", "passed", "stopped", "error"]),
  text: z.string(),
  model: z.string(),
  cost: z.number().default(0),
});
export type Reply = z.infer<typeof replySchema>;

const sideSchema = z.object({
  position: z.string(),
  duckIds: z.array(z.string()),
});
/** Mediator's summary of a panel round, requested as structured output. */
export const briefSchema = z.object({
  /** One sentence on where the panel landed. */
  headline: z.string(),
  /** Each distinct pick and the ducks who ended on it. */
  options: z.array(z.object({ label: z.string(), duckIds: z.array(z.string()) })),
  agreed: z.array(z.string()),
  /** Disagreements about what will happen, which research could check. */
  facts: z.array(z.object({ question: z.string(), sides: z.array(sideSchema) })),
  /** Trade-offs only the person can decide. */
  values: z.array(z.object({ tradeoff: z.string(), sides: z.array(sideSchema) })),
  question: z.string(),
  /** The most decision-relevant fact to look up, or null. */
  research: z.string().nullable(),
});
export type Brief = z.infer<typeof briefSchema>;

export const researchSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  status: z.enum(["running", "done", "error"]),
  text: z.string(),
  /** Searches and pages read so far, newest last. */
  steps: z.array(z.string()),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
});
export type Research = z.infer<typeof researchSchema>;

export const turnSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  /** "panel", or the ID of the one duck asked directly. */
  to: z.string(),
  status: z.enum(["running", "done", "stopped", "error"]),
  error: z.string().optional(),
  /** Round 1 is blind; later rounds are reactions. A direct question has one round of one reply. */
  rounds: z.array(z.array(replySchema)),
  stopReason: z.string().optional(),
  brief: briefSchema.optional(),
  briefCost: z.number().default(0),
  research: z.array(researchSchema).default([]),
  createdAt: z.string(),
});
export type Turn = z.infer<typeof turnSchema>;

export const decisionSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
  turnId: z.string().uuid(),
  createdAt: z.string(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const panelSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  /** The pond whose folder research reads. */
  pondId: z.string().uuid().optional(),
  duckIds: z.array(z.string()).min(1),
  turns: z.array(turnSchema),
  decisions: z.array(decisionSchema),
  updatedAt: z.string(),
});
export type Panel = z.infer<typeof panelSchema>;

/** Reaction rounds after the blind round, at most. */
export const maxReactionRounds = 3;

export type Stance = "changed" | "disagree" | "nothing";
/** The stance a reaction opens with, if it follows the format. */
export function stanceOf(text: string): Stance | undefined {
  const head = text.replace(/^[\s*_#>"-]+/, "").toUpperCase();
  if (head.startsWith("CHANGED")) return "changed";
  if (head.startsWith("STILL DISAGREE")) return "disagree";
  if (head.startsWith("NOTHING TO ADD")) return "nothing";
}
/** The one-sentence position a panel reply ends with. */
export function positionOf(text: string) {
  return text
    .match(/POSITION:\s*(.+)/i)?.[1]
    ?.replace(/\*+/g, "")
    .trim();
}
/** A reply without its stance prefix and position line, for reading. */
export function bodyOf(text: string) {
  return text
    .replace(/^\s*\**\s*(CHANGED|STILL DISAGREE)\s*:?\**\s*/i, "")
    .replace(/^\s*\**\s*NOTHING TO ADD\.?\**\s*/i, "")
    .replace(/\n*\s*\**POSITION:?\**.*$/is, "")
    .trim();
}
export const isPass = (text: string) => /^\W*PASS\W*$/i.test(text.trim());

const adviserRules = `You are one of several advisers on a panel giving a person feedback. Speak as yourself, in first person, from your own experience. If something is outside your experience, say so plainly instead of explaining it. Don't hedge or cover every angle. Give your honest take. Treat the person's recorded decisions as settled unless they reopen them.`;
// People ducks stand in for customers and users: they report their own reaction instead of advising.
const personRules = `You are a real person on a panel, reacting to someone's plan. You are not an adviser. Answer from your own wants, money, habits, and feelings: what you would actually do, buy, try, or skip, and why. Don't weigh what's best for the person asking or solve their problems for them. Other panelists do that. Talk the way you actually talk. You only know what this person would realistically know.`;

export function duckSystem(duck: PanelDuck) {
  return `${duck.brief}\n\n${duck.kind === "person" ? personRules : adviserRules}`;
}

type Names = Map<string, string>;
const nameOf = (names: Names, id: string) => names.get(id) ?? id;

/**
 * What one duck knows of the conversation before the current turn: the person's decisions,
 * earlier briefs, research notes, its own earlier replies, and direct exchanges. Earlier panel
 * rounds are not repeated in full, so prompts stay short in long conversations.
 */
export function historyFor(panel: Panel, duckId: string, names: Names, before: number) {
  const parts: string[] = [];
  if (panel.decisions.length)
    parts.push(
      `Decisions the person has made:\n${panel.decisions.map((d) => `- ${d.text}`).join("\n")}`,
    );
  for (const turn of panel.turns.slice(0, before)) {
    if (turn.status === "running") continue;
    const replies = turn.rounds.flat().filter((reply) => reply.status === "done");
    if (turn.to !== "panel") {
      const reply = replies[0]?.text ?? "(no reply)";
      parts.push(
        turn.to === duckId
          ? `The person asked you directly: ${turn.text}\nYou replied: ${reply}`
          : `The person asked ${nameOf(names, turn.to)} directly: ${turn.text}\n${nameOf(names, turn.to)} replied: ${reply}`,
      );
      continue;
    }
    const lines = [`The person asked the panel: ${turn.text}`];
    if (turn.brief) {
      lines.push(`Where the panel landed: ${turn.brief.headline}`);
      const own = turn.rounds
        .flat()
        .filter((reply) => reply.duckId === duckId && reply.status === "done")
        .at(-1);
      if (own) lines.push(`Your last reply: ${positionOf(own.text) ?? bodyOf(own.text)}`);
    } else
      for (const reply of replies)
        lines.push(
          `${reply.duckId === duckId ? "You" : nameOf(names, reply.duckId)}: ${reply.text}`,
        );
    for (const note of turn.research.filter((item) => item.status === "done"))
      lines.push(`Research on "${note.question}":\n${note.text}`);
    parts.push(lines.join("\n"));
  }
  return parts.length ? `The conversation so far:\n\n${parts.join("\n\n")}\n\n---\n\n` : "";
}

export function firstRoundPrompt(history: string, question: string) {
  return `${history}The person asks the panel:\n${question}\n\nGive your take in under 120 words. If you have nothing useful to add from your perspective, reply with only PASS. Otherwise end with one line: POSITION: <your stance and main reason, in one sentence>`;
}

export function transcript(rounds: Reply[][], names: Names) {
  return rounds
    .map(
      (round, index) =>
        `Round ${index + 1}:\n\n${round
          .filter((reply) => reply.status === "done")
          .map((reply) => `${nameOf(names, reply.duckId)}:\n${reply.text}`)
          .join("\n\n")}`,
    )
    .join("\n\n");
}

export function reactionPrompt(history: string, question: string, rounds: Reply[][], names: Names) {
  return `${history}The person asks the panel:\n${question}\n\nThe panel so far:\n\n${transcript(rounds, names)}\n\nReact to the others, as yourself, in under 100 words. Don't repeat points already made. Start with exactly one of:\n- "CHANGED:" only if your stance or main reason actually changed. Say who changed it and why.\n- "STILL DISAGREE:" if you disagree with someone. Say who and why.\n- "NOTHING TO ADD."\nEnd with one line: POSITION: <your stance and main reason now, in one sentence>`;
}

export function directPrompt(history: string, question: string) {
  return `${history}The person asks you directly:\n${question}\n\nReply as yourself in under 150 words.`;
}

export const mediatorSystem = `You summarize a panel discussion for the person who asked. Report only what panelists actually said. Never attribute a point to someone who didn't make it, and don't add your own opinion. Refer to panelists only by the IDs you are given.`;

export function mediatorPrompt(panel: Panel, question: string, rounds: Reply[][], names: Names) {
  const roster = [...names].map(([id, name]) => `${id}: ${name}`).join("\n");
  const decisions = panel.decisions.length
    ? `\n\nDecisions the person already made:\n${panel.decisions.map((d) => `- ${d.text}`).join("\n")}`
    : "";
  return `Panelist IDs:\n${roster}${decisions}\n\nThe person asked the panel:\n${question}\n\n${transcript(rounds, names)}\n\nSummarize for the person. headline: one sentence on where the panel landed. options: each distinct pick and the panelist IDs who ended on it. agreed: up to 3 points everyone shares. facts: disagreements about what will happen that research could check, with each side's panelist IDs. values: trade-offs only the person can decide, with each side's panelist IDs. question: the one question the person should answer. research: the single most decision-relevant factual question to look up, or null if none.`;
}

export const researchSystem = `You are a careful researcher answering one factual question for the person running a panel discussion. Read the project files in your working folder when the question is about the project, and use web search for anything else. Every claim needs a source: a file path with line numbers, or a link. If you can't confirm something, write "Couldn't confirm" instead of guessing. Prefer primary sources such as docs, data, and postmortems. Answer in under 200 words: a one-sentence answer first, then the supporting points with sources.`;
