import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vite-plus/test";
import { defaults } from "../lib/room";

const directory = mkdtempSync(join(tmpdir(), "duckpond-pond-tests-"));
vi.stubEnv("DUCKPOND_DATA_DIR", join(directory, "data"));
const { openPond, getPond, listPonds, updatePond } = await import("./ponds.server");
const { createRoom, getRoom } = await import("./store.server");
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
function workspace() {
  return mkdtempSync(join(directory, "workspace-"));
}

it("loads editable persona files and copies current defaults into independent conversations", () => {
  const path = workspace();
  const original = openPond("Game dev", path, defaults);
  const manifest = JSON.parse(readFileSync(join(path, ".duckpond/pond.json"), "utf8"));
  expect(manifest).toMatchObject({ id: original.id, name: "Game dev" });
  expect(manifest.ducks[0]).not.toHaveProperty("instructions");
  expect(readFileSync(join(path, ".duckpond/ducks/explorer.md"), "utf8").trim()).toBe(
    defaults[0].instructions,
  );
  const conversation = createRoom(original.ducks, original);
  writeFileSync(join(path, ".duckpond/ducks/explorer.md"), "Protect enjoyable player decisions.\n");
  const updated = getPond(original.id);
  expect(updated.ducks[0].instructions).toBe("Protect enjoyable player decisions.");
  expect(updated.revision).not.toBe(original.revision);
  const fresh = createRoom(updated.ducks, updated);
  expect(fresh).toMatchObject({ pondId: original.id, workspace: path, messages: [], notes: "" });
  expect(fresh.ducks[0].instructions).toBe(updated.ducks[0].instructions);
  expect(getRoom(conversation.id).ducks).toEqual(defaults);
  expect(openPond("Ignore this name", path, [defaults[1]])).toEqual(updated);
});

it("rejects stale saves without overwriting external edits and keeps unlisted files", () => {
  const path = workspace();
  const pond = openPond("Review", path, defaults);
  const personaPath = join(path, ".duckpond/ducks/explorer.md");
  writeFileSync(personaPath, "An external persona edit.\n");
  expect(() => updatePond(pond.id, pond.revision, "Review", defaults)).toThrow("files changed");
  expect(readFileSync(personaPath, "utf8")).toBe("An external persona edit.\n");
  writeFileSync(join(path, ".duckpond/notes.txt"), "Keep this file");
  const current = getPond(pond.id);
  const saved = updatePond(current.id, current.revision, "New name", [current.ducks[0]]);
  expect(saved.name).toBe("New name");
  expect(saved.ducks).toHaveLength(1);
  expect(readFileSync(join(path, ".duckpond/notes.txt"), "utf8")).toBe("Keep this file");
  expect(readFileSync(join(path, ".duckpond/ducks/skeptic.md"), "utf8").trim()).toBe(
    defaults[1].instructions,
  );
});

it("reports broken ponds individually and refuses to overwrite an unrelated .duckpond directory", () => {
  const path = workspace();
  const pond = openPond("Broken", path, defaults);
  rmSync(join(path, ".duckpond/ducks/explorer.md"));
  expect(listPonds().find((item) => item.id === pond.id)?.error).toContain("explorer.md");
  expect(listPonds().some((item) => item.error === null)).toBe(true);
  expect(() => getPond(pond.id)).toThrow();
  const unrelated = workspace();
  mkdirSync(join(unrelated, ".duckpond"));
  writeFileSync(join(unrelated, ".duckpond/user-file"), "User-owned");
  expect(() => openPond("New", unrelated, defaults)).toThrow("contains files");
  expect(readFileSync(join(unrelated, ".duckpond/user-file"), "utf8")).toBe("User-owned");
  expect(() => openPond("Relative", "relative/path", defaults)).toThrow("absolute");
});

it("validates manifest handles and refuses to write through persona symlinks", () => {
  const path = workspace();
  const pond = openPond("Files", path, defaults);
  const personaPath = join(path, ".duckpond/ducks/explorer.md");
  const external = join(directory, "external-persona.md");
  writeFileSync(external, "External persona");
  rmSync(personaPath);
  symlinkSync(external, personaPath);
  const current = getPond(pond.id);
  expect(() => updatePond(current.id, current.revision, "Files", defaults)).toThrow(
    "symbolic link",
  );
  expect(readFileSync(external, "utf8")).toBe("External persona");
  const manifestPath = join(path, ".duckpond/pond.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.ducks[0].id = "../../outside";
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(() => getPond(pond.id)).toThrow();
});
