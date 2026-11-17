import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vite-plus/test";
import { defaults } from "../lib/room";

const directory = mkdtempSync(join(tmpdir(), "duckpond-pond-tests-"));
// A database from before ponds moved into it: only each pond folder's location was stored.
const legacyId = crypto.randomUUID();
const legacy = new DatabaseSync(join(directory, "duckpond.sqlite"));
legacy.exec(`
  CREATE TABLE rooms (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE pond_locations (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace TEXT NOT NULL UNIQUE);
`);
legacy.prepare("INSERT INTO pond_locations VALUES (?, ?, ?)").run(legacyId, "Five Nines", "/gone");
const room = {
  id: crypto.randomUUID(),
  pondId: legacyId,
  workspace: "/gone",
  title: "Old",
  ducks: [defaults[1]],
  messages: [],
  notes: "",
  updatedAt: new Date().toISOString(),
};
legacy
  .prepare("INSERT INTO rooms VALUES (?, ?, ?)")
  .run(room.id, JSON.stringify(room), room.updatedAt);
legacy.close();
vi.stubEnv("DUCKPOND_DATA_DIR", directory);
const { createRoom, db, getRoom } = await import("./store.server");
const { addPond, getPond, listPonds, updatePond, writePondNotes, sharedNotes } =
  await import("./ponds.server");
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it("moves folder ponds into the database with their conversation's ducks", () => {
  expect(getPond(legacyId)).toMatchObject({ name: "Five Nines", ducks: [defaults[1]], notes: "" });
  expect(
    db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'pond_locations'").get(),
  ).toBeUndefined();
});

it("starts conversations with a copy of the pond's ducks and rejects stale saves", () => {
  const pond = addPond("Game dev", defaults);
  expect(listPonds().map((item) => item.name)).toEqual(["Five Nines", "Game dev"]);
  const conversation = createRoom(pond.ducks, pond.id);
  const saved = updatePond(pond.id, pond.revision, "Games", [defaults[0]]);
  expect(saved).toMatchObject({ name: "Games", ducks: [defaults[0]] });
  expect(getRoom(conversation.id)).toMatchObject({ pondId: pond.id, ducks: defaults });
  expect(() => updatePond(pond.id, pond.revision, "Stale", defaults)).toThrow("pond changed");
});

it("keeps pond notes outside the revision and gives them to every conversation", () => {
  const pond = addPond("Notes", defaults);
  const saved = writePondNotes(pond.id, "  Use SQLite.  ");
  expect(saved).toMatchObject({ notes: "Use SQLite.", revision: pond.revision });
  const conversation = { ...createRoom(pond.ducks, pond.id), notes: "Due dates are optional." };
  expect(sharedNotes(conversation)).toContain("Use SQLite.");
  expect(sharedNotes(conversation)).toContain("Due dates are optional.");
  writePondNotes(pond.id, "");
  expect(sharedNotes(conversation)).toBe("Due dates are optional.");
});
