import { describe, expect, it, vi } from "vite-plus/test";
import { defaults, guide, selectDucks, type Room, type RoomEvent } from "../lib/room";
vi.mock("./providers.server", () => ({ reply: vi.fn() }));
vi.mock("./store.server", () => ({ saveRoom: vi.fn() }));
import { runConversation } from "./conversation.server";
import { reply } from "./providers.server";

function room(): Room {
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    ducks: structuredClone(defaults),
    messages: [],
    notes: "Keep it small",
    observe: false,
    updatedAt: new Date().toISOString(),
  };
}
const emit = () => {};
const persist = () => {};
describe("conversation rounds", () => {
  it("lets the guide see the conversation and follow-up answers without triggering mentions or observers", async () => {
    const value = room();
    value.observe = true;
    value.messages.push(
      {
        id: "user",
        speaker: "You",
        text: "A ten-minute repair game",
        status: "complete",
        phase: "conversation",
        createdAt: "",
      },
      {
        id: "review",
        speaker: "Skeptic",
        duckId: "skeptic",
        text: "Repairs may become chores",
        status: "stopped",
        phase: "review",
        createdAt: "",
      },
    );
    const roster = structuredClone(value.ducks);
    const runner = vi.fn<typeof reply>(async (_duck, _system, _prompt, _signal, write) =>
      write("What makes a repair satisfying?"),
    );
    await runConversation(
      value,
      "Summarize and guide",
      "guide",
      "explorer",
      new AbortController().signal,
      emit,
      { run: runner, persist },
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toEqual(guide);
    expect(runner.mock.calls[0][2]).toContain("Repairs may become chores");
    expect(runner.mock.calls[0][2]).toContain('"status":"stopped"');
    expect(runner.mock.calls[0][2]).toContain("Keep it small");
    expect(value.messages.at(-1)).toMatchObject({
      phase: "guide",
      model: "gpt-5.6-sol",
      reasoning: "medium",
      status: "complete",
    });
    await runConversation(
      value,
      "@skeptic I like finding the fault",
      "guide",
      "skeptic",
      new AbortController().signal,
      emit,
      { run: runner, persist },
    );
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[1][0]).toEqual(guide);
    expect(runner.mock.calls[1][2]).toContain("What makes a repair satisfying?");
    expect(runner.mock.calls[1][2]).toContain("I like finding the fault");
    expect(value.ducks).toEqual(roster);
  });
  it("mediates sequential questions with shared replies and explicit deferral", async () => {
    const value = room();
    const seen: { id: string; prompt: string }[] = [];
    let mediatorTurns = 0;
    let activeSpeakers = 0;
    await runConversation(
      value,
      "Would this be fun?",
      "discussion",
      "explorer",
      new AbortController().signal,
      emit,
      {
        persist,
        run: async (duck, _system, prompt, _signal, write, _emit, tools) => {
          seen.push({ id: duck.id, prompt });
          const state = value.discussions![0];
          if (duck.id === "mediator") {
            expect(activeSpeakers).toBe(0);
            mediatorTurns++;
            const questions = state.requests.filter(
              (item) => item.kind === "question" && item.status === "open",
            );
            if (questions.length)
              tools!.call("give_floor", {
                duckId: questions[0].to,
                prompt: "Answer your peer's objection.",
                requestIds: [questions[0].id],
              });
            else
              tools!.call("finish_discussion", {
                summary: "Try one hand-authored diagnosis puzzle.",
                disagreements: ["Skeptic still doubts replayability."],
                question: "Do you want replayability or a short story?",
                deferred: state.requests
                  .filter((item) => item.status === "open")
                  .map((item) => ({
                    requestId: item.id,
                    reason: "Depends on the person's answer.",
                  })),
              });
            expect(() =>
              tools!.call("give_floor", {
                duckId: "explorer",
                prompt: "Speak again",
                requestIds: [],
              }),
            ).toThrow("One scheduling decision");
            return;
          }
          activeSpeakers++;
          const followup = mediatorTurns > 0;
          if (followup) expect(activeSpeakers).toBe(1);
          if (duck.id === "explorer" && !followup)
            tools!.call("ask_duck", { duckId: "skeptic", question: "What makes repairs boring?" });
          if (duck.id === "skeptic" && followup) {
            expect(prompt).toContain("opinion-simplifier");
            tools!.call("ask_duck", {
              duckId: "simplifier",
              question: "Can one authored puzzle avoid repetition?",
            });
            tools!.call("request_turn", { reason: "I still want to discuss replayability." });
          }
          if (duck.id === "simplifier" && followup) expect(prompt).toContain("revised-skeptic");
          write(`${followup ? "revised" : "opinion"}-${duck.id}`);
          await Promise.resolve();
          activeSpeakers--;
        },
      },
    );
    expect(seen.map((item) => item.id)).toEqual([
      "explorer",
      "skeptic",
      "simplifier",
      "mediator",
      "skeptic",
      "mediator",
      "simplifier",
      "mediator",
    ]);
    for (const entry of seen.slice(0, 3)) {
      expect(entry.prompt).toContain("Would this be fun?");
      expect(entry.prompt).not.toContain("opinion-");
      expect(entry.prompt).not.toContain("What makes repairs boring?");
    }
    expect(value.discussions![0]).toMatchObject({ status: "complete", turns: 2 });
    expect(value.discussions![0].requests.map((item) => item.status)).toEqual([
      "addressed",
      "addressed",
      "deferred",
    ]);
    for (const request of value.discussions![0].requests.filter(
      (item) => item.status === "addressed",
    ))
      expect(value.messages.find((message) => message.id === request.responseId)?.duckId).toBe(
        request.to,
      );
    expect(value.messages.at(-1)).toMatchObject({
      speaker: "Mediator",
      phase: "guide",
      status: "complete",
    });
    expect(value.messages.at(-1)?.text).toContain("Still open:");
  });
  it("summarizes completed reviews and tells the guide which replies failed", async () => {
    const value = room();
    const runner = vi.fn<typeof reply>(async (duck, _system, prompt, _signal, write) => {
      if (duck.id === "skeptic") throw new Error("Usage limit");
      if (duck.id === "guide") {
        expect(prompt).toContain("Usage limit");
        expect(prompt).toContain('"status":"error"');
        expect(prompt).toContain("opinion-explorer");
        expect(prompt).toContain("opinion-simplifier");
      }
      write(`opinion-${duck.id}`);
    });
    await runConversation(
      value,
      "Review this",
      "review",
      "explorer",
      new AbortController().signal,
      emit,
      { run: runner, persist },
    );
    expect(runner.mock.calls.map(([duck]) => duck.id)).toEqual([
      "explorer",
      "skeptic",
      "simplifier",
      "guide",
    ]);
  });
  it("routes explicit mentions without also calling the default duck", () => {
    expect(selectDucks(defaults, "@skeptic check this", "explorer").map((duck) => duck.id)).toEqual(
      ["skeptic"],
    );
    expect(
      selectDucks(defaults, "Unaddressed thought", "simplifier").map((duck) => duck.id),
    ).toEqual(["simplifier"]);
  });
  it("preserves partial replies on cancellation and does not start the discussion round", async () => {
    const value = room();
    const controller = new AbortController();
    const called: string[] = [];
    await runConversation(value, "Check this", "discussion", "explorer", controller.signal, emit, {
      run: async (duck, _system, _prompt, _signal, write) => {
        called.push(duck.id);
        write("A partial thought");
        controller.abort();
        throw new Error("aborted");
      },
      persist,
    });
    expect(called).toEqual(["explorer"]);
    expect(value.messages.at(-1)).toMatchObject({ text: "A partial thought", status: "stopped" });
  });
  it("removes quiet observers instead of publishing PASS as a contribution", async () => {
    const value = room();
    value.observe = true;
    await runConversation(
      value,
      "A thought",
      "conversation",
      "explorer",
      new AbortController().signal,
      emit,
      {
        run: async (duck, _system, _prompt, _signal, write) => {
          write(duck.id === "explorer" ? "A question" : "PASS");
        },
        persist,
      },
    );
    expect(value.messages.map((message) => message.text)).toEqual(["A thought", "A question"]);
  });
  it("keeps the other duck's response when one provider fails", async () => {
    const value = room();
    await runConversation(
      value,
      "@explorer @skeptic check",
      "conversation",
      "explorer",
      new AbortController().signal,
      emit,
      {
        run: async (duck, _system, _prompt, _signal, write) => {
          if (duck.id === "explorer") throw new Error("Usage limit");
          write("Still useful");
        },
        persist,
      },
    );
    expect(value.messages[1]).toMatchObject({ status: "error", text: "Usage limit" });
    expect(value.messages[2]).toMatchObject({ status: "complete", text: "Still useful" });
  });
});

