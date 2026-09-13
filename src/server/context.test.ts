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
const { buildHandoff, handoffCharacterBudget } = await import("./context.server");
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
  expect(result.prompt.length).toBeLessThan(handoffCharacterBudget);
  expect(result.prompt).toContain("constraint 599");
  expect(result.omitted).toBeGreaterThan(0);
  const files = readdirSync(join(directory, "context"));
  const archived = readFileSync(join(directory, "context", files[0]), "utf8")
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(archived).toEqual(JSON.parse(JSON.stringify(messages)));
});
it("retains the approval, its proposal, and recent dissent as original messages", () => {
  const message = (id: string, text: string, duckId?: string): Message => ({
    id,
    text,
    duckId,
    speaker: duckId ?? "You",
    status: "complete",
    phase: "discussion",
    createdAt: "",
  });
  const history = [
    ...Array.from({ length: 50 }, (_, i) =>
      message(`old-${i}`, "Old discussion. ".repeat(300), "explorer"),
    ),
    message(
      "proposal",
      "I can inspect the asset dimensions. I will not change the files.",
      "explorer",
    ),
    message("approval", "Go ahead."),
    message("dissent", "I still disagree with requiring every cable to be unwrapped.", "skeptic"),
  ];
  const { prompt } = buildHandoff(history, JSON.stringify);
  for (const item of history.slice(-3)) expect(prompt).toContain(item.text);
  expect(prompt.length).toBeLessThanOrEqual(handoffCharacterBudget);
  expect(prompt).toContain("not a generated summary");
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
