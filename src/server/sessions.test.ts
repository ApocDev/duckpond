import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { defaults, makePrompt, visibleMessages, type Message } from "../lib/room";
vi.mock("./store.server", () => ({
  readProviderSession: vi.fn(),
  saveProviderSession: vi.fn(),
  saveProviderUsage: vi.fn(),
}));
import { prepareReply, codexUsageTracker, claudeUsage, usageRecordSchema } from "./sessions.server";
import { inactiveParticipantTools } from "./discussion.server";
import { usageReport } from "./usage.server";

function fixture() {
  const sessions = new Map<string, unknown>();
  const usage = new Map<string, unknown>();
  const store = {
    readProviderSession: (key: string) => structuredClone(sessions.get(key)),
    saveProviderSession: (key: string, value: unknown) => {
      sessions.set(key, structuredClone(value));
    },
    saveProviderUsage: (key: string, value: unknown) => {
      usage.set(key, structuredClone(value));
    },
  };
  const message = (id: string, text = id): Message => ({
    id,
    text,
    speaker: "You",
    status: "complete",
    phase: "conversation",
    createdAt: "now",
  });
  const prepare = (messages: Message[], roomId = "room", duck = defaults[0], responseId?: string) =>
    prepareReply(
      duck,
      "stable system",
      "unused",
      "/agent",
      inactiveParticipantTools,
      { roomId, messages, responseId, makePrompt: (delta) => JSON.stringify(delta) },
      store,
    );
  return { sessions, usage, store, message, prepare };
}

it("resumes from persisted state and delivers only unseen or changed messages, without echoing its answer", () => {
  const f = fixture();
  const history = [f.message("old", "x".repeat(100000)), f.message("question")];
  const first = f.prepare(history, "room", defaults[0], "answer");
  first.native.opened("native-1");
  first.native.accepted();
  first.finish("complete");
  // No live session object is reused here. Reads deserialize the stored state.
  const next = f.prepare([
    ...history,
    f.message("answer", "already in native transcript"),
    f.message("next"),
  ]);
  expect(next.native.id).toBe("native-1");
  expect(JSON.parse(next.prompt)).toEqual([f.message("next")]);
  expect(next.prompt.length).toBeLessThan(200);
  next.finish("complete");
  const edited = f.prepare([
    { ...history[0], text: "corrected" },
    ...history.slice(1),
    f.message("next"),
  ]);
  expect(JSON.parse(edited.prompt)).toEqual([{ ...history[0], text: "corrected" }]);
});

it("isolates rooms, ducks, and changed provider configuration", () => {
  const f = fixture();
  const initial = f.prepare([f.message("old")]);
  initial.native.opened("native-1");
  initial.finish("complete");
  for (const next of [
    f.prepare([f.message("old")], "other-room"),
    f.prepare([f.message("old")], "room", { ...defaults[0], id: "other-duck" }),
    f.prepare([f.message("old")], "room", { ...defaults[0], model: "other-model" }),
    prepareReply(
      defaults[0],
      "changed persona",
      "",
      "/agent",
      inactiveParticipantTools,
      { roomId: "room", messages: [f.message("old")], makePrompt: JSON.stringify },
      f.store,
    ),
  ]) {
    expect(next.native.id).toBeUndefined();
    expect(next.prompt).toContain("old");
  }
});

it("preserves accepted input through a crash and does not drop unaccepted input on a failed resume", () => {
  const f = fixture();
  const first = f.prepare([f.message("old")]);
  first.native.opened("native-1");
  first.native.accepted();
  // No finish call, as if the process died.
  const resumed = f.prepare([f.message("old"), f.message("new")]);
  expect(JSON.parse(resumed.prompt)).toEqual([f.message("new")]);
  resumed.finish("error");
  const retry = f.prepare([f.message("old"), f.message("new")]);
  expect(retry.native.id).toBe("native-1");
  expect(retry.prompt).toBe(resumed.prompt);
});

it("does not deliver hidden reviews or advance delivery for thinking messages", () => {
  const f = fixture();
  const visible = [f.message("question")];
  const thinking = { ...f.message("peer"), status: "thinking" as const };
  const first = f.prepare(visibleMessages([...visible, thinking], "review"));
  first.native.opened("native-1");
  first.finish("complete");
  const next = f.prepare(
    visibleMessages([...visible, { ...thinking, status: "complete" }], "discussion"),
  );
  expect(JSON.parse(next.prompt)).toEqual([{ ...thinking, status: "complete" }]);
});

it("keeps system instructions stable when mode, roster, notes, and passing permission change", () => {
  const systems = (["conversation", "review", "discussion", "observer", "guide"] as const).map(
    (phase) =>
      makePrompt(
        defaults[0],
        [],
        phase,
        phase,
        phase === "review" ? defaults : [],
        phase === "review",
      ).system,
  );
  expect(new Set(systems).size).toBe(1);
  expect(makePrompt(defaults[0], [], "discussion", "", [], false).prompt).toContain("Do not PASS");
  expect(() => inactiveParticipantTools.call("ask_duck", {})).toThrow(
    "only during a mediated discussion",
  );
});

it("counts captured Codex inference usage once even when cumulative totals reset on reconnect", () => {
  const report = vi.fn();
  const tracker = codexUsageTracker(report);
  const previous = {
    inputTokens: 46862,
    outputTokens: 75,
    cachedInputTokens: 23168,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 15,
  };
  tracker.update({ total: previous, last: previous });
  tracker.start();
  const first = {
    inputTokens: 23506,
    outputTokens: 53,
    cachedInputTokens: 23296,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 22,
  };
  tracker.update({ total: first, last: first });
  tracker.update({ total: first, last: first });
  tracker.update({
    total: { ...first, inputTokens: 47095, outputTokens: 64, cachedInputTokens: 46592 },
    last: {
      inputTokens: 23589,
      outputTokens: 11,
      cachedInputTokens: 23296,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    },
  });
  expect(report).toHaveBeenCalledTimes(2);
  expect(report.mock.lastCall?.[0]).toEqual({
    input: 47095,
    output: 64,
    cacheRead: 46592,
    cacheWrite: 0,
    reasoning: 22,
  });
});

it("reports general usage including failed calls without treating missing counts as measured zero", () => {
  const f = fixture();
  const first = f.prepare([f.message("one")]);
  first.native.usage({ input: 100, output: 20, cacheRead: 80, cacheWrite: null, reasoning: null });
  first.finish("error");
  const next = f.prepare([f.message("two")]);
  next.finish("stopped");
  const records = [...f.usage.values()].map((value) => usageRecordSchema.parse(value));
  const report = usageReport(records);
  expect(report.totals).toMatchObject({
    calls: 2,
    failed: 1,
    stopped: 1,
    callsWithReportedTokens: 1,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 80,
    callsWithCacheWriteCounts: 0,
    callsWithReasoningCounts: 0,
  });
  expect(report.breakdown[0]).toMatchObject({ roomId: "room", duckId: defaults[0].id, calls: 2 });
  expect(z.array(usageRecordSchema).parse(records)[1].tokens).toBeNull();
});

it("includes Claude subagents in final usage without adding the main-loop count twice", () => {
  expect(
    claudeUsage(
      { input_tokens: 1, output_tokens: 2 },
      {
        main: {
          inputTokens: 1,
          outputTokens: 2,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 40,
        },
        helper: {
          inputTokens: 5,
          outputTokens: 6,
          cacheReadInputTokens: 70,
          cacheCreationInputTokens: 80,
        },
      },
    ),
  ).toEqual({ input: 226, output: 8, cacheRead: 100, cacheWrite: 120, reasoning: null });
});
