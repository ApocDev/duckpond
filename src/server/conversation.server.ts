import {
  makePrompt,
  shortTitle,
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
import { getRoom, saveRoom } from "./store.server";
import { sharedNotes } from "./ponds.server";
import {
  createDiscussion,
  participantInstructions,
  inactiveParticipantTools,
} from "./discussion.server";

export const liveRooms = new Map<string, { room: Room; approvals: Approval[] }>();
export const activeTurns = new Map<string, AbortController>();
type Runner = typeof reply;

/**
 * A turn cut off by a server restart stays saved as running. When no turn is running here, close
 * it like a stopped one, so the round offers Edit and ask again and Summarize instead of looking done.
 */
export function recoverInterrupted(room: Room) {
  if (activeTurns.has(room.id)) return room;
  const discussions = room.discussions?.filter((item) => item.status === "running") ?? [];
  const thinking = room.messages.filter((message) => message.status === "thinking");
  if (!discussions.length && !thinking.length) return room;
  for (const discussion of discussions) discussion.status = "stopped";
  for (const message of thinking) message.status = "stopped";
  for (const action of room.actions ?? [])
    if (action.status === "running") action.status = "pending";
  // The note ends the cut-off turn: it goes before your next message if you kept going after it.
  const start = Math.min(
    ...discussions.map((item) => room.messages.findIndex((message) => message.id === item.id)),
    ...thinking.map((message) => room.messages.indexOf(message)),
  );
  const next = room.messages.findIndex((message, index) => index > start && !message.duckId);
  room.messages.splice(next === -1 ? room.messages.length : next, 0, {
    id: crypto.randomUUID(),
    speaker: guide.name,
    duckId: guide.id,
    avatar: guide.avatar,
    text: "The server restarted during this turn. Completed replies are saved.",
    status: "stopped",
    phase: "guide",
    createdAt: new Date().toISOString(),
  });
  saveRoom(room);
  return room;
}

/**
 * Names a conversation from its first message and reply, in place of the cut-off first message.
 * A rename made meanwhile wins, and a failed call keeps the first-message title.
 */
export async function nameConversation(roomId: string, first: string) {
  let title = "";
  try {
    const answer =
      getRoom(roomId).messages.find(
        (message) => message.duckId && message.status === "complete" && message.text.trim(),
      )?.text ?? "";
    await reply(
      { ...guide, reasoning: "low" },
      "You name conversations. Reply with only a title of two to six words that says what the conversation is about. No quotes, no ending period.",
      `First message:\n${first.slice(0, 2000)}\n\nFirst reply:\n${answer.slice(0, 2000)}`,
      AbortSignal.timeout(60000),
      (chunk) => {
        title += chunk;
      },
      () => {},
    );
  } catch {
    return;
  }
  title = title
    .trim()
    .split("\n")[0]
    .replace(/^["'*#\s]+|["'.*\s]+$/g, "");
  if (!title) return;
  // A turn that started meanwhile saves its own copy of the room, so the title goes on that copy.
  const live = liveRooms.get(roomId)?.room;
  const room = live ?? getRoom(roomId);
  if (room.title !== shortTitle(first)) return;
  room.title = shortTitle(title);
  if (!live) saveRoom(room);
}

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
      if (
        message.status === "thinking" &&
        (!streamText || "PASS".startsWith(message.text.trim()))
      ) {
        message.written = message.text.length;
        message.text = "";
      }
    emit({ type: "room", room: snapshot });
  }

  room.messages.push({
    id: messageId,
    speaker: "You",
    text,
    status: "complete",
    phase: "conversation",
    createdAt: new Date().toISOString(),
    to:
      mode === "discussion" || mode === "guide"
        ? ["mediator"]
        : mode === "review"
          ? ["everyone"]
          : selectDucks(room.ducks, text, target).map((duck) => duck.id),
  });
  if (room.messages.length === 1) room.title = shortTitle(text);
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
          sharedNotes(room),
          room.ducks,
          phase !== "guide" &&
            !discussion?.assignedTo(duck.id) &&
            !(mode === "conversation" && duck.id === target),
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
      // With text hidden, a progress count every few seconds still shows the duck is writing.
      let progressAt = Date.now();
      await run(
        duck,
        `${system}\n\n${participantInstructions}`,
        buildPrompt(history),
        signal,
        (delta) => {
          message.text += delta;
          if (streamText && !"PASS".startsWith(message.text.trim()))
            emit({ type: "message", message: { ...message } });
          else if (!streamText && Date.now() - progressAt > 5000) {
            progressAt = Date.now();
            emit({
              type: "message",
              message: { ...message, text: "", written: message.text.length },
            });
          }
        },
        (event) => {
          if (event.type === "change") {
            // A file changed twice in one reply keeps both diffs, in order.
            const earlier = message.changes?.find((change) => change.path === event.path);
            message.changes = [
              ...(message.changes ?? []).filter((change) => change !== earlier),
              {
                path: event.path,
                diff: earlier ? `${earlier.diff}\n${event.diff}` : event.diff,
              },
            ];
          }
          if (event.type === "activity") {
            // Unique steps, most recent last, so the last entry is what the duck is doing now.
            message.tools = [
              ...(message.tools ?? []).filter((tool) => tool !== event.label),
              event.label,
            ];
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
          workspace: room.workspace,
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
      if (!requests.length) message.status = "passed";
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
  }
}
