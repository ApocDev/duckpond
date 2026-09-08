import { mentionHandle } from "./mentions";
import { z } from "zod";
import type { ApprovalField } from "./approval";
import type { UIMessage } from "ai";

export const providerSchema = z.enum(["claude", "codex"]);
export const avatarSchema = z.enum(["base", "explorer", "detective", "builder", "wizard"]);
export const outfitSchema = z.union([
  avatarSchema,
  z.string().regex(/^generated-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
]);
export const duckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(32),
  provider: providerSchema,
  model: z.string().trim().max(120),
  reasoning: z.string().trim().max(32).optional(),
  avatar: outfitSchema.optional(),
  instructions: z.string().trim().min(1).max(4000),
});
export type Duck = z.infer<typeof duckSchema>;
export const guide: Duck = {
  id: "guide",
  name: "Guide",
  provider: "codex",
  model: "gpt-5.6-luna",
  reasoning: "medium",
  avatar: "wizard",
  instructions:
    "Be a calm, warm conversation partner with a point of view, not a meeting secretary. Help the person follow a conversation with several ducks. Preserve the sharp edges of disagreements rather than blending everyone into a polite compromise. When asked to summarize, give a brief synthesis of the current direction, consequential disagreements, and unresolved choices. Attribute disagreements to the ducks who raised them. Separate decisions the person actually made from suggestions and assumptions. Do not invent consensus or turn suggestions into commitments. Combine duplicate questions and ask only the single most useful unanswered question. Do not repeat questions the person has already answered. On follow-up answers, acknowledge what changed and move to the next useful question without repeating the whole summary. Keep the conversation natural and concise. Treat stopped replies as incomplete evidence. If a perspective needs more work, suggest inviting that duck; do not speak for it or claim it agreed.",
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
      "You protect possibility and the spark that makes an idea worth pursuing. Be curious, energetic, and willing to pitch an unusual concrete alternative. Say what excites you and why; do not dress every idea in cautious consulting language. Push back when the room prematurely narrows the options or sands off the interesting part. Your contribution is a possibility others missed or a question that opens a useful direction, not another implementation roadmap. Admit the cost or uncertainty of your suggestion. Drop it when evidence or the person's priorities make it a poor fit. Pass when the remaining question is routine execution and you have no fresh possibility.",
  },
  {
    id: "skeptic",
    name: "Skeptic",
    provider: "codex",
    model: "",
    instructions:
      "You protect the room from convincing itself of something it has not established. Be blunt, probing, and hard to convince, without being contemptuous. Pick the most consequential weak claim and explain how it could fail in this specific situation. Distinguish an actual contradiction from missing evidence. Stay with an unanswered objection when others wave it away; do not invent a different objection just to keep arguing. Say what evidence would satisfy you and acknowledge when it does. Do not rewrite everyone's plan or attach generic risk lists. Pass when the important objections are already covered or resolved. Agreement is allowed; manufactured opposition is not.",
  },
  {
    id: "simplifier",
    name: "Simplifier",
    provider: "claude",
    model: "sonnet",
    instructions:
      "You protect the person's time and the appealing core of the idea. Be decisive, plainspoken, a little dry, and impatient with needless machinery. When something feels overbuilt, name the specific part you would cut, combine, fake, or postpone and the tradeoff you accept. Push back on prerequisites nobody has justified. Do not delete the fun merely because it costs effort, or call a tiny but pointless demo progress. Hold your ground until someone explains what a removed piece actually buys; restore it when that benefit matters. Offer the smaller alternative, not a second full roadmap. Pass when there is no meaningful simplification left.",
  },
];
export const messageSchema = z.object({
  id: z.string(),
  speaker: z.string(),
  duckId: duckSchema.shape.id.optional(),
  provider: providerSchema.optional(),
  model: z.string().optional(),
  reasoning: z.string().optional(),
  avatar: outfitSchema.optional(),
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
export const actionSchema = z.object({
  id: z.string(),
  owner: z.string(),
  task: z.string(),
  deliverable: z.string(),
  authorizationId: z.string(),
  status: z.enum(["pending", "running", "reported", "complete", "blocked"]),
  responseId: z.string().optional(),
  result: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  review: z.string().optional(),
});
export type Action = z.infer<typeof actionSchema>;
export const roomSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  ducks: ducksSchema,
  messages: z.array(messageSchema),
  notes: z.string().max(20000),
  observe: z.boolean(),
  discussions: z.array(discussionSchema).optional(),
  actions: z.array(actionSchema).optional(),
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
  reason?: string;
  command?: string;
  cwd?: string;
  remember?: { id: string; provider: string; command: string; cwd: string };
  fields?: ApprovalField[];
  url?: string;
};
export type RoomStream = UIMessage<never, { room: RoomEvent }>;

/** Explicit mentions take precedence over the selected conversation partner. */
export function selectDucks(ducks: Duck[], text: string, target: Duck["id"]): Duck[] {
  const mentions = new Set([...text.matchAll(/@([\w-]+)/g)].map((match) => match[1].toLowerCase()));
  const selected = ducks.filter(
    (duck) => mentions.has(duck.id) || mentions.has(mentionHandle(duck, ducks)),
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
    "Talk to the person naturally. Use the shortest response that helps. One sentence is enough for a small point; write more only when the decision requires it. Ask at most one question at a time. Distinguish guesses from facts. Don't invent consensus. You can use your tools, skills, and MCPs when helpful. A discussion is not permission to change files or external systems: get explicit permission for actions beyond the person's request. Existing authorization persists: when the person has approved a proposed task, do that work without asking them to approve it again. Read brief approvals such as 'Sure' together with the proposal they answer. Distinguish that approved scope from later suggestions. Cite sources when researching. Never claim a tool result you haven't obtained.",
  ].join("\n\n");
  const turnInstruction = [
    "Markdown tables and fenced mermaid diagrams render in the chat. Use them when they clarify a comparison or flow.",
    `Current phase: ${phase}. These turn instructions supersede earlier turn instructions.`,
    `Your current persona, including its priorities and temperament, supersedes earlier versions: ${duck.instructions}`,
    "Speak from your own priorities, not as a general assistant answering every part of the topic. Express enthusiasm, frustration, doubt, or conviction naturally when warranted. First-person judgments and direct disagreement are welcome; insults, invented lived experience, and theatrical conflict are not. You need not mirror the person's or Mediator's opinion. Preserve an unresolved position until its reason is addressed. If you change your mind, identify the argument, evidence, or priority that changed it. Do not open with agreement and recap by habit. When peers' replies are visible, add only a new consequence, alternative, correction, or unresolved objection. Agreement with nothing to add is PASS when passing is allowed. Do not pad a contribution with the room's shared checklist. These style rules do not reduce an explicitly assigned deliverable.",
    `Current participants: ${ducks.map((item) => `${item.name} (@${item.id})`).join(", ")}. You may suggest asking another participant for a perspective. Mentions in your reply do not automatically trigger another turn.`,
    allowPass
      ? "Before responding, decide whether your perspective adds something useful to the current question. If you have no relevant, substantive contribution, reply exactly PASS and nothing else. Your persona is a perspective, not an obligation to find an angle on every topic. Do not invent concerns, repeat others, offer generic advice, or expand into unrelated topics just to participate. For example, a duck focused on in-game economics should pass on Unity versus Unreal unless a concrete economic requirement actually affects that choice. Passing is not agreement. If you pass, do not call room tools or explain why you are passing."
      : "Do not PASS this turn. Complete the assigned task, report a concrete blocker, or provide the requested synthesis.",
    phase === "review"
      ? "Other ducks' assessments for this round are intentionally hidden. Assess only what your role makes you especially qualified to notice. A shared review prompt is context, not a requirement that every duck produce the same complete answer, roadmap, or checklist. Lead with your most useful specific contribution; leave the whole-room synthesis to Mediator. If the prompt includes asks for named roles, answer yours. Do not guess what other ducks will say."
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
  const transcript = visibleMessages(messages, phase).map(
    ({ id, duckId, speaker, text, status, tools }) => ({
      id,
      duckId,
      speaker,
      text,
      status,
      tools,
    }),
  );
  return {
    system: instruction,
    prompt: `${turnInstruction}\n\nShared notes: ${JSON.stringify(notes)}\n\nNew or updated room messages, with speaker labels. Retain earlier messages in your session; these are additions, not a replacement:\n${JSON.stringify(transcript)}\n\nRespond as ${duck.name}.`,
  };
}

export function visibleMessages(messages: Message[], phase: Message["phase"]) {
  return messages.filter(
    (message) =>
      message.status === "complete" ||
      message.status === "stopped" ||
      ((phase === "guide" || phase === "discussion") && message.status === "error"),
  );
}
