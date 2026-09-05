import { describe, expect, it, vi } from "vite-plus/test";
import { defaults, guide, roomSchema, selectDucks, type Room, type RoomEvent } from "../lib/room";
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
            if (mediatorTurns === 1) {
              tools!.call("start_review", {
                duckIds: value.ducks.map((duck) => duck.id),
                prompt: "Assess independently.",
              });
              return;
            }
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
          const followup = mediatorTurns > 1;
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
      "mediator",
      "explorer",
      "skeptic",
      "simplifier",
      "mediator",
      "skeptic",
      "mediator",
      "simplifier",
      "mediator",
    ]);
    for (const entry of seen.slice(1, 4)) {
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
  it("preserves partial replies on cancellation and does not start the summary", async () => {
    const value = room();
    const controller = new AbortController();
    const called: string[] = [];
    await runConversation(value, "Check this", "review", "explorer", controller.signal, emit, {
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

it.each(["conversation", "review", "discussion"] as const)(
  "%s hides passes, including split streamed tokens, and keeps useful replies",
  async (mode) => {
    const value = room();
    const events: RoomEvent[] = [];
    await runConversation(
      value,
      "@explorer @skeptic @simplifier Unity or Unreal?",
      mode,
      "explorer",
      new AbortController().signal,
      (event) => events.push(structuredClone(event)),
      {
        persist,
        run: async (duck, system, prompt, _signal, write, emit, tools) => {
          if (duck.id === "mediator") {
            expect(system).not.toContain("reply exactly PASS");
            if (!value.messages.some((message) => message.phase === "review")) {
              tools!.call("start_review", {
                duckIds: value.ducks.map((duck) => duck.id),
                prompt: "Assess independently.",
              });
              return;
            }
            expect(prompt).toContain('"passedDucks":["skeptic","simplifier"]');
            tools!.call("finish_discussion", {
              summary: "Use the relevant engine assessment.",
              disagreements: [],
              question: "",
              deferred: [],
            });
          } else if (duck.id === "guide") write("Use the relevant engine assessment.");
          else {
            expect(prompt).toContain("persona is a perspective, not an obligation");
            if (duck.id === "explorer") {
              // A normal response starting with the sentinel prefix must still stream.
              write("P");
              write("assing assets between editors needs a concrete workflow test.");
            } else {
              write("P");
              write("AS");
              emit({ type: "activity", duckId: duck.id, label: "Read" });
              write("S");
            }
          }
        },
      },
    );
    expect(
      value.messages.some(
        (message) => message.duckId === "skeptic" || message.duckId === "simplifier",
      ),
    ).toBe(false);
    expect(value.messages.find((message) => message.duckId === "explorer")?.text).toContain(
      "Passing assets",
    );
    for (const event of events) {
      if (event.type === "message") expect(["P", "PAS", "PASS"]).not.toContain(event.message.text);
      if (event.type === "room")
        expect(event.room.messages.some((message) => message.text === "PASS")).toBe(false);
    }
  },
);

it("keeps an assigned question open when its recipient passes", async () => {
  const value = room();
  let mediatorTurns = 0;
  await runConversation(
    value,
    "Review the engine choice",
    "discussion",
    "explorer",
    new AbortController().signal,
    emit,
    {
      persist,
      run: async (duck, _system, prompt, _signal, write, _emit, tools) => {
        const state = value.discussions![0];
        if (duck.id === "mediator") {
          if (mediatorTurns++ === 0) {
            tools!.call("start_review", {
              duckIds: value.ducks.map((duck) => duck.id),
              prompt: "Assess independently.",
            });
            return;
          }
          const request = state.requests[0];
          if (mediatorTurns === 2)
            tools!.call("give_floor", {
              duckId: "skeptic",
              prompt: "Answer the engine question",
              requestIds: [request.id],
            });
          else {
            expect(request.status).toBe("open");
            expect(request.responseId).toBeUndefined();
            expect(prompt).toContain('"passedDucks":["skeptic"]');
            tools!.call("finish_discussion", {
              summary: "No relevant answer from Skeptic.",
              disagreements: [],
              question: "",
              deferred: [{ requestId: request.id, reason: "Outside this duck's expertise." }],
            });
          }
        } else if (duck.id === "explorer" && mediatorTurns === 1) {
          tools!.call("ask_duck", { duckId: "skeptic", question: "Any editor workflow concerns?" });
          write("Compare a small level-authoring task.");
        } else
          write(duck.id === "skeptic" && mediatorTurns > 1 ? "PASS" : "A brief relevant point.");
      },
    },
  );
  expect(value.messages.filter((message) => message.duckId === "skeptic")).toHaveLength(1);
  expect(value.discussions![0].requests[0].status).toBe("deferred");
  expect(value.messages.at(-1)?.text).toContain("Still open:");
});

it("answers a clarification through Mediator without polling ducks", async () => {
  const value = room();
  const run = vi.fn<typeof reply>(async (duck, _system, _prompt, _signal, _write, _emit, tools) => {
    expect(duck.id).toBe("mediator");
    tools!.call("finish_discussion", {
      summary: "No decision is needed from you.",
      disagreements: [],
      question: "",
      deferred: [],
    });
  });
  await runConversation(
    value,
    "What are you asking me?",
    "discussion",
    "explorer",
    new AbortController().signal,
    emit,
    { run, persist },
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(value.messages.at(-1)?.text).toBe("No decision is needed from you.");
});

it("executes approved work, requires evidence and review, and persists completion", async () => {
  const value = room();
  let turn = 0;
  await runConversation(
    value,
    "Write a two-line cable test checklist in chat.",
    "discussion",
    "explorer",
    new AbortController().signal,
    emit,
    {
      persist,
      run: async (duck, system, _prompt, _signal, write, _emit, tools) => {
        if (duck.id === "mediator") {
          turn++;
          if (turn === 1) {
            const assignment = {
              duckId: "explorer",
              task: "Write the checklist",
              deliverable: "Two concrete test steps in chat",
              authorizationId: value.messages[0].id,
            };
            expect(() =>
              tools!.call("assign_action", { ...assignment, authorizationId: "duck-proposal" }),
            ).toThrow("human message");
            tools!.call("assign_action", assignment);
          } else if (turn === 2) {
            expect(() =>
              tools!.call("finish_discussion", {
                summary: "Done",
                disagreements: [],
                question: "",
                deferred: [],
              }),
            ).toThrow("Approved work remains");
            tools!.call("review_action", {
              actionId: value.actions![0].id,
              accepted: true,
              reason: "Both required checks are present in the reply.",
            });
          } else
            tools!.call("finish_discussion", {
              summary: "The checklist is ready.",
              disagreements: [],
              question: "",
              deferred: [],
            });
        } else {
          expect(duck.id).toBe("explorer");
          expect(system).not.toContain("reply exactly PASS");
          const report = {
            actionId: value.actions![0].id,
            status: "reported",
            result: "1. Route and secure a cable. 2. Save, reload, and compare anchors.",
          };
          expect(() => tools!.call("report_action", { ...report, evidence: [] })).toThrow(
            "Provide evidence",
          );
          tools!.call("report_action", { ...report, evidence: [report.result] });
          write(report.result);
        }
      },
    },
  );
  expect(value.actions![0]).toMatchObject({
    status: "complete",
    owner: "explorer",
    authorizationId: value.messages[0].id,
  });
  expect(
    value.messages.find((message) => message.id === value.actions![0].responseId)?.status,
  ).toBe("complete");
  const restored = roomSchema.parse(JSON.parse(JSON.stringify(value)));
  expect(restored.actions).toEqual(value.actions);
});

it.each(["PASS", "I can do that. Want me to?"])(
  "does not complete an action from %s and can resume it in a later turn",
  async (answer) => {
    let value = room();
    let mediatorTurns = 0;
    const controller = new AbortController();
    await runConversation(
      value,
      "Audit the document",
      "discussion",
      "explorer",
      controller.signal,
      emit,
      {
        persist,
        run: async (duck, _system, _prompt, _signal, write, _emit, tools) => {
          if (duck.id !== "mediator") {
            write(answer);
            return;
          }
          if (mediatorTurns++ === 0)
            tools!.call("assign_action", {
              duckId: "explorer",
              task: "Audit the document",
              deliverable: "Corrected file",
              authorizationId: value.messages[0].id,
            });
          else {
            expect(value.actions![0].status).not.toBe("complete");
            controller.abort();
          }
        },
      },
    );
    value = roomSchema.parse(JSON.parse(JSON.stringify(value)));
    const action = value.actions![0];
    let resumed = false;
    await runConversation(
      value,
      "Continue",
      "discussion",
      "explorer",
      new AbortController().signal,
      emit,
      {
        persist,
        run: async (duck, _system, prompt, _signal, write, _emit, tools) => {
          if (duck.id !== "mediator") {
            tools!.call("report_action", {
              actionId: action.id,
              status: "blocked",
              result: "The requested document was not found at the supplied path.",
              evidence: [],
            });
            write("The document is missing.");
          } else if (!resumed) {
            expect(prompt).toContain(action.id);
            tools!.call("assign_action", {
              duckId: "explorer",
              task: action.task,
              deliverable: action.deliverable,
              authorizationId: action.authorizationId,
              actionId: action.id,
            });
            resumed = true;
          } else
            tools!.call("finish_discussion", {
              summary: "The audit is blocked by a missing file.",
              disagreements: [],
              question: "",
              deferred: [],
            });
        },
      },
    );
    expect(value.actions).toHaveLength(1);
    expect(action.status).toBe("blocked");
    expect(value.messages.at(-1)?.text).toContain("Unfinished work:");
  },
);
