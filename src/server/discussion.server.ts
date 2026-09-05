import { z } from "zod";
import {
  guide,
  makePrompt,
  type Discussion,
  type Duck,
  type Message,
  type Room,
  type RoomEvent,
} from "../lib/room";
import type { reply } from "./providers.server";
import type { RoomTools } from "./room-tools.server";

export const discussionTurnLimit = 8;
export const mediator: Duck = {
  ...guide,
  id: "mediator",
  name: "Mediator",
  instructions: `Run the discussion, not a poll of opinions. After the independent assessments, identify the most consequential disagreement and give one duck the floor to address a specific peer's argument or question. Invite rebuttals, test revised proposals, and ask whether objections have actually been answered. Participants may challenge your framing. Don't manufacture disagreement, force consensus, or silently skip open requests. An addressed request has received a response, not necessarily a satisfactory resolution. Read the response before deciding whether a follow-up is needed. Let ducks speak for themselves. Invite only ducks whose expertise is relevant to the specific question. Do not poll everyone for equal participation. passedDucks records ducks that declined to contribute; passing means no useful input, not agreement. Do not invite a duck that passed again unless a new, specifically relevant issue needs its expertise. Avoid repeatedly favoring one duck. Stop when further discussion adds little or the person's preferences are needed. Use give_floor or finish_discussion exactly once per invocation, then end your turn. Your ordinary text is internal coordination; the finish_discussion tool supplies the result shown to the person. Preserve minority views and failed or stopped replies. Finish with at most one question for the person. Never use native subagent tools to impersonate or run the room's ducks. The app runs them with their own provider and model.`,
};
const text = z.string().trim().min(1).max(4000);
const askSchema = z.object({ duckId: z.string(), question: text, replyTo: z.string().optional() });
const requestSchema = z.object({ reason: text, replyTo: z.string().optional() });
const floorSchema = z.object({ duckId: z.string(), prompt: text, requestIds: z.array(z.string()) });
const finishSchema = z.object({
  summary: text,
  disagreements: z.array(text),
  question: z.string().max(2000),
  deferred: z.array(z.object({ requestId: z.string(), reason: text })),
});
type Decision =
  | { type: "floor"; value: z.infer<typeof floorSchema> }
  | { type: "finish"; value: z.infer<typeof finishSchema> };

export const participantInstructions = `You are in a mediated discussion. During the initial review, assess relevance before forming an opinion. PASS is a valid response in both initial reviews and follow-ups; do not manufacture a contribution just because you were given the floor. In later turns, address the assigned question and the other ducks directly; explain whether their arguments change your view. Use ask_duck to queue a specific question for a peer and request_turn to flag a concern you want to discuss. Include important arguments in your published reply so everyone can see them. Tool requests join a shared queue; they do not immediately launch or wait for another duck. Plain @mentions alone do not schedule replies. You cannot give_floor or finish_discussion. Do not use native subagent tools to contact or impersonate room participants. Mediator handles their speaking order.`;

