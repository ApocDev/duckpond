import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { pondSchema } from "../lib/pond";
import {
  defaults,
  duckGroupSchema,
  isUntouchedRoom,
  roomSchema,
  type Duck,
  type Room,
} from "../lib/room";

export const dataDirectory = process.env.DUCKPOND_DATA_DIR ?? join(process.cwd(), ".data");
mkdirSync(dataDirectory, { recursive: true });
export const db = new DatabaseSync(join(dataDirectory, "duckpond.sqlite"));
db.exec(
  "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
);
const rowSchema = z.object({ payload: z.string() });

db.exec("CREATE TABLE IF NOT EXISTS ponds (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
// Ponds used to live in project folders, indexed by pond_locations. Each one moves into the
// database once, with the ducks of its most recent conversation, since its folder may not be on
// this machine.
if (
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pond_locations'").get()
) {
  const rooms = listRooms();
  const locations = z
    .array(z.object({ id: z.string(), name: z.string() }))
    .parse(db.prepare("SELECT id, name FROM pond_locations").all());
  const insert = db.prepare("INSERT OR IGNORE INTO ponds VALUES (?, ?)");
  db.exec("BEGIN");
  for (const { id, name } of locations)
    insert.run(
      id,
      JSON.stringify(
        pondSchema.parse({
          id,
          name,
          ducks: rooms.find((room) => room.pondId === id)?.ducks ?? defaults,
          revision: crypto.randomUUID(),
        }),
      ),
    );
  db.exec("DROP TABLE pond_locations; COMMIT");
}

export function listRooms() {
  return db
    .prepare("SELECT payload FROM rooms ORDER BY updated_at DESC")
    .all()
    .map((row) => roomSchema.parse(JSON.parse(rowSchema.parse(row).payload)));
}
export function getRoom(id: string): Room {
  const row = db.prepare("SELECT payload FROM rooms WHERE id = ?").get(id);
  if (!row) throw new Error("Conversation not found");
  return roomSchema.parse(JSON.parse(rowSchema.parse(row).payload));
}
export function saveRoom(room: Room) {
  room.updatedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO rooms VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
  ).run(room.id, JSON.stringify(room), room.updatedAt);
  return room;
}
export function createRoom(ducks: Duck[] = defaults, pondId?: string) {
  return saveRoom({
    id: crypto.randomUUID(),
    pondId,
    title: "New conversation",
    ducks: structuredClone(ducks),
    messages: [],
    notes: "",
    updatedAt: new Date().toISOString(),
  });
}

// Keep reusable rosters after their conversation is deleted, without retaining its messages.
db.exec(
  "CREATE TABLE IF NOT EXISTS saved_duck_groups (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
);

export function listDuckGroups() {
  return [
    ...listRooms()
      .filter((room) => !isUntouchedRoom(room))
      .map((room) => duckGroupSchema.parse(room)),
    ...db
      .prepare("SELECT payload FROM saved_duck_groups ORDER BY rowid DESC")
      .all()
      .map((row) => duckGroupSchema.parse(JSON.parse(rowSchema.parse(row).payload))),
  ];
}

export function deleteRoom(id: string, onlyIfUntouched = false) {
  const row = db.prepare("SELECT payload FROM rooms WHERE id = ?").get(id);
  if (!row) return false;
  const room = roomSchema.parse(JSON.parse(rowSchema.parse(row).payload));
  if (onlyIfUntouched && !isUntouchedRoom(room)) return false;
  db.exec("BEGIN");
  try {
    if (!isUntouchedRoom(room)) {
      db.prepare("INSERT OR REPLACE INTO saved_duck_groups VALUES (?, ?)").run(
        id,
        JSON.stringify(duckGroupSchema.parse(room)),
      );
    }
    db.prepare("DELETE FROM provider_sessions WHERE substr(id, 1, ?) = ?").run(
      id.length + 1,
      `${id}/`,
    );
    db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Provider transcripts live in the native CLIs; SQLite stores their IDs and delivery cursors.
db.exec(`
  CREATE TABLE IF NOT EXISTS provider_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS provider_usage (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
`);
export function readProviderSession(id: string): unknown {
  const row = db.prepare("SELECT payload FROM provider_sessions WHERE id = ?").get(id);
  return row ? JSON.parse(rowSchema.parse(row).payload) : undefined;
}
export function saveProviderSession(id: string, payload: unknown) {
  db.prepare(
    "INSERT INTO provider_sessions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
  ).run(id, JSON.stringify(payload));
}
export function saveProviderUsage(id: string, payload: unknown) {
  db.prepare(
    "INSERT INTO provider_usage VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
  ).run(id, JSON.stringify(payload));
}
export function listProviderUsage(): unknown[] {
  return db
    .prepare("SELECT payload FROM provider_usage ORDER BY rowid")
    .all()
    .map((row) => JSON.parse(rowSchema.parse(row).payload));
}

db.exec(
  "CREATE TABLE IF NOT EXISTS command_permissions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
);
const permissionSchema = z.object({
  id: z.string(),
  command: z.string(),
  cwd: z.string(),
  provider: z.string(),
});
export function hasCommandPermission(id: string) {
  return !!db.prepare("SELECT id FROM command_permissions WHERE id = ?").get(id);
}
export function saveCommandPermission(permission: z.infer<typeof permissionSchema>) {
  db.prepare("INSERT OR REPLACE INTO command_permissions VALUES (?, ?)").run(
    permission.id,
    JSON.stringify(permission),
  );
}
export function listCommandPermissions() {
  return db
    .prepare("SELECT payload FROM command_permissions ORDER BY rowid")
    .all()
    .map((row) => permissionSchema.parse(JSON.parse(rowSchema.parse(row).payload)));
}
export function deleteCommandPermission(id: string) {
  db.prepare("DELETE FROM command_permissions WHERE id = ?").run(id);
}
