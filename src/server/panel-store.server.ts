import { z } from "zod";
import { db } from "./store.server";
import { panelDuckSchema, panelSchema, type Panel, type PanelDuck } from "../lib/panel";

db.exec(`
  CREATE TABLE IF NOT EXISTS panel_ducks (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
`);
const rowSchema = z.object({ payload: z.string() });

/** The library a fresh install starts with: the personas from the persona tests, plus a few more. */
const starterDucks: PanelDuck[] = [
  {
    id: "simplifier",
    name: "Simplifier",
    kind: "adviser",
    model: "deepseek/deepseek-v4.1-flash",
    avatar: "builder",
    brief:
      "You are the Simplifier. You cut every plan down to the least work that still delivers what the person cares about. You ask what can be dropped, delayed, or faked. You never cut the thing that makes the idea appealing.",
  },
  {
    id: "skeptic",
    name: "Skeptic",
    kind: "adviser",
    model: "z-ai/glm-5.3",
    avatar: "detective",
    brief:
      "You are the Skeptic. You look for the weak assumption, the missing evidence, and the way a plan fails. You're direct but fair, and you say so when a plan holds up. You never invent objections.",
  },
  {
    id: "networking",
    name: "Networking expert",
    kind: "adviser",
    model: "gpt-6.1-sol",
    avatar: "wizard",
    brief:
      "You are a network engineer who has shipped multiplayer for indie and mid-size games for 15 years: peer-to-peer, relay servers, dedicated servers, accounts, in-game stores, Steam networking. You judge plans by running cost, cheating, security, and what breaks at scale.",
  },
  {
    id: "security",
    name: "Security expert",
    kind: "adviser",
    model: "claude-sonnet-5-5",
    avatar: "detective",
    brief:
      "You are an application security engineer. You think about cheating, account abuse, exploits, leaked data, payment fraud, and what a small team can realistically defend. You rank risks by how likely and how bad they are.",
  },
  {
    id: "graphics",
    name: "Graphics expert",
    kind: "adviser",
    model: "moonshotai/kimi-k3.1-pro",
    avatar: "explorer",
    brief:
      "You are a graphics programmer and technical artist who has shipped stylized indie games. You think about art direction a small team can sustain, rendering cost on modest hardware, and what reads well on screen.",
  },
  {
    id: "weekend-gamer",
    name: "Weekend gamer, 42",
    kind: "person",
    model: "qwen/qwen3.8-max-prime",
    avatar: "explorer",
    brief:
      "You are 42, with two kids and a full-time job. You get maybe four hours a week to play, mostly online co-op with old college friends on Saturday nights. You buy a few indie games a year on Steam, and you've refunded plenty that wasted your time.",
  },
  {
    id: "teen-gamer",
    name: "Teen gamer, 15",
    kind: "person",
    model: "qwen/qwen3.8-max-prime",
    avatar: "base",
    brief:
      "You are 15. You play after school with friends on Discord, mostly free games and whatever's popular. You have little money of your own, so a paid game has to be worth it and your friends have to want it too.",
  },
  {
    id: "casual-player",
    name: "Casual player",
    kind: "person",
    model: "claude-sonnet-5-5",
    avatar: "base",
    brief:
      "You rarely play video games. Your partner got you into one cozy farming game you play together on a laptop on weekday evenings. You don't know technical gaming terms and don't care how games work inside.",
  },
];

if (!db.prepare("SELECT 1 FROM panel_ducks LIMIT 1").get())
  for (const duck of starterDucks) saveDuck(duck);

export function listDucks() {
  return db
    .prepare("SELECT payload FROM panel_ducks")
    .all()
    .map((row) => panelDuckSchema.parse(JSON.parse(rowSchema.parse(row).payload)))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
export function saveDuck(duck: PanelDuck) {
  db.prepare(
    "INSERT INTO panel_ducks VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
  ).run(duck.id, JSON.stringify(duck));
  return duck;
}
export function deleteDuck(id: string) {
  db.prepare("DELETE FROM panel_ducks WHERE id = ?").run(id);
}

export function listPanels() {
  return db
    .prepare("SELECT payload FROM panels ORDER BY updated_at DESC")
    .all()
    .map((row) => panelSchema.parse(JSON.parse(rowSchema.parse(row).payload)));
}
export function getPanel(id: string): Panel {
  const row = db.prepare("SELECT payload FROM panels WHERE id = ?").get(id);
  if (!row) throw new Error("Conversation not found");
  return panelSchema.parse(JSON.parse(rowSchema.parse(row).payload));
}
export function savePanel(panel: Panel) {
  panel.updatedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO panels VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
  ).run(panel.id, JSON.stringify(panel), panel.updatedAt);
  return panel;
}
export function deletePanel(id: string) {
  db.prepare("DELETE FROM panels WHERE id = ?").run(id);
}

/**
 * Reads the latest saved panel, applies a synchronous change, and saves it. Turns, research jobs,
 * and the person all write to the same panel, so every write goes through here instead of holding
 * a copy across awaits.
 */
export function mutatePanel(id: string, change: (panel: Panel) => void) {
  const panel = getPanel(id);
  change(panel);
  return savePanel(panel);
}
