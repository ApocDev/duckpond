import { expect, it, vi } from "vite-plus/test";
import type { CodexPacket } from "./codex-client.server";
import { defaults } from "../lib/room";

const mocks = vi.hoisted(() => ({
  model: vi.fn(() => ({})),
  request: vi.fn(),
  close: vi.fn(),
}));
vi.mock("ai-sdk-provider-claude-code", () => ({ createClaudeCode: () => mocks.model }));
vi.mock("ai", () => ({ streamText: () => ({ fullStream: [] }) }));
vi.mock("./store.server", () => ({ dataDirectory: "/tmp/duckpond-provider-tests" }));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("./codex-client.server", () => ({
  connectCodex: (
    _cwd: string,
    _signal: AbortSignal,
    receive: (packet: CodexPacket) => Promise<void>,
  ) => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "thread/start") return { thread: { id: "test-thread" } };
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
