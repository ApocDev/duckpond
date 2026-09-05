import { beforeEach, expect, it, vi } from "vite-plus/test";
import { defaults, type Room, type RoomEvent } from "../lib/room";
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

it.each([true, false])(
  "streamText=%s still saves the partial reply when stopped after disconnect",
  async (streamText) => {
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
          streamText,
        }),
      }),
    );
    browser.abort();
    await response.body!.cancel();
    activeTurns.get(room.id)!.abort();
    await vi.waitFor(() => expect(activeTurns.has(room.id)).toBe(false));
    expect(room.messages.at(-1)).toMatchObject({ text: "Partial reply", status: "stopped" });
    expect(liveRooms.has(room.id)).toBe(false);
  },
);

it.each([true, false])(
  "streamText=%s keeps approvals immediate and preserves the full answer",
  async (streamText) => {
    vi.mocked(reply).mockImplementation(async (_duck, _system, _prompt, signal, write, emit) => {
      for (let i = 0; i < 100; i++) write("A thought. ");
      emit({ type: "activity", duckId: "guide", label: "Read" });
      const answer = await askApproval(
        { duck: "Guide", title: "One question", detail: "Continue?", input: true },
        signal,
        emit,
      );
      if (answer.approved) write("Finished.");
    });
    const response = await createChatResponse(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          roomId: room.id,
          text: "Guide me",
          mode: "guide",
          target: "explorer",
          streamText,
        }),
      }),
    );
    let wire = "";
    const decoder = new TextDecoder();
    const drained = response.body!.pipeTo(
      new WritableStream({
        write(chunk) {
          wire += decoder.decode(chunk, { stream: true });
        },
      }),
    );
    await vi.waitFor(() => expect(wire).toContain('"type":"approval"'));
    expect(activeTurns.has(room.id)).toBe(true);
    const approval = liveRooms.get(room.id)!.approvals[0];
    if (!streamText) expect(wire).not.toContain("A thought.");
    resolveApproval(approval.id, true, "yes");
    await drained;
    const events = wire
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; data: RoomEvent })
      .filter((part) => part.type === "data-room")
      .map((part) => part.data);
    const messages = events.filter((event) => event.type === "message");
    expect(messages).toHaveLength(streamText ? 103 : 2);
    if (!streamText) expect(messages.every((event) => event.message.text === "")).toBe(true);
    expect(events.some((event) => event.type === "resolved")).toBe(true);
    expect(room.messages.at(-1)).toMatchObject({
      text: "A thought. ".repeat(100) + "Finished.",
      status: "complete",
    });
    expect(events.at(-1)).toEqual({ type: "room", room });
  },
);
