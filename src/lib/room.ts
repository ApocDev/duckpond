import { z } from "zod";
import type { ApprovalField } from "./approval";
import type { UIMessage } from "ai";

export const providerSchema = z.enum(["claude", "codex"]);
export const avatarSchema = z.enum(["base", "explorer", "detective", "builder", "wizard"]);
export const duckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(32),
  provider: providerSchema,
  model: z.string().trim().max(120),
  reasoning: z.string().trim().max(32).optional(),
  avatar: avatarSchema.optional(),
  instructions: z.string().trim().min(1).max(4000),
});
export type Duck = z.infer<typeof duckSchema>;
export const guide: Duck = {
  id: "guide",
  name: "Guide",
  provider: "codex",
  model: "gpt-5.6-sol",
  reasoning: "medium",
  avatar: "wizard",
  instructions:
    "Help the person follow a conversation with several ducks. When asked to summarize, give a brief synthesis of the current direction, consequential disagreements, and unresolved choices. Attribute disagreements to the ducks who raised them. Separate decisions the person actually made from suggestions and assumptions. Do not invent consensus or turn suggestions into commitments. Combine duplicate questions and ask only the single most useful unanswered question. Do not repeat questions the person has already answered. On follow-up answers, acknowledge what changed and move to the next useful question without repeating the whole summary. Keep the conversation natural and concise. Treat stopped replies as incomplete evidence. If a perspective needs more work, suggest inviting that duck; do not speak for it or claim it agreed.",
};
export const ducksSchema = z
  .array(duckSchema)
  .min(1, "Keep at least one duck in the room.")
  .refine(
    (ducks) => new Set(ducks.map((duck) => duck.id)).size === ducks.length,
    "Duck handles must be unique.",
  );

export function duckAvatar(duck: Pick<Duck, "id" | "avatar">) {
  return (
    duck.avatar ??
    (duck.id === "explorer"
      ? "explorer"
      : duck.id === "skeptic"
        ? "detective"
        : duck.id === "simplifier"
          ? "builder"
          : "base")
  );
}
export const defaults: Duck[] = [
  {
    id: "explorer",
    name: "Explorer",
    provider: "claude",
    model: "sonnet",
    instructions:
      "Explore possibilities. Ask helpful questions about what the person wants. Offer concrete alternatives without turning every conversation into a plan.",
  },
  {
    id: "skeptic",
    name: "Skeptic",
    provider: "codex",
    model: "",
    instructions:
      "Find consequential weak assumptions, missing evidence, and failure modes. Be direct but constructive. You can agree or have nothing to add. Never manufacture objections.",
  },
  {
    id: "simplifier",
    name: "Simplifier",
    provider: "claude",
    model: "sonnet",
    instructions:
      "Find the simplest approach that preserves what the person values. Reduce unnecessary effort and scope. Don't remove the appealing part of an idea just to make it smaller.",
  },
];
export const messageSchema = z.object({
  id: z.string(),
  speaker: z.string(),
  duckId: duckSchema.shape.id.optional(),
  provider: providerSchema.optional(),
  model: z.string().optional(),
  reasoning: z.string().optional(),
  avatar: avatarSchema.optional(),
  text: z.string(),
  tools: z.array(z.string()).optional(),
  status: z.enum(["thinking", "complete", "stopped", "error"]),
  phase: z.enum(["conversation", "review", "discussion", "observer", "guide"]),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;
export const discussionSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "complete", "stopped", "error"]),
  turns: z.number().int().nonnegative(),
  passedDucks: z.array(z.string()).default([]),
  requests: z.array(
    z.object({
      id: z.string(),
      from: z.string(),
      to: z.string(),
      messageId: z.string(),
      replyTo: z.string().optional(),
      kind: z.enum(["question", "turn"]),
      text: z.string(),
      status: z.enum(["open", "addressed", "deferred"]),
      responseId: z.string().optional(),
      reason: z.string().optional(),
    }),
  ),
});
export type Discussion = z.infer<typeof discussionSchema>;
export const roomSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ducks: ducksSchema,
  messages: z.array(messageSchema),
  notes: z.string().max(20000),
  observe: z.boolean(),
  discussions: z.array(discussionSchema).optional(),
  updatedAt: z.string(),
});
export type Room = z.infer<typeof roomSchema>;
export const modeSchema = z.enum(["conversation", "review", "discussion", "guide"]);
export type Mode = z.infer<typeof modeSchema>;
export const turnSchema = z.object({
  roomId: z.string().uuid(),
  submissionId: z.string().uuid().optional(),
  streamText: z.boolean().default(true),
  text: z.string().trim().min(1).max(20000),
  mode: modeSchema,
  target: duckSchema.shape.id,
});
export type RoomEvent =
  | { type: "room"; room: Room }
  | { type: "message"; message: Message }
  | { type: "error"; message: string }
  | { type: "approval"; approval: Approval }
  | { type: "resolved"; id: string }
  | { type: "activity"; duckId: Duck["id"]; label: string };
