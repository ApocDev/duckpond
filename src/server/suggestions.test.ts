import { expect, it, vi } from "vite-plus/test";
import { defaults, type Room } from "../lib/room";
import { suggestionContext, suggestionSchema } from "../lib/suggestions";
import type { CodexPacket } from "./codex-client.server";

const mocks = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn(), connect: vi.fn() }));
vi.mock("./codex-client.server", () => ({ connectCodex: mocks.connect }));
vi.mock("./providers.server", () => ({
  getAgentDirectory: async () => "/agent",
}));
vi.mock("./store.server", () => ({
  readProviderSession: vi.fn(),
  saveProviderSession: vi.fn(),
  saveProviderUsage: vi.fn(),
}));
import { suggestParticipant } from "./suggestions.server";

const context: Pick<Room, "messages" | "notes" | "ducks"> = {
  ducks: defaults,
  notes: "Solo developer. Keep the prototype small.",
  messages: [
    {
      id: "1",
      speaker: "You",
      text: "I want a datacenter game, but what will make repairs fun?",
      status: "complete",
      phase: "conversation",
      createdAt: "now",
    },
    {
      id: "2",
      speaker: "Explorer",
      text: "Unfinished speculative text",
      status: "thinking",
      phase: "conversation",
      createdAt: "now",
    },
    {
      id: "3",
      speaker: "Skeptic",
      text: "Provider failed",
      status: "error",
      phase: "conversation",
      createdAt: "now",
    },
  ],
};

it("uses the conversation, current draft personas and notes without unfinished replies", () => {
  const prompt = suggestionContext(context);
  expect(prompt).toContain("what will make repairs fun?");
  expect(prompt).toContain("Solo developer");
  expect(prompt).toContain(defaults[1].instructions);
  expect(prompt).not.toContain("Unfinished speculative text");
  expect(prompt).not.toContain("Provider failed");
});
it("requires context and allows the model to say another duck would not help", () => {
  expect(() => suggestionContext({ ...context, messages: [], notes: " " })).toThrow(
    "Share your idea",
  );
  expect(() => suggestionContext({ ...context, messages: [] })).not.toThrow();
  expect(
    suggestionSchema.parse({ duck: null, reason: "The existing ducks cover the open questions." })
      .duck,
  ).toBeNull();
});
it("returns a reviewable suggestion without mutating the roster and forwards cancellation", async () => {
  const original = structuredClone(context);
  const output = {
    reason: "Player motivation has not been explored.",
    duck: {
      name: "Playtester",
      instructions: "Evaluate whether the moment-to-moment actions are enjoyable.",
    },
  };
  const signal = new AbortController().signal;
  mocks.connect.mockImplementation(
    (_cwd: string, _signal: AbortSignal, receive: (packet: CodexPacket) => void) => {
      mocks.request.mockImplementation(async (method: string) => {
        if (method === "thread/start") return { thread: { id: "suggestion-thread" } };
        if (method === "turn/start") {
          receive({
            method: "item/completed",
            params: { item: { type: "agentMessage", text: "Considering the roster." } },
          });
          receive({
            method: "item/completed",
            params: { item: { type: "agentMessage", text: JSON.stringify(output) } },
          });
          receive({ method: "turn/completed", params: { turn: { status: "completed" } } });
        }
        return {};
      });
      return {
        initialize: async () => {},
        request: mocks.request,
        close: mocks.close,
        disconnected: new Promise<never>(() => {}),
      };
    },
  );
  await expect(suggestParticipant(context, signal)).resolves.toEqual(output);
  expect(context).toEqual(original);
  expect(mocks.connect).toHaveBeenCalledWith("/agent", signal, expect.any(Function));
  expect(mocks.request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({ model: "gpt-5.6-sol", sandbox: "read-only" }),
  );
  expect(mocks.request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({
      effort: "medium",
      outputSchema: expect.objectContaining({ type: "object" }),
      input: [{ type: "text", text: suggestionContext(context) }],
    }),
  );
  expect(mocks.close).toHaveBeenCalled();
});
