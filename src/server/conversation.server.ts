import {
  makePrompt,
  visibleMessages,
  selectDucks,
  duckAvatar,
  guide,
  type Duck,
  type Approval,
  type Message,
  type Room,
  type RoomEvent,
  type Mode,
} from "../lib/room";
import { reply } from "./providers.server";
import { saveRoom } from "./store.server";
import {
  createDiscussion,
  participantInstructions,
  inactiveParticipantTools,
} from "./discussion.server";

export const liveRooms = new Map<string, { room: Room; approvals: Approval[] }>();
export const activeTurns = new Map<string, AbortController>();
type Runner = typeof reply;

/** Review inputs are frozen before any duck speaks; discussion sees all completed reviews. */
export async function runConversation(
  room: Room,
  text: string,
  mode: Mode,
  target: Duck["id"],
  signal: AbortSignal,
  emit: (event: RoomEvent) => void,
  {
    run = reply,
    persist = saveRoom,
    messageId = crypto.randomUUID(),
    streamText = true,
  }: {
    run?: Runner;
    persist?: (room: Room) => unknown;
    messageId?: string;
    streamText?: boolean;
  } = {},
) {
  function emitRoom() {
    const snapshot = structuredClone(room);
    for (const message of snapshot.messages)
      if (message.status === "thinking" && (!streamText || "PASS".startsWith(message.text.trim())))
        message.text = "";
    emit({ type: "room", room: snapshot });
  }

  room.messages.push({
    id: messageId,
    speaker: "You",
    text,
    status: "complete",
    phase: "conversation",
    createdAt: new Date().toISOString(),
  });
  if (room.messages.length === 1) room.title = text.slice(0, 65);
  persist(room);
  emitRoom();
  const initial = structuredClone(room.messages);
  const discussion =
    mode === "discussion"
      ? createDiscussion(room, messageId, signal, () => {
          persist(room);
          emitRoom();
        })
      : undefined;

  async function speak(duck: Duck, history: Message[], phase: Message["phase"]) {
    if (signal.aborted) return;
    const message: Message = {
      id: crypto.randomUUID(),
      speaker: duck.name,
      duckId: duck.id,
      provider: duck.provider,
      model: duck.model,
      reasoning: duck.reasoning,
      avatar: duckAvatar(duck),
      text: "",
      status: "thinking",
      phase,
      createdAt: new Date().toISOString(),
    };
    room.messages.push(message);
    emit({ type: "message", message: { ...message } });
    try {
      const buildPrompt = (messages: Message[]) => {
        const { prompt } = makePrompt(
          duck,
          messages,
          phase,
          room.notes,
          room.ducks,
          phase !== "guide" && !discussion?.assignedTo(duck.id),
        );
        return `${prompt}\n\nCurrent mode: ${mode}. Your published reply ID: ${message.id}.${
          discussion && phase === "discussion" ? `\n\n${discussion.context()}` : ""
        }${
          mode === "review" && phase === "guide"
            ? "\nSummarize the round that just finished. Give one concise synthesis and at most one next question. If replies failed or stopped, say the review is incomplete."
            : ""
        }`;
      };
      const { system } = makePrompt(duck, [], phase, "");
      const roomTools = discussion?.participantTools(duck, message) ?? inactiveParticipantTools;
      await run(
        duck,
        `${system}\n\n${participantInstructions}`,
        buildPrompt(history),
        signal,
        (delta) => {
          message.text += delta;
          if (streamText && phase !== "observer" && !"PASS".startsWith(message.text.trim()))
            emit({ type: "message", message: { ...message } });
        },
        (event) => {
          if (event.type === "activity") {
            message.tools ??= [];
            if (!message.tools.includes(event.label)) message.tools.push(event.label);
            emit({
              type: "message",
              message: {
                ...message,
                text: streamText && !"PASS".startsWith(message.text.trim()) ? message.text : "",
              },
            });
          }
          emit(event);
        },
        roomTools,
        {
          roomId: room.id,
          messages: visibleMessages(history, phase),
          responseId: message.id,
          makePrompt: buildPrompt,
        },
      );
      message.status = signal.aborted ? "stopped" : "complete";
      if (!message.text.trim() && !signal.aborted) {
        message.status = "error";
        message.text = "No reply was returned. Try this duck again.";
      }
    } catch (error) {
      message.status = signal.aborted ? "stopped" : "error";
      if (!signal.aborted)
        message.text = `${message.text ? message.text + "\n\n" : ""}${error instanceof Error ? error.message : "The provider could not complete this reply."}`;
    }
    const requests =
      discussion?.state.requests.filter((request) => request.messageId === message.id) ?? [];
    const passed = message.status === "complete" && message.text.trim() === "PASS";
    if (passed) {
      message.text = "";
      if (!requests.length) room.messages = room.messages.filter((item) => item.id !== message.id);
      if (discussion && !discussion.state.passedDucks.includes(duck.id))
        discussion.state.passedDucks.push(duck.id);
    }
    if (requests.length)
      message.text += `\n\n${requests.map((request) => (request.kind === "question" ? `To @${request.to}: ${request.text}` : `Requested follow-up: ${request.text}`)).join("\n\n")}`;
    persist(room);
    emitRoom();
    return passed ? undefined : message;
  }

  if (mode === "guide") {
    await speak(guide, initial, "guide");
  } else if (discussion) {
    await discussion.moderate(run, speak, emit);
  } else if (mode === "review") {
    await Promise.all(room.ducks.map((duck) => speak(duck, initial, "review")));
    if (!signal.aborted) await speak(guide, structuredClone(room.messages), "guide");
  } else {
    const selected = selectDucks(room.ducks, text, target);
    await Promise.all(selected.map((duck) => speak(duck, initial, "conversation")));
    if (room.observe && !signal.aborted) {
      const history = structuredClone(room.messages);
      await Promise.all(
        room.ducks
          .filter((duck) => !selected.some((item) => item.id === duck.id))
          .map((duck) => speak(duck, history, "observer")),
      );
    }
  }
}