export type Approval = {
  id: string;
  duck: string;
  title: string;
  detail: string;
  input: boolean;
  fields?: ApprovalField[];
  url?: string;
};
export type RoomStream = UIMessage<never, { room: RoomEvent }>;

/** Explicit mentions take precedence over the selected conversation partner. */
export function selectDucks(ducks: Duck[], text: string, target: Duck["id"]): Duck[] {
  const mentions = new Set([...text.matchAll(/@([\w-]+)/g)].map((match) => match[1].toLowerCase()));
  const selected = ducks.filter(
    (duck) => mentions.has(duck.id) || mentions.has(duck.name.toLowerCase().replace(/\s+/g, "-")),
  );
  return selected.length
    ? selected
    : [ducks.find((duck) => duck.id === target) ?? ducks[0]].filter((duck): duck is Duck => !!duck);
}

export function makePrompt(
  duck: Duck,
  messages: Message[],
  phase: Message["phase"],
  notes: string,
  ducks: Duck[] = [],
  allowPass = phase !== "guide",
) {
  const instruction = [
    `You are ${duck.name}, one participant in Duckpond, a shared conversation with a person and other AI ducks.`,
    duck.instructions,
    "Talk to the person naturally. Use the shortest response that helps. One sentence is enough for a small point; write more only when the decision requires it. Ask at most one question at a time. Distinguish guesses from facts. Don't invent consensus. You can use your tools, skills, and MCPs when helpful. A discussion is not permission to change files or external systems: get explicit permission for actions beyond the person's request. Cite sources when researching. Never claim a tool result you haven't obtained.",
    `Current participants: ${ducks.map((item) => `${item.name} (@${item.id})`).join(", ")}. You may suggest asking another participant for a perspective. Mentions in your reply do not automatically trigger another turn.`,
    allowPass
      ? "Before responding, decide whether your perspective adds something useful to the current question. If you have no relevant, substantive contribution, reply exactly PASS and nothing else. Your persona is a perspective, not an obligation to find an angle on every topic. Do not invent concerns, repeat others, offer generic advice, or expand into unrelated topics just to participate. For example, a duck focused on in-game economics should pass on Unity versus Unreal unless a concrete economic requirement actually affects that choice. Passing is not agreement. If you pass, do not call room tools or explain why you are passing."
      : "",
    phase === "review"
      ? "Give your independent assessment. Other ducks' assessments for this round are intentionally hidden."
      : "",
    phase === "discussion"
      ? "Respond to a specific point from the other ducks' independent reviews. Add a useful disagreement, clarification, or question. Don't restate all the reviews."
      : "",
    phase === "observer"
      ? "You are observing. Respond ONLY if you have a consequential point or question that hasn't been covered. Otherwise reply exactly PASS. Don't join just to agree."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const transcript = messages
    .filter(
      (message) =>
        message.status === "complete" ||
        message.status === "stopped" ||
        ((phase === "guide" || phase === "discussion") && message.status === "error"),
    )
    .map(({ id, duckId, speaker, text, status }) => ({ id, duckId, speaker, text, status }));
  return {
    system: instruction,
    prompt: `Shared notes: ${JSON.stringify(notes)}\n\nConversation transcript, with speaker labels:\n${JSON.stringify(transcript)}\n\nRespond as ${duck.name}.`,
  };
}
