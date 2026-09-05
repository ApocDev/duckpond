import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { turnSchema, type RoomStream, type Approval } from "../lib/room";
import { requireAllowedRequest } from "./access.server";
import { getRoom } from "./store.server";
import { activeTurns, liveRooms, runConversation } from "./conversation.server";

export async function createChatResponse(request: Request) {
  try {
    requireAllowedRequest(request);
  } catch {
    return new Response("Hostname not enabled", { status: 403 });
  }
  const parsed = turnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid conversation request", { status: 400 });
  const { roomId, submissionId, text, mode, target } = parsed.data;
  if (activeTurns.has(roomId))
    return new Response("This conversation is already running", { status: 409 });
  let room;
  try {
    room = getRoom(roomId);
  } catch {
    return new Response("Conversation not found", { status: 404 });
  }
  const controller = new AbortController();
  activeTurns.set(roomId, controller);
  const approvals: Approval[] = [];
  const live = { room, approvals };
  liveRooms.set(roomId, live);
  // Closing a tab ends its stream, not the server-owned turn.
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(900000)]);
  const stream = createUIMessageStream<RoomStream>({
    execute: async ({ writer }) => {
      try {
        await runConversation(
          room,
          text,
          mode,
          target,
          signal,
          (event) => {
            if (event.type === "approval") live.approvals.push(event.approval);
            if (event.type === "resolved")
              live.approvals = live.approvals.filter((item) => item.id !== event.id);
            if (!request.signal.aborted)
              writer.write({ type: "data-room", data: event, transient: true });
          },
          { messageId: submissionId },
        );
      } finally {
        activeTurns.delete(roomId);
        liveRooms.delete(roomId);
      }
    },
    onError: () =>
      "The conversation stopped unexpectedly. Your saved messages are still available.",
  });
  return createUIMessageStreamResponse({ stream, headers: { "Cache-Control": "no-store" } });
}
