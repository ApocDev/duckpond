import { expect, it, vi } from "vite-plus/test";
import { defaults, roomSchema, type Message, type Room } from "../lib/room";
import { createDiscussion, discussionTurnLimit } from "./discussion.server";
import { callRoomTool } from "./room-tools.server";
import type { reply } from "./providers.server";

function setup() {
  const message: Message = {
    id: "assessment",
    duckId: "explorer",
    speaker: "Explorer",
    text: "An idea",
    phase: "review",
    status: "thinking",
    createdAt: "",
  };
  const room: Room = {
    id: crypto.randomUUID(),
    title: "Discussion",
    ducks: structuredClone(defaults),
    messages: [message],
    notes: "",
    observe: false,
    updatedAt: "",
  };
  const signal = new AbortController();
  const save = vi.fn();
  const discussion = createDiscussion(room, "turn", signal.signal, save);
  return {
    room,
    message,
    signal,
    save,
    discussion,
    tools: discussion.participantTools(defaults[0], message),
  };
}
it("binds requests to the speaker, rejects invalid recipients and expires room tools", () => {
  const { tools, discussion, room, message, save } = setup();
  expect(callRoomTool(tools, "give_floor", {}).success).toBe(false);
  expect(callRoomTool(tools, "ask_duck", { duckId: "stranger", question: "Why?" }).success).toBe(
    false,
  );
  expect(
    callRoomTool(tools, "ask_duck", { duckId: "skeptic", question: "Why?", replyTo: "missing" })
      .success,
  ).toBe(false);
  const input = { duckId: "skeptic", question: "Why?", from: "simplifier" };
  expect(callRoomTool(tools, "ask_duck", input).success).toBe(true);
  callRoomTool(tools, "ask_duck", input);
  expect(discussion.state.requests).toHaveLength(1);
  expect(discussion.state.requests[0]).toMatchObject({
    from: "explorer",
    to: "skeptic",
    messageId: "assessment",
    status: "open",
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(roomSchema.parse(JSON.parse(JSON.stringify(room))).discussions).toEqual(room.discussions);
  message.status = "complete";
  expect(callRoomTool(tools, "request_turn", { reason: "Another point" }).success).toBe(false);
});
it("keeps failed answers open and requires explicit deferral before finishing", async () => {
  const { discussion, tools } = setup();
  tools.call("ask_duck", { duckId: "skeptic", question: "Why?" });
  const request = discussion.state.requests[0];
  let turns = 0;
  await discussion.moderate(
    async (_duck, _system, _prompt, _signal, _write, _emit, tools) => {
      turns++;
      expect(() =>
        tools!.call("finish_discussion", {
          summary: "Done",
          disagreements: [],
          question: "",
          deferred: [],
        }),
      ).toThrow("Account for every open request");
      if (turns === 1) {
        expect(() =>
          tools!.call("give_floor", {
            duckId: "simplifier",
            prompt: "Answer",
            requestIds: [request.id],
          }),
        ).toThrow("selected duck");
        tools!.call("give_floor", {
          duckId: "skeptic",
          prompt: "Answer",
          requestIds: [request.id],
        });
      } else {
        expect(request.status).toBe("open");
        tools!.call("finish_discussion", {
          summary: "Review incomplete",
          disagreements: [],
          question: "",
          deferred: [{ requestId: request.id, reason: "Provider failed" }],
        });
      }
    },
    async () => ({
      id: "failed",
      speaker: "Skeptic",
      text: "Unavailable",
      status: "error",
      phase: "discussion",
      createdAt: "",
    }),
    () => {},
  );
  expect(request).toMatchObject({ status: "deferred", reason: "Provider failed" });
  expect(request.responseId).toBeUndefined();
});
it("enforces the turn budget even when the Mediator keeps requesting speakers", async () => {
  const { discussion } = setup();
  const speak = vi.fn(async () => undefined);
  const run = vi.fn<typeof reply>(
    async (_duck, _system, _prompt, _signal, _write, _emit, tools) => {
      const action = { duckId: "skeptic", prompt: "Challenge the proposal", requestIds: [] };
      if (discussion.state.turns < discussionTurnLimit) tools!.call("give_floor", action);
      else {
        expect(() => tools!.call("give_floor", action)).toThrow("budget is exhausted");
        tools!.call("finish_discussion", {
          summary: "No agreement yet",
          disagreements: ["Unresolved tradeoff"],
          question: "Which tradeoff matters more?",
          deferred: [],
        });
      }
    },
  );
  await discussion.moderate(run, speak, () => {});
  expect(speak).toHaveBeenCalledTimes(discussionTurnLimit);
  expect(run).toHaveBeenCalledTimes(discussionTurnLimit + 1);
});
it("does not grant another turn after Stop and preserves open questions", async () => {
  const { discussion, tools, signal, room } = setup();
  tools.call("ask_duck", { duckId: "skeptic", question: "Why?" });
  const speak = vi.fn(async () => undefined);
  await discussion.moderate(
    async (_duck, _system, _prompt, _signal, _write, _emit, mediatorTools) => {
      signal.abort();
      expect(
        callRoomTool(mediatorTools, "give_floor", {
          duckId: "skeptic",
          prompt: "Answer",
          requestIds: [],
        }).success,
      ).toBe(false);
    },
    speak,
    () => {},
  );
  expect(speak).not.toHaveBeenCalled();
  expect(discussion.state.status).toBe("stopped");
  expect(discussion.state.requests[0].status).toBe("open");
  expect(room.messages.at(-1)?.text).toContain("Still open:");
});

it("corrects one missing scheduling call, then stops if the Mediator still provides only text", async () => {
  const { discussion, room } = setup();
  const run = vi.fn<typeof reply>(async (_duck, _system, prompt, _signal, write) => {
    if (run.mock.calls.length === 2)
      expect(prompt).toContain("previous invocation ended without a valid room-tool decision");
    write("I would ask Skeptic next.");
  });
  const speak = vi.fn(async () => undefined);
  await discussion.moderate(run, speak, () => {});
  expect(run).toHaveBeenCalledTimes(2);
  expect(speak).not.toHaveBeenCalled();
  expect(discussion.state.status).toBe("error");
  expect(room.messages.at(-1)?.text).toContain("ended without choosing a speaker");
});

it("recovers when a swallowed tool rejection used the discussion ID as a request ID", async () => {
  const { discussion, room } = setup();
  let attempts = 0;
  const speak = vi.fn(async () => undefined);
  await discussion.moderate(
    async (_duck, _system, prompt, _signal, _write, _emit, tools) => {
      attempts++;
      if (attempts === 1) {
        // Codex's orchestration script discarded the non-MCP-shaped error result.
        expect(
          callRoomTool(tools, "give_floor", {
            duckId: "skeptic",
            prompt: "Compare the priorities.",
            requestIds: [discussion.state.id],
          }).success,
        ).toBe(false);
      } else if (attempts === 2) {
        expect(prompt).toContain("give_floor rejected");
        expect(prompt).toContain("Valid requestIds for @skeptic: []");
        expect(prompt).toContain("not message IDs or the discussion ID");
        tools!.call("give_floor", {
          duckId: "skeptic",
          prompt: "Compare the priorities.",
          requestIds: [],
        });
      } else {
        tools!.call("finish_discussion", {
          summary: "Map the garage session first.",
          disagreements: [],
          question: "",
          deferred: [],
        });
      }
    },
    speak,
    () => {},
  );
  expect(speak).toHaveBeenCalledTimes(1);
  expect(discussion.state.status).toBe("complete");
  expect(room.messages.at(-1)?.text).toBe("Map the garage session first.");
});
