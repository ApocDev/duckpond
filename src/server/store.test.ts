import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import { combineDucks, defaults, ducksSchema, isUntouchedRoom } from "../lib/room";

const directory = mkdtempSync(join(tmpdir(), "duckpond-store-test-"));
vi.stubEnv("DUCKPOND_DATA_DIR", directory);
const store = await import("./store.server");
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("conversation storage", () => {
  it("discards only untouched rooms, including after reloading from SQLite", () => {
    const empty = store.createRoom();
    expect(isUntouchedRoom(store.getRoom(empty.id))).toBe(true);
    expect(store.deleteRoom(empty.id, true)).toBe(true);
    expect(store.listDuckGroups().some((group) => group.id === empty.id)).toBe(false);

    const changes = [
      { notes: "Keep the tutorial short" },
      { observe: true },
      { ducks: [{ ...defaults[0], instructions: "Focus on game design" }] },
      {
        messages: [
          {
            id: "message",
            speaker: "You",
            text: "Hi",
            status: "complete" as const,
            phase: "conversation" as const,
            createdAt: "",
          },
        ],
      },
    ];
    for (const change of changes) {
      const room = store.saveRoom({ ...store.createRoom(), ...change });
      expect(store.deleteRoom(room.id, true)).toBe(false);
      expect(store.getRoom(room.id)).toEqual(room);
    }
  });

  it("keeps reusable ducks after deleting a conversation and creates fresh, independent rooms", () => {
    const original = store.saveRoom({
      ...store.createRoom([
        { ...defaults[0], name: "Game designer", avatar: "wizard", reasoning: "medium" },
      ]),
      title: "Garage tutorial",
      notes: "Private notes",
      messages: [
        {
          id: "message",
          speaker: "You",
          text: "Old conversation",
          status: "complete",
          phase: "conversation",
          createdAt: "",
        },
      ],
    });
    store.saveProviderSession(`${original.id}/${original.ducks[0].id}`, {
      transcript: "old-session",
    });
    store.saveProviderSession("other-room/explorer", { transcript: "other-session" });
    expect(store.listDuckGroups().find((group) => group.id === original.id)?.ducks).toEqual(
      original.ducks,
    );
    expect(store.deleteRoom(original.id)).toBe(true);
    expect(() => store.getRoom(original.id)).toThrow("Conversation not found");
    expect(store.readProviderSession(`${original.id}/${original.ducks[0].id}`)).toBeUndefined();
    expect(store.readProviderSession("other-room/explorer")).toEqual({
      transcript: "other-session",
    });
    const group = store.listDuckGroups().find((item) => item.id === original.id)!;
    expect(Object.keys(group).sort()).toEqual(["ducks", "id", "title"]);
    expect(group.ducks).toEqual(original.ducks);
    const fresh = store.createRoom(group.ducks);
    expect(fresh.id).not.toBe(original.id);
    expect(fresh.messages).toEqual([]);
    expect(fresh.notes).toBe("");
    fresh.ducks[0].instructions = "Changed only here";
    store.saveRoom(fresh);
    expect(store.listDuckGroups().find((item) => item.id === original.id)?.ducks).toEqual(
      original.ducks,
    );
    expect(store.deleteRoom(original.id)).toBe(false);
  });

  it("deduplicates identical ducks and gives different personas distinct handles", () => {
    const changed = { ...defaults[0], instructions: "A different perspective" };
    const ducks = combineDucks([defaults[0], { ...defaults[0], id: "another-id" }, changed]);
    expect(ducks).toHaveLength(2);
    expect(ducks[0]).toEqual(defaults[0]);
    expect(ducks[1].instructions).toBe(changed.instructions);
    expect(ducks[1].id).not.toBe(ducks[0].id);
    expect(ducksSchema.safeParse(ducks).success).toBe(true);
  });
});