/** Requests are persisted alongside the transcript; tool calls never start another provider. */
export function createDiscussion(room: Room, id: string, signal: AbortSignal, save: () => void) {
  const state: Discussion = { id, status: "running", turns: 0, passedDucks: [], requests: [] };
  room.discussions ??= [];
  room.discussions.push(state);
  function participant(id: string) {
    const duck = room.ducks.find((item) => item.id === id);
    if (!duck) throw new Error(`Unknown duck: ${id}. Use a current participant's handle.`);
    return duck;
  }
  function checkActive() {
    signal.throwIfAborted();
    if (state.status !== "running") throw new Error("This discussion has ended.");
  }
  function participantTools(duck: Duck, message: Message): RoomTools {
    return {
      definitions: [
        {
          name: "ask_duck",
          description:
            "Queue a question for another room duck. The Mediator schedules its answer. replyTo optionally identifies a transcript message.",
          inputSchema: askSchema,
        },
        {
          name: "request_turn",
          description:
            "Ask the Mediator for a later turn to raise an objection or follow-up. Does not interrupt the current speaker.",
          inputSchema: requestSchema,
        },
      ],
      call(name, input) {
        checkActive();
        if (message.status !== "thinking") throw new Error("Your speaking turn has ended.");
        const parsed =
          name === "ask_duck"
            ? askSchema.parse(input)
            : name === "request_turn"
              ? requestSchema.parse(input)
              : null;
        if (!parsed) throw new Error("Only the Mediator can control the floor.");
        const to = "duckId" in parsed ? participant(parsed.duckId).id : duck.id;
        if (name === "ask_duck" && to === duck.id)
          throw new Error("Ask another duck, or use request_turn.");
        if (parsed.replyTo && !room.messages.some((item) => item.id === parsed.replyTo))
          throw new Error("replyTo must identify a message in this room.");
        const request: Discussion["requests"][number] = {
          id: crypto.randomUUID(),
          from: duck.id,
          to,
          messageId: message.id,
          replyTo: parsed.replyTo,
          kind: name === "ask_duck" ? "question" : "turn",
          text: "question" in parsed ? parsed.question : parsed.reason,
          status: "open",
        };
        const duplicate = state.requests.find(
          (item) => item.messageId === message.id && item.to === to && item.text === request.text,
        );
        if (duplicate) return duplicate;
        state.requests.push(request);
        save();
        return {
          ...request,
          note: "Queued. End your response; the Mediator will schedule the next speaker.",
        };
      },
    };
  }
  function context() {
    return `Shared room requests, with speaker and response message IDs:\n${JSON.stringify(state)}\nFollow-up turns remaining: ${discussionTurnLimit - state.turns}.`;
  }
  function publish(text: string, phase: Message["phase"], status: Message["status"] = "complete") {
    const message: Message = {
      id: crypto.randomUUID(),
      speaker: mediator.name,
      duckId: mediator.id,
      provider: mediator.provider,
      model: mediator.model,
      reasoning: mediator.reasoning,
      avatar: mediator.avatar,
      text,
      phase,
      status,
      createdAt: new Date().toISOString(),
    };
    room.messages.push(message);
    save();
  }
  function openRequests() {
    return state.requests.filter((item) => item.status === "open");
  }
  function unanswered() {
    const remaining = state.requests.filter((item) => item.status !== "addressed");
    return remaining.length
      ? `\n\nStill open:\n${remaining.map((item) => `- @${item.from} → @${item.to}: ${item.text}${item.reason ? ` (${item.reason})` : ""}`).join("\n")}`
      : "";
  }
  async function moderate(
    run: typeof reply,
    speak: (
      duck: Duck,
      history: Message[],
      phase: Message["phase"],
    ) => Promise<Message | undefined>,
    emit: (event: RoomEvent) => void,
  ) {
    try {
      while (!signal.aborted && state.status === "running") {
        const decision: { value?: Decision } = {};
        let accepting = true;
        const tools: RoomTools = {
          definitions: [
            {
              name: "give_floor",
              description:
                "Assign exactly one duck a focused response. Include the open request IDs it must address. Available only while follow-up turns remain.",
              inputSchema: floorSchema,
            },
            {
              name: "finish_discussion",
              description:
                "Publish the recommendation, disagreements, and at most one question for the person. Every remaining open request must be explicitly deferred with a reason.",
              inputSchema: finishSchema,
            },
          ],
          call(name, input) {
            checkActive();
            if (!accepting || decision.value)
              throw new Error("One scheduling decision per invocation. End your turn now.");
            if (name === "give_floor") {
              const value = floorSchema.parse(input);
              participant(value.duckId);
              if (state.turns >= discussionTurnLimit)
                throw new Error(
                  "The discussion budget is exhausted. Use finish_discussion and disclose unresolved points.",
                );
              for (const id of value.requestIds) {
                const request = openRequests().find((item) => item.id === id);
                if (!request || request.to !== value.duckId)
                  throw new Error("Assign only open requests addressed to the selected duck.");
              }
              decision.value = { type: "floor", value };
            } else if (name === "finish_discussion") {
              const value = finishSchema.parse(input);
              const open = openRequests();
              if (
                value.deferred.length !== open.length ||
                new Set(value.deferred.map((item) => item.requestId)).size !== open.length ||
                open.some((item) => !value.deferred.some((entry) => entry.requestId === item.id))
              )
                throw new Error(
                  `Account for every open request in deferred: ${JSON.stringify(open)}`,
                );
              decision.value = { type: "finish", value };
            } else throw new Error("Unknown Mediator tool.");
            return {
              accepted: true,
              note: "Decision queued. End this invocation so the app can execute it.",
            };
          },
        };
        const { system, prompt } = makePrompt(
          mediator,
          room.messages,
          "discussion",
          room.notes,
          room.ducks,
          false,
        );
        try {
          let correction = "";
          for (let attempt = 0; attempt < 2 && !decision.value; attempt++) {
            signal.throwIfAborted();
            await run(
              mediator,
              system,
              `${prompt}\n\n${context()}\n\nCall give_floor or finish_discussion now. Plain text does not schedule a speaker or finish the room.${correction}`,
              signal,
              () => {},
              emit,
              tools,
            );
            correction =
              "\nYour previous invocation ended without a valid room-tool decision. Correct this by calling one of the provided scheduling tools.";
          }
        } finally {
          accepting = false;
        }
        signal.throwIfAborted();
        // Tool callbacks select the action; no participant is launched inside the callback.
        const action = decision.value;
        if (!action)
          throw new Error("Mediator ended without choosing a speaker or finishing the discussion.");
        if (action.type === "finish") {
          for (const deferred of action.value.deferred) {
            const request = state.requests.find((item) => item.id === deferred.requestId)!;
            request.status = "deferred";
            request.reason = deferred.reason;
          }
          state.status = "complete";
          const { summary, disagreements, question } = action.value;
          publish(
            `${summary}${disagreements.length ? `\n\nRemaining disagreements:\n${disagreements.map((item) => `- ${item}`).join("\n")}` : ""}${unanswered()}${question ? `\n\n${question}` : ""}`,
            "guide",
          );
          return;
        }
        const { duckId, prompt: assignment, requestIds } = action.value;
        state.turns++;
        const requests = state.requests.filter((item) => requestIds.includes(item.id));
        publish(
          `@${duckId}: ${assignment}${requests.length ? `\n\nPlease address:\n${requests.map((item) => `- @${item.from}: ${item.text}`).join("\n")}` : ""}`,
          "discussion",
        );
        const response = await speak(
          participant(duckId),
          structuredClone(room.messages),
          "discussion",
        );
        if (response?.status === "complete") {
          for (const request of requests) {
            request.status = "addressed";
            request.responseId = response.id;
          }
          save();
        }
      }
    } catch (error) {
      state.status = signal.aborted ? "stopped" : "error";
      publish(
        `${signal.aborted ? "Discussion stopped." : `Discussion could not finish: ${error instanceof Error ? error.message : "Mediator failed"}`} Completed replies are saved.${unanswered()}`,
        "guide",
        state.status,
      );
    } finally {
      if (signal.aborted && state.status === "running") state.status = "stopped";
      save();
    }
  }
  return { state, participantTools, context, moderate };
}
