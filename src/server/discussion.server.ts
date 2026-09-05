import { z } from "zod";
import {
  guide,
  makePrompt,
  type Action,
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
  instructions: `Read the person's latest message first. Answer process clarifications yourself using finish_discussion; do not launch a panel for a clarification. For substantive new questions, use start_review to collect independent assessments from relevant ducks, usually several when their different perspectives help. For already approved work, use assign_action to give a named owner a concrete deliverable and run it now. Cite the human message granting permission, reading short approvals with the preceding proposal. Do not ask for that permission again, turn proposed work into approved work, or claim future work is done. Recover unfinished actions from earlier turns. An owner must report results or a concrete blocker using report_action. Inspect the result, evidence, and tool activity before accepting it with review_action. A promise, plan, PASS, or request for redundant permission is not a deliverable. Reject inadequate reports and give the owner a focused correction. Do not demand tools for a deliverable that can be provided directly in chat. For file changes or research, require actual file paths or source links and inspect them with your native tools as needed. Respect unresolved blockers and the person's changed scope; do not repeatedly retry blocked work without new information. After independent assessments, identify the most consequential disagreement and give one duck the floor to address a specific peer's argument or question. Invite rebuttals, test revised proposals, and ask whether objections have actually been answered. Participants may challenge your framing. Don't manufacture disagreement, force consensus, or silently skip open requests. An addressed request has received a response, not necessarily a satisfactory resolution. Read the response before deciding whether a follow-up is needed. Let ducks speak for themselves. Invite only ducks whose expertise is relevant to the specific question. Do not poll everyone for equal participation. passedDucks records ducks that declined to contribute; passing means no useful input, not agreement. Do not invite a duck that passed again unless a new, specifically relevant issue needs its expertise. Avoid repeatedly favoring one duck. Stop when further discussion adds little or the person's preferences are needed. Use one scheduling tool exactly once per invocation, then end your turn. Your ordinary text is internal coordination; the finish_discussion tool supplies the result shown to the person. Preserve minority views and failed or stopped replies. Finish with at most one question for the person. Never use native subagent tools to impersonate or run the room's ducks. The app runs them with their own provider and model.`,
};
const text = z.string().trim().min(1).max(4000);
const askSchema = z.object({ duckId: z.string(), question: text, replyTo: z.string().optional() });
const requestSchema = z.object({ reason: text, replyTo: z.string().optional() });
const floorSchema = z.object({
  duckId: z.string(),
  prompt: text,
  requestIds: z
    .array(z.string())
    .describe(
      "IDs from the open shared requests queue addressed to this duck. Use [] for an unsolicited follow-up. Never use transcript message IDs or the discussion ID.",
    ),
});
const finishSchema = z.object({
  summary: text,
  disagreements: z.array(text),
  question: z.string().max(2000),
  deferred: z.array(z.object({ requestId: z.string(), reason: text })),
});
const reviewSchema = z.object({ duckIds: z.array(z.string()).min(1), prompt: text });
const assignSchema = z.object({
  duckId: z.string(),
  task: text,
  deliverable: text,
  authorizationId: z.string(),
  actionId: z.string().optional(),
});
const reportSchema = z.object({
  actionId: z.string(),
  status: z.enum(["reported", "blocked"]),
  result: text,
  evidence: z.array(text),
});
const acceptSchema = z.object({ actionId: z.string(), accepted: z.boolean(), reason: text });
type Decision =
  | { type: "review"; value: z.infer<typeof reviewSchema> }
  | { type: "assign"; value: z.infer<typeof assignSchema> }
  | { type: "accept"; value: z.infer<typeof acceptSchema> }
  | { type: "floor"; value: z.infer<typeof floorSchema> }
  | { type: "finish"; value: z.infer<typeof finishSchema> };

export const participantInstructions = `You are in a mediated discussion. During the initial review, assess relevance before forming an opinion. Unless you have an assigned action, PASS is a valid response in both initial reviews and follow-ups; do not manufacture a contribution just because you were given the floor. In later turns, address the assigned question and the other ducks directly; explain whether their arguments change your view. Use ask_duck to queue a specific question for a peer and request_turn to flag a concern you want to discuss. Include important arguments in your published reply so everyone can see them. Tool requests join a shared queue; they do not immediately launch or wait for another duck. Plain @mentions alone do not schedule replies. You cannot give_floor or finish_discussion. Do not use native subagent tools to contact or impersonate room participants. Mediator handles their speaking order. If assigned an action, execute the authorized task in this turn using your native tools when needed. Report the actual deliverable and evidence with report_action, or report a specific blocker with what is needed to proceed. Include that result in your published reply. Do not substitute a promise, offer, or repeated permission question for execution. You may pass on opinions, but an assigned action requires a result or an honest blocker.`;

