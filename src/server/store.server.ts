import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defaults, roomSchema, type Room } from "../lib/room";

export const dataDirectory = process.env.DUCKPOND_DATA_DIR ?? join(process.cwd(), ".data");
mkdirSync(dataDirectory, { recursive: true });
const db = new DatabaseSync(join(dataDirectory, "duckpond.sqlite"));
db.exec(
  "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
);
const rowSchema = z.object({ payload: z.string() });

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
export function createRoom() {
  return saveRoom({
    id: crypto.randomUUID(),
    title: "New conversation",
    ducks: structuredClone(defaults),
    messages: [],
    notes: "",
    observe: false,
    updatedAt: new Date().toISOString(),
  });
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