it("hides unfinished peer text in mobile snapshots while preserving completed and failed replies", async () => {
  const value = room();
  const events: RoomEvent[] = [];
  let finishPeer = () => {};
  const peer = new Promise<void>((resolve) => {
    finishPeer = resolve;
  });
  const turn = runConversation(
    value,
    "Review this",
    "review",
    "explorer",
    new AbortController().signal,
    (event) => events.push(structuredClone(event)),
    {
      streamText: false,
      persist,
      run: async (duck, _system, _prompt, _signal, write) => {
        write(`opinion-${duck.id}`);
        if (duck.id === "skeptic") await peer;
        if (duck.id === "simplifier") throw new Error("Usage limit");
      },
    },
  );
  try {
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) =>
            event.type === "room" &&
            event.room.messages.some(
              (message) => message.duckId === "explorer" && message.status === "complete",
            ),
        ),
      ).toBe(true),
    );
    const snapshots = events.filter((event) => event.type === "room");
    expect(
      snapshots.some((event) =>
        event.room.messages.some((message) => message.duckId === "skeptic"),
      ),
    ).toBe(true);
    for (const event of snapshots)
      expect(
        event.room.messages
          .filter((message) => message.status === "thinking")
          .every((message) => message.text === ""),
      ).toBe(true);
    expect(value.messages.find((message) => message.duckId === "skeptic")?.text).toBe(
      "opinion-skeptic",
    );
  } finally {
    finishPeer();
    await turn;
  }
  expect(value.messages.find((message) => message.duckId === "simplifier")).toMatchObject({
    status: "error",
    text: "opinion-simplifier\n\nUsage limit",
  });
  expect(events.at(-1)).toEqual({ type: "room", room: value });
});
