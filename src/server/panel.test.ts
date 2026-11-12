import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import type { Brief } from "../lib/panel";

const directory = mkdtempSync(join(tmpdir(), "duckpond-panel-test-"));
vi.stubEnv("DUCKPOND_DATA_DIR", directory);
const store = await import("./panel-store.server");
const { runTurn } = await import("./panel.server");
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

const brief: Brief = {
  headline: "Two of three say ship it.",
  options: [{ label: "Ship", duckIds: ["simplifier", "nobody"] }],
  agreed: [],
  facts: [],
  values: [],
  question: "Ship now?",
  research: "Do demos help?",
};

function panelWith(text: string) {
  const turnId = crypto.randomUUID();
  const panel = store.savePanel({
    id: crypto.randomUUID(),
    title: "Test",
    duckIds: ["simplifier", "skeptic", "teen-gamer"],
    turns: [
      {
        id: turnId,
        text,
        to: "panel",
        status: "running",
        rounds: [],
        research: [],
        briefCost: 0,
        createdAt: "",
      },
    ],
    decisions: [],
    updatedAt: "",
  });
  return { panelId: panel.id, turnId };
}

/** A fake model: each duck's replies in order, by persona name in the system prompt. */
function scripted(replies: Record<string, string[]>) {
  const calls: string[] = [];
  return {
    calls,
    ask: async ({ system, json }: { system: string; json?: unknown }) => {
      if (json) return { text: JSON.stringify(brief), cost: 0.01 };
      const id = Object.keys(replies).find((key) => system.includes(key))!;
      calls.push(id);
      return { text: replies[id].shift() ?? "NOTHING TO ADD.\nPOSITION: same", cost: 0.001 };
    },
  };
}

describe("panel turns", () => {
  it("reacts until a round where nobody changes their mind, then writes the brief", async () => {
    const { panelId, turnId } = panelWith("Ship it?");
    const model = scripted({
      Simplifier: [
        "Ship.\nPOSITION: ship",
        "CHANGED: Skeptic is right.\nPOSITION: wait",
        "NOTHING TO ADD.\nPOSITION: wait",
      ],
      Skeptic: [
        "Wait.\nPOSITION: wait",
        "STILL DISAGREE: with Simplifier.\nPOSITION: wait",
        "NOTHING TO ADD.\nPOSITION: wait",
      ],
      "You are 15": ["PASS"],
    });
    const research = vi.fn(() => "");
    await runTurn(panelId, turnId, { ask: model.ask, research });

    const turn = store.getPanel(panelId).turns[0];
    expect(turn.status).toBe("done");
    // Round 1 blind, round 2 has a change, round 3 has none and stops.
    expect(turn.rounds.map((round) => round.length)).toEqual([3, 2, 2]);
    expect(turn.rounds[0].find((reply) => reply.duckId === "teen-gamer")?.status).toBe("passed");
    expect(turn.stopReason).toMatch(/round 3/);
    // A duck Mediator made up is dropped from the brief.
    expect(turn.brief?.options[0].duckIds).toEqual(["simplifier"]);
    expect(research).toHaveBeenCalledWith(panelId, turnId, "Do demos help?");
  });

  it("skips reactions and the brief when only one duck has something to add", async () => {
    const { panelId, turnId } = panelWith("Quick follow-up");
    const model = scripted({
      Simplifier: ["Yes, do that."],
      Skeptic: ["PASS"],
      "You are 15": ["PASS"],
    });
    await runTurn(panelId, turnId, { ask: model.ask, research: vi.fn(() => "") });

    const turn = store.getPanel(panelId).turns[0];
    expect(turn.rounds).toHaveLength(1);
    expect(turn.brief).toBeUndefined();
    expect(turn.stopReason).toBe("Only one duck had something to add.");
  });
});
