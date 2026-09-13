import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
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
const db = new DatabaseSync(join(dataDirectory, "duckpond.sqlite"));
db.exec(
  "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
);
const rowSchema = z.object({ payload: z.string() });

// Only the location is indexed here. Pond settings and personas are read from the workspace.
db.exec(
  "CREATE TABLE IF NOT EXISTS pond_locations (id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace TEXT NOT NULL UNIQUE)",
);
const pondLocationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  workspace: z.string(),
});
export function listPondLocations() {
  return db
    .prepare("SELECT * FROM pond_locations ORDER BY name")
    .all()
    .map((row) => pondLocationSchema.parse(row));
}
export function registerPond(pond: z.infer<typeof pondLocationSchema>) {
  const locations = listPondLocations();
  const previous = locations.find((item) => item.id === pond.id);
  if (previous && previous.workspace !== pond.workspace)
    throw new Error("This pond is already open from another directory.");
  if (locations.some((item) => item.workspace === pond.workspace && item.id !== pond.id))
    throw new Error(
      "This directory is already registered to a different pond. Restore its pond.json.",
    );
  db.prepare(
    "INSERT INTO pond_locations VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
  ).run(pond.id, pond.name, pond.workspace);
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
export function createRoom(ducks: Duck[] = defaults, pond?: { id: string; workspace: string }) {
  return saveRoom({
    id: crypto.randomUUID(),
    ...(pond ? { pondId: pond.id, workspace: pond.workspace } : {}),
    title: "New conversation",
    ducks: structuredClone(ducks),
    messages: [],
    notes: "",
    observe: false,
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
