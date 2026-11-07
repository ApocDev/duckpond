import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { pondManifestSchema, pondSchema, type Pond } from "../lib/pond";
import { type Duck, type Room } from "../lib/room";
import { listPondLocations, registerPond } from "./store.server";

function workspaceDirectory(workspace: string) {
  if (!isAbsolute(workspace)) throw new Error("Use the folder's full path, starting with /.");
  if (!existsSync(workspace)) throw new Error("That folder doesn't exist. Check the path.");
  const resolved = realpathSync(workspace);
  if (!statSync(resolved).isDirectory()) throw new Error("That path is a file, not a folder.");
  return resolved;
}

function readPond(workspace: string): Pond {
  const directory = join(workspace, ".duckpond");
  const manifestText = readFileSync(join(directory, "pond.json"), "utf8");
  const manifest = pondManifestSchema.parse(JSON.parse(manifestText));
  const hash = createHash("sha256").update(manifestText);
  const ducks = manifest.ducks.map((duck) => {
    const instructions = readFileSync(join(directory, "ducks", `${duck.id}.md`), "utf8");
    hash.update(instructions);
    return { ...duck, instructions };
  });
  // Notes stay out of the revision, so saving them never conflicts with an open Ducks editor.
  const notesPath = join(directory, "notes.md");
  const notes = existsSync(notesPath) ? readFileSync(notesPath, "utf8").trim() : "";
  return pondSchema.parse({ ...manifest, workspace, ducks, notes, revision: hash.digest("hex") });
}

export function getPond(id: string) {
  const location = listPondLocations().find((pond) => pond.id === id);
  if (!location) throw new Error("Pond not found");
  const pond = readPond(workspaceDirectory(location.workspace));
  if (pond.id !== id) throw new Error("The workspace contains a different pond.");
  return pond;
}

export function listPonds() {
  return listPondLocations().map((location) => {
    try {
      return { ...getPond(location.id), error: null };
    } catch (error) {
      return {
        ...location,
        ducks: [] as Duck[],
        notes: "",
        revision: "",
        error: error instanceof Error ? error.message : "Couldn't read this pond.",
      };
    }
  });
}

function rejectSymlink(path: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink())
    throw new Error(`Cannot save through a symbolic link: ${path}`);
}

/** Replace individual files atomically; unlisted persona files remain untouched. */
function writePond(pond: Omit<Pond, "revision" | "notes">) {
  const directory = join(pond.workspace, ".duckpond");
  const ducksDirectory = join(directory, "ducks");
  rejectSymlink(directory);
  rejectSymlink(ducksDirectory);
  const manifest = pondManifestSchema.parse({ ...pond, ducks: pond.ducks });
  const files = [
    ...pond.ducks.map(
      (duck) => [join(ducksDirectory, `${duck.id}.md`), `${duck.instructions.trim()}\n`] as const,
    ),
    [join(directory, "pond.json"), `${JSON.stringify(manifest, null, 2)}\n`] as const,
  ];
  for (const [path] of files) {
    rejectSymlink(path);
    if (existsSync(path) && !statSync(path).isFile())
      throw new Error(`Expected a persona file: ${path}`);
  }
  mkdirSync(ducksDirectory, { recursive: true });
  const staged = files.map(([path, content]) => ({
    path,
    content,
    temporary: `${path}.${crypto.randomUUID()}.tmp`,
  }));
  try {
    for (const { temporary, content } of staged) {
      writeFileSync(temporary, content, { flag: "wx" });
    }
    for (const { temporary, path } of staged) renameSync(temporary, path);
  } finally {
    for (const { temporary } of staged) rmSync(temporary, { force: true });
  }
  const saved = readPond(pond.workspace);
  registerPond(saved);
  return saved;
}

export function openPond(name: string, workspace: string, ducks: Duck[]) {
  workspace = workspaceDirectory(workspace);
  const directory = join(workspace, ".duckpond");
  if (existsSync(join(directory, "pond.json"))) {
    const pond = readPond(workspace);
    registerPond(pond);
    return pond;
  }
  if (listPondLocations().some((pond) => pond.workspace === workspace))
    throw new Error(
      "This pond's manifest is missing. Restore .duckpond/pond.json before opening it.",
    );
  if (existsSync(directory) && readdirSync(directory).length)
    throw new Error(
      "The .duckpond directory contains files but no pond.json. Choose another workspace or restore its manifest.",
    );
  return writePond({ id: crypto.randomUUID(), name, workspace, ducks });
}

export function updatePond(id: string, revision: string, name: string, ducks: Duck[]) {
  const previous = getPond(id);
  if (previous.revision !== revision)
    throw new Error("The pond files changed. Close the editor and reopen it before saving.");
  return writePond({ ...previous, name, ducks });
}

export function writePondNotes(id: string, notes: string) {
  const { workspace } = getPond(id);
  const directory = join(workspace, ".duckpond");
  const path = join(directory, "notes.md");
  rejectSymlink(directory);
  rejectSymlink(path);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, notes.trim() ? `${notes.trim()}\n` : "", { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return getPond(id);
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
