import { beforeEach, expect, it, vi } from "vite-plus/test";
import { defaults, type Room } from "../lib/room";
vi.mock("./providers.server", () => ({ reply: vi.fn() }));
vi.mock("./store.server", () => ({ getRoom: vi.fn(), saveRoom: vi.fn() }));
import { reply } from "./providers.server";
import { getRoom, saveRoom } from "./store.server";
import { activeTurns, liveRooms } from "./conversation.server";
import { askApproval, resolveApproval } from "./approvals.server";
import { createChatResponse } from "./chat.server";

let room: Room;
beforeEach(() => {
  vi.clearAllMocks();
  room = {
    id: crypto.randomUUID(),
    title: "Connection test",
    ducks: structuredClone(defaults),
    messages: [],
    notes: "",
    observe: false,
    updatedAt: "",
  };
  vi.mocked(getRoom).mockReturnValue(room);
});

it("keeps the turn and its approval alive after the browser cancels its response stream", async () => {
  let providerSignal: AbortSignal | undefined;
  vi.mocked(reply).mockImplementation(async (_duck, _system, _prompt, signal, write, emit) => {
    providerSignal = signal;
    write("Before disconnect. ");
    const answer = await askApproval(
      { duck: "Guide", title: "One question", detail: "Continue?", input: true },
      signal,
      emit,
    );
    if (answer.approved) write("Finished after reconnect.");
  });
  const browser = new AbortController();
  const messageId = crypto.randomUUID();
  const response = await createChatResponse(
    new Request("http://localhost/api/chat", {
      method: "POST",
      signal: browser.signal,
      body: JSON.stringify({
        roomId: room.id,
        submissionId: messageId,
        text: "Guide me",
        mode: "guide",
        target: "explorer",
      }),
    }),
  );
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(messageId);
  browser.abort();
  await reader.cancel();
  expect(providerSignal?.aborted).toBe(false);
  expect(activeTurns.has(room.id)).toBe(true);
  const approval = liveRooms.get(room.id)!.approvals[0];
  resolveApproval(approval.id, true, "{}");
  await vi.waitFor(() => expect(activeTurns.has(room.id)).toBe(false));
  expect(room.messages[0].id).toBe(messageId);
  expect(room.messages.at(-1)).toMatchObject({
    text: "Before disconnect. Finished after reconnect.",
    status: "complete",
  });
  expect(saveRoom).toHaveBeenLastCalledWith(room);
  expect(liveRooms.has(room.id)).toBe(false);
});

it("still stops and saves the partial reply when Stop is requested after a disconnect", async () => {
  vi.mocked(reply).mockImplementation(async (_duck, _system, _prompt, signal, write, emit) => {
    write("Partial reply");
    await askApproval(
      { duck: "Guide", title: "Wait", detail: "Continue?", input: true },
      signal,
      emit,
    );
  });
  const browser = new AbortController();
  const response = await createChatResponse(
    new Request("http://localhost/api/chat", {
      method: "POST",
      signal: browser.signal,
      body: JSON.stringify({
        roomId: room.id,
        text: "Guide me",
        mode: "guide",
        target: "explorer",
      }),
    }),
  );
  browser.abort();
  await response.body!.cancel();
  activeTurns.get(room.id)!.abort();
  await vi.waitFor(() => expect(activeTurns.has(room.id)).toBe(false));
  expect(room.messages.at(-1)).toMatchObject({ text: "Partial reply", status: "stopped" });
  expect(liveRooms.has(room.id)).toBe(false);
});
