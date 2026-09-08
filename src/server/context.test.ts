import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, expect, it, vi } from "vite-plus/test";
import type { Message } from "../lib/room";
const directory = mkdtempSync(join(tmpdir(), "duckpond-context-test-"));
vi.mock("./store.server", () => ({
  get dataDirectory() {
    return directory;
  },
}));
const { buildHandoff, promptCharacterBudget } = await import("./context.server");
afterAll(() => rmSync(directory, { recursive: true, force: true }));
it("bounds a handoff and keeps every visible message searchable without truncating records", () => {
  const messages: Message[] = Array.from({ length: 600 }, (_, index) => ({
    id: String(index),
    speaker: index % 2 ? "Duck" : "You",
    duckId: index % 2 ? "explorer" : undefined,
    text: `constraint ${index} ` + "x".repeat(2000),
    status: "complete",
    phase: "discussion",
    createdAt: "",
  }));
  const result = buildHandoff(messages, JSON.stringify);
  expect(result.prompt.length).toBeLessThan(promptCharacterBudget);
  expect(result.prompt).toContain("constraint 599");
  expect(result.omitted).toBeGreaterThan(0);
  const files = readdirSync(join(directory, "context"));
  const archived = readFileSync(join(directory, "context", files[0]), "utf8")
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(archived).toEqual(JSON.parse(JSON.stringify(messages)));
});
it("names an oversized latest human message for mandatory lookup instead of clipping it", () => {
  const result = buildHandoff(
    [
      {
        id: "long-human-request",
        speaker: "You",
        text: "x".repeat(1100000),
        status: "complete",
        phase: "conversation",
        createdAt: "",
      },
    ],
    JSON.stringify,
  );
  expect(result.prompt).toContain("long-human-request is in the archive and MUST be read");
});