/** Requests are persisted alongside the transcript; tool calls never start another provider. */
export function createDiscussion(room: Room, id: string, signal: AbortSignal, save: () => void) {
  const state: Discussion = { id, status: "running", turns: 0, passedDucks: [], requests: [] };
  room.discussions ??= [];
  room.discussions.push(state);
  let reviewed = false;
  let activeAction: Action | undefined;
  room.actions ??= [];
  // A process restart can leave a worker marked running. It must be reassigned, not completed.
  for (const action of room.actions) if (action.status === "running") action.status = "pending";
  function findAction(id: string) {
    const action = room.actions!.find((item) => item.id === id);
    if (!action) throw new Error("Unknown action ID.");
    return action;
  }
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
          name: "report_action",
          description:
            "Report the assigned deliverable with concrete evidence, or a specific blocker. Completion requires Mediator review after your reply finishes.",
          inputSchema: reportSchema,
        },
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
        if (name === "report_action") {
          const value = reportSchema.parse(input);
          const action = findAction(value.actionId);
          if (action !== activeAction || action.owner !== duck.id || action.status !== "running")
            throw new Error("You may report only your currently assigned action, once.");
          if (value.status === "reported" && !value.evidence.length)
            throw new Error(
              "Provide evidence: the actual in-chat deliverable, source URLs, file paths, or observed check results.",
            );
          Object.assign(action, {
            status: value.status,
            result: value.result,
            evidence: value.evidence,
            responseId: message.id,
          });
          save();
          return {
            recorded: true,
            note: "Publish the result in your reply. Mediator reviews completion after your turn ends.",
          };
        }
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
    return `Shared room requests, with speaker and response message IDs:\n${JSON.stringify(state)}\nFollow-up turns remaining: ${discussionTurnLimit - state.turns}.\nIndependent review already started: ${reviewed}.\nPersisted actions, including prior turns:\n${JSON.stringify(room.actions)}`;
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
    const actions = room.actions!.filter((action) => action.status !== "complete");
    const outstanding = actions.length
      ? `\n\nUnfinished work:\n${actions.map((action) => `- @${action.owner}: ${action.task} [${action.status}]${action.result ? `: ${action.result}` : ""}`).join("\n")}`
      : "";
    return (
      outstanding +
      (remaining.length
        ? `\n\nStill open:\n${remaining.map((item) => `- @${item.from} → @${item.to}: ${item.text}${item.reason ? ` (${item.reason})` : ""}`).join("\n")}`
        : "")
    );
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
        let rejection = "";
        const tools: RoomTools = {
          definitions: [
            {
              name: "start_review",
              description:
                "Collect independent assessments from selected relevant ducks, once per discussion. Skip this for clarification or execution of already approved work.",
              inputSchema: reviewSchema,
            },
            {
              name: "assign_action",
              description:
                "Run an approved task now with one owner and a concrete deliverable. Reference the authorizing human message. Supply actionId to resume an existing unfinished task without duplicating it.",
              inputSchema: assignSchema,
            },
            {
              name: "review_action",
              description:
                "Accept or reject a finished owner's report after checking its deliverable and evidence. Rejected reports become pending for correction. A promise is not a result.",
              inputSchema: acceptSchema,
            },
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
            if (name === "start_review") {
              const value = reviewSchema.parse(input);
              if (reviewed || state.turns > 0)
                throw new Error("Initial review is available only once, before follow-ups.");
              for (const id of value.duckIds) participant(id);
              if (new Set(value.duckIds).size !== value.duckIds.length)
                throw new Error("Select each duck once.");
              decision.value = { type: "review", value };
            } else if (name === "assign_action") {
              const value = assignSchema.parse(input);
              participant(value.duckId);
              if (state.turns >= discussionTurnLimit)
                throw new Error(
                  "The discussion budget is exhausted. Finish and disclose unfinished work.",
                );
              const authorization = room.messages.find(
                (message) => message.id === value.authorizationId,
              );
              if (!authorization || authorization.duckId || authorization.speaker !== "You")
                throw new Error(
                  "authorizationId must reference the human message approving this scope, not a duck's suggestion.",
                );
              if (
                value.actionId &&
                !["pending", "blocked"].includes(findAction(value.actionId).status)
              )
                throw new Error("Resume only pending or blocked actions.");
              decision.value = { type: "assign", value };
            } else if (name === "review_action") {
              const value = acceptSchema.parse(input);
              const action = findAction(value.actionId);
              const response = room.messages.find((message) => message.id === action.responseId);
              if (
                action.status !== "reported" ||
                response?.status !== "complete" ||
                !action.evidence?.length
              )
                throw new Error(
                  "Only a completed owner's reply with a reported result and evidence can be reviewed.",
                );
              decision.value = { type: "accept", value };
            } else if (name === "give_floor") {
              const value = floorSchema.parse(input);
              participant(value.duckId);
              if (state.turns >= discussionTurnLimit)
                throw new Error(
                  "The discussion budget is exhausted. Use finish_discussion and disclose unresolved points.",
                );
              for (const id of value.requestIds) {
                const request = openRequests().find((item) => item.id === id);
                if (!request || request.to !== value.duckId)
                  throw new Error(
                    `Assign only open requests addressed to the selected duck. Valid requestIds for @${value.duckId}: ${JSON.stringify(
                      openRequests()
                        .filter((item) => item.to === value.duckId)
                        .map((item) => item.id),
                    )}. Use [] if none apply. These are queue IDs, not message IDs or the discussion ID.`,
                  );
              }
              decision.value = { type: "floor", value };
            } else if (name === "finish_discussion") {
              const value = finishSchema.parse(input);
              if (
                room.actions!.some(
                  (action) =>
                    action.status === "reported" ||
                    action.status === "running" ||
                    (action.status === "pending" && state.turns < discussionTurnLimit),
                )
              )
                throw new Error(
                  "Approved work remains. Assign pending actions and review reported results before finishing. Blockers and budget-exhausted work remain visible.",
                );
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
        const observedTools: RoomTools = {
          ...tools,
          call(name, input) {
            try {
              return tools.call(name, input);
            } catch (error) {
              rejection = `${name} rejected: ${error instanceof Error ? error.message : "Invalid scheduling decision"}`;
              throw error;
            }
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
              `${prompt}\n\n${context()}\n\nCall one of the scheduling tools now. Use start_review for independent opinions, assign_action for approved work, review_action to check a reported result, give_floor for a peer response, or finish_discussion for the final answer. Plain text does not schedule a speaker or finish the room.${correction}`,
              signal,
              () => {},
              emit,
              observedTools,
            );
            correction = `\nYour previous invocation ended without a valid room-tool decision. ${rejection || "No scheduling tool was called."} Correct this by calling one of the provided scheduling tools. Read the tool result directly; do not assume it has an MCP content array.`;
          }
        } finally {
          accepting = false;
        }
        signal.throwIfAborted();
        // Tool callbacks select the action; no participant is launched inside the callback.
        const action = decision.value;
        if (!action)
          throw new Error(
            `Mediator ended without choosing a speaker or finishing the discussion.${rejection ? ` ${rejection}` : ""}`,
          );
        if (action.type === "review") {
          reviewed = true;
          publish(action.value.prompt, "discussion");
          const history = structuredClone(room.messages);
          await Promise.all(
            action.value.duckIds.map((id) => speak(participant(id), history, "review")),
          );
          continue;
        }
        if (action.type === "accept") {
          const item = findAction(action.value.actionId);
          item.status = action.value.accepted ? "complete" : "pending";
          item.review = action.value.reason;
          publish(
            `${action.value.accepted ? "Completed" : "Needs correction"}: @${item.owner}, ${item.task}. ${item.review}`,
            "discussion",
          );
          continue;
        }
        if (action.type === "assign") {
          const { duckId, task, deliverable, authorizationId, actionId } = action.value;
          const item: Action = actionId
            ? findAction(actionId)
            : {
                id: crypto.randomUUID(),
                owner: duckId,
                task,
                deliverable,
                authorizationId,
                status: "pending",
              };
          if (!actionId) room.actions!.push(item);
          Object.assign(item, {
            owner: duckId,
            task,
            deliverable,
            authorizationId,
            status: "running",
            responseId: undefined,
            result: undefined,
            evidence: undefined,
          });
          activeAction = item;
          state.turns++;
          publish(
            `@${duckId}: ${task}\n\nDeliverable: ${deliverable}\nAction ID: ${item.id}\nDo the approved work now and report the result or a concrete blocker with report_action.`,
            "discussion",
          );
          try {
            const response = await speak(
              participant(duckId),
              structuredClone(room.messages),
              "discussion",
            );
            if (response?.status !== "complete" || item.status === "running") {
              item.status = response?.status === "complete" ? "pending" : "blocked";
              item.result =
                response?.status === "complete"
                  ? "Owner ended without reporting a deliverable or blocker."
                  : "Owner did not finish the assigned work.";
            }
          } finally {
            if (signal.aborted) {
              item.status = "pending";
              item.result = "Interrupted. Inspect any partial work before resuming.";
            }
            activeAction = undefined;
            save();
          }
          continue;
        }
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
  function assignedTo(duckId: string) {
    return activeAction?.owner === duckId;
  }
  return { state, participantTools, context, moderate, assignedTo };
}
