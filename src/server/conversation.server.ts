import {
  makePrompt,
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
  }: {
    run?: Runner;
    persist?: (room: Room) => unknown;
    messageId?: string;
  } = {},
) {
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
  emit({ type: "room", room: structuredClone(room) });
  const initial = structuredClone(room.messages);

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
      const { system, prompt } = makePrompt(duck, history, phase, room.notes, room.ducks);
      await run(
        duck,
        system,
        prompt,
        signal,
        (delta) => {
          message.text += delta;
          if (phase !== "observer") emit({ type: "message", message: { ...message } });
        },
        (event) => {
          if (event.type === "activity") {
            message.tools ??= [];
            if (!message.tools.includes(event.label)) message.tools.push(event.label);
            emit({ type: "message", message: { ...message } });
          }
          emit(event);
        },
      );
      message.status = signal.aborted ? "stopped" : "complete";
      if (phase === "observer" && message.text.trim() === "PASS")
        room.messages = room.messages.filter((item) => item.id !== message.id);
      else if (!message.text.trim() && !signal.aborted) {
        message.status = "error";
        message.text = "No reply was returned. Try this duck again.";
      }
    } catch (error) {
      message.status = signal.aborted ? "stopped" : "error";
      if (!signal.aborted)
        message.text = `${message.text ? message.text + "\n\n" : ""}${error instanceof Error ? error.message : "The provider could not complete this reply."}`;
    }
    persist(room);
    emit({ type: "room", room: structuredClone(room) });
  }

  if (mode === "guide") {
    await speak(guide, initial, "guide");
  } else if (mode !== "conversation") {
    await Promise.all(room.ducks.map((duck) => speak(duck, initial, "review")));
    if (mode === "discussion" && !signal.aborted) {
      const reviews = structuredClone(room.messages);
      await Promise.all(room.ducks.map((duck) => speak(duck, reviews, "discussion")));
    }
    if (!signal.aborted)
      await speak(
        {
          ...guide,
          instructions: `${guide.instructions}\nSummarize the round that just finished. Give the person one concise synthesis of the ducks' input and at most one next question. If replies failed or stopped, say the review is incomplete.`,
        },
        structuredClone(room.messages),
        "guide",
      );
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
