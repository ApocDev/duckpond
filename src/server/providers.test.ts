import type { ClaudeCodeSettings } from "ai-sdk-provider-claude-code";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { CodexPacket } from "./codex-client.server";
import { defaults } from "../lib/room";

const mocks = vi.hoisted(() => ({
  model: vi.fn((_model: string, _settings: ClaudeCodeSettings) => ({})),
  sessions: new Map<string, unknown>(),
  usage: new Map<string, unknown>(),
  failResume: false,
  request: vi.fn(),
  close: vi.fn(),
}));
vi.mock("ai-sdk-provider-claude-code", () => ({ createClaudeCode: () => mocks.model }));
vi.mock("ai", () => ({
  streamText: () => ({
    fullStream: (async function* () {
      const options = mocks.model.mock.lastCall?.[1];
      await options?.onSdkMessage?.({
        type: "system",
        subtype: "init",
        session_id: "claude-session",
        uuid: crypto.randomUUID(),
        apiKeySource: "none",
        claude_code_version: "test",
        cwd: "/agent",
        tools: [],
        mcp_servers: [],
        model: "fable",
        permissionMode: "default",
        slash_commands: [],
        output_style: "default",
        skills: [],
        plugins: [],
      });
      yield { type: "text-delta", text: "Done" };
    })(),
  }),
}));
vi.mock("./store.server", () => ({
  dataDirectory: "/tmp/duckpond-provider-tests",
  readProviderSession: (key: string) => structuredClone(mocks.sessions.get(key)),
  saveProviderSession: (key: string, value: unknown) => {
    mocks.sessions.set(key, structuredClone(value));
  },
  saveProviderUsage: (key: string, value: unknown) => {
    mocks.usage.set(key, structuredClone(value));
  },
}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("./codex-client.server", () => ({
  connectCodex: (
    _cwd: string,
    _signal: AbortSignal,
    receive: (packet: CodexPacket) => Promise<void>,
  ) => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "thread/resume" && mocks.failResume) throw new Error("Thread missing");
      if (method === "thread/start" || method === "thread/resume")
        return { thread: { id: "test-thread" } };
      if (method === "turn/start")
        await receive({ method: "turn/completed", params: { turn: { status: "completed" } } });
      return {};
    });
    return {
      initialize: async () => {},
      send: vi.fn(),
      request: mocks.request,
      close: mocks.close,
      disconnected: new Promise<never>(() => {}),
    };
  },
}));
import { reply } from "./providers.server";
import type { ReplyContext } from "./sessions.server";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessions.clear();
  mocks.usage.clear();
  mocks.failResume = false;
});

it("passes a duck's Claude model and effort to the native provider", async () => {
  await reply(
    { ...defaults[0], model: "fable[1m]", reasoning: "low" },
    "system",
    "prompt",
    new AbortController().signal,
    () => {},
    () => {},
  );
  expect(mocks.model).toHaveBeenCalledWith(
    "fable[1m]",
    expect.objectContaining({ effort: "low", settingSources: ["user", "project", "local"] }),
  );
});
it("passes a duck's Codex model and effort to its own thread and turn", async () => {
  await reply(
    { ...defaults[2], provider: "codex", model: "gpt-6-astra", reasoning: "medium" },
    "system",
    "prompt",
    new AbortController().signal,
    () => {},
    () => {},
  );
  expect(mocks.request).toHaveBeenCalledWith(
    "thread/start",
    expect.objectContaining({ model: "gpt-6-astra" }),
  );
  expect(mocks.request).toHaveBeenCalledWith(
    "turn/start",
    expect.objectContaining({ threadId: "test-thread", effort: "medium" }),
  );
  expect(mocks.close).toHaveBeenCalled();
});

it.each(["claude", "codex"] as const)(
  "%s receives its saved native session ID on the next reply",
  async (provider) => {
    const duck = { ...defaults[0], provider };
    const context: ReplyContext = {
      roomId: "test-room",
      messages: [],
      makePrompt: () => "small prompt",
    };
    const run = () =>
      reply(
        duck,
        "system",
        "",
        new AbortController().signal,
        () => {},
        () => {},
        undefined,
        context,
      );
    await run();
    await run();
    if (provider === "claude") {
      expect(mocks.model.mock.calls[0][1].resume).toBeUndefined();
      expect(mocks.model.mock.calls[1][1].resume).toBe("claude-session");
    } else {
      expect(mocks.request).toHaveBeenCalledWith(
        "thread/resume",
        expect.objectContaining({ threadId: "test-thread" }),
      );
      expect(mocks.request.mock.calls.filter(([method]) => method === "thread/start")).toHaveLength(
        1,
      );
    }
  },
);
it("does not start an expensive fresh conversation when Codex resume fails", async () => {
  const duck = { ...defaults[0], provider: "codex" as const };
  const context: ReplyContext = {
    roomId: "test-room",
    messages: [],
    makePrompt: () => "small prompt",
  };
  await reply(
    duck,
    "system",
    "",
    new AbortController().signal,
    () => {},
    () => {},
    undefined,
    context,
  );
  mocks.request.mockClear();
  mocks.failResume = true;
  await expect(
    reply(
      duck,
      "system",
      "",
      new AbortController().signal,
      () => {},
      () => {},
      undefined,
      context,
    ),
  ).rejects.toThrow("Thread missing");
  expect(mocks.request.mock.calls.map(([method]) => method)).toEqual(["thread/resume"]);
});
