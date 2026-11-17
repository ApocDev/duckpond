import { z } from "zod";
import { pondSchema, type Pond } from "../lib/pond";
import type { Duck, Room } from "../lib/room";
import { db } from "./store.server";

const rowSchema = z.object({ payload: z.string() });

function savePond(pond: Pond) {
  db.prepare(
    "INSERT INTO ponds VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
  ).run(pond.id, JSON.stringify(pondSchema.parse(pond)));
  return pond;
}

export function getPond(id: string) {
  const row = db.prepare("SELECT payload FROM ponds WHERE id = ?").get(id);
  if (!row) throw new Error("Pond not found");
  return pondSchema.parse(JSON.parse(rowSchema.parse(row).payload));
}

export function listPonds() {
  return db
    .prepare("SELECT payload FROM ponds")
    .all()
    .map((row) => pondSchema.parse(JSON.parse(rowSchema.parse(row).payload)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addPond(name: string, ducks: Duck[]) {
  return savePond({
    id: crypto.randomUUID(),
    name,
    ducks,
    notes: "",
    revision: crypto.randomUUID(),
  });
}

/** Saves the pond's name and starting ducks, unless someone else saved them since `revision`. */
export function updatePond(id: string, revision: string, name: string, ducks: Duck[]) {
  const previous = getPond(id);
  if (previous.revision !== revision)
    throw new Error("The pond changed. Close the editor and reopen it before saving.");
  return savePond({ ...previous, name, ducks, revision: crypto.randomUUID() });
}

// Notes keep the revision, so saving them never conflicts with an open Ducks editor.
export function writePondNotes(id: string, notes: string) {
  return savePond({ ...getPond(id), notes: notes.trim() });
}

/** What ducks read as shared notes: the pond's notes, then this conversation's. */
export function sharedNotes(room: Room) {
  if (!room.pondId) return room.notes;
  let pond = "";
  try {
    pond = getPond(room.pondId).notes;
  } catch {
    // A pond that can't be read has no notes to add; the turn still runs.
  }
  if (!pond) return room.notes;
  return `Pond notes, for every conversation in this project:\n${pond}\n\nThis conversation's notes:\n${room.notes || "(none)"}`;
}
