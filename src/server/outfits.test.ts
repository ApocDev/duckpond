import { PNG } from "pngjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vite-plus/test";
import { defaults, outfitSchema } from "../lib/room";
import type { CodexPacket } from "./codex-client.server";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), finish: vi.fn(), request: vi.fn() }));
const directory = mkdtempSync(join(tmpdir(), "duckpond-outfits-test-"));
vi.mock("./store.server", () => ({
  get dataDirectory() {
    return directory;
  },
}));
vi.mock("./codex-client.server", () => ({ connectCodex: mocks.connect }));
vi.mock("./sessions.server", () => ({
  prepareReply: () => ({ native: { usage: vi.fn() }, finish: mocks.finish }),
  codexUsageTracker: () => ({ start: vi.fn(), update: vi.fn() }),
}));
const { generateOutfit, avatarImage, listOutfits, startOutfit } = await import("./outfits.server");
const input = {
  roomId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  duck: defaults[0],
  description: "A headset and vest",
};
const png = readFileSync("design/duck-avatars/v1/base.png");
let receive: (packet: CodexPacket) => void;
function fake() {
  mocks.request.mockClear();
  mocks.connect.mockImplementation(
    (_cwd: string, _signal: AbortSignal, handler: typeof receive) => {
      receive = handler;
      mocks.request.mockImplementation(async (method: string) =>
        method === "thread/start" ? { thread: { id: "image-thread" } } : {},
      );
      return {
        initialize: async () => {},
        request: mocks.request,
        send: vi.fn(),
        close: vi.fn(),
        disconnected: new Promise<never>(() => {}),
      };
    },
  );
}
afterAll(() => rmSync(directory, { recursive: true, force: true }));
it("keeps one server-owned generation and exposes the saved result after completion", async () => {
  fake();
  const job = startOutfit(input);
  expect(startOutfit(input).id).toBe(job.id);
  await vi.waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        input: expect.arrayContaining([
          expect.objectContaining({ type: "localImage" }),
          expect.objectContaining({ type: "skill", name: "imagegen" }),
        ]),
      }),
    ),
  );
  receive({
    method: "item/completed",
    params: { item: { type: "imageGeneration", result: png.toString("base64"), failure: null } },
  });
  receive({ method: "turn/completed", params: { turn: { status: "completed" } } });
  await vi.waitFor(() => expect(listOutfits(input.roomId)[0].status).toBe("complete"));
  expect(avatarImage(job.id)).toEqual(png);
  expect(listOutfits("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toEqual([]);
  expect(outfitSchema.parse(`generated-${job.id}`)).toBe(`generated-${job.id}`);
  expect(() => avatarImage("../../secret")).toThrow();
  expect(mocks.finish).toHaveBeenCalledWith("complete");
});
it("reports a native image failure without accepting an agent's claim of success", async () => {
  fake();
  const task = generateOutfit(input, crypto.randomUUID());
  const rejected = expect(task).rejects.toThrow("Image generation unavailable");
  await vi.waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith("turn/start", expect.anything()),
  );
  receive({
    method: "item/completed",
    params: { item: { type: "agentMessage", text: "Image generation unavailable" } },
  });
  receive({ method: "turn/completed", params: { turn: { status: "completed" } } });
  await rejected;
  expect(mocks.finish).toHaveBeenCalledWith("error");
});
it("marks unfinished jobs recoverable after a server restart", () => {
  const id = crypto.randomUUID();
  writeFileSync(
    join(directory, "avatars", `${id}.json`),
    JSON.stringify({
      id,
      roomId: input.roomId,
      duckId: "other",
      description: "",
      status: "running",
    }),
  );
  expect(listOutfits(input.roomId).find((job) => job.id === id)).toMatchObject({
    status: "error",
    error: expect.stringContaining("restarted"),
  });
});

it("corrects an opaque image once and saves only the transparent result", async () => {
  fake();
  const id = crypto.randomUUID();
  const task = generateOutfit(input, id);
  await vi.waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith("turn/start", expect.anything()),
  );
  const opaque = new PNG({ width: 1, height: 1 });
  opaque.data.fill(255);
  receive({
    method: "item/completed",
    params: {
      item: { type: "imageGeneration", result: PNG.sync.write(opaque).toString("base64") },
    },
  });
  receive({ method: "turn/completed", params: { turn: { status: "completed" } } });
  await vi.waitFor(() =>
    expect(mocks.request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(2),
  );
  receive({
    method: "item/completed",
    params: { item: { type: "imageGeneration", result: png.toString("base64") } },
  });
  receive({ method: "turn/completed", params: { turn: { status: "completed" } } });
  await task;
  expect(avatarImage(id)).toEqual(png);
});
