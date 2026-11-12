import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { panelDuckSchema } from "../lib/panel";
import { shortTitle } from "../lib/room";
import { requireAllowedRequest } from "./access.server";
import { hasOpenRouterKey } from "./openrouter.server";
import {
  deleteDuck,
  deletePanel,
  getPanel,
  listDucks,
  listPanels,
  mutatePanel,
  saveDuck,
  savePanel,
} from "./panel-store.server";
import { activeTurns, recoverPanel, runTurn, startResearch, stopPanel } from "./panel.server";
import { listPonds } from "./ponds.server";

const allowed = () => requireAllowedRequest(getRequest());
const id = z.string().uuid();

function loadPanel(panelId: string) {
  const panel = getPanel(panelId);
  return recoverPanel(panel) ? savePanel(panel) : panel;
}

/** Everything the panel page needs on load: conversations, the duck library, and ponds. */
export const loadPanelApp = createServerFn({ method: "GET" }).handler(() => {
  allowed();
  return {
    panels: listPanels().map((panel) => ({
      id: panel.id,
      title: panel.title,
      updatedAt: panel.updatedAt,
      running: activeTurns.has(panel.id),
    })),
    ducks: listDucks(),
    ponds: listPonds()
      .filter((pond) => !pond.error)
      .map((pond) => ({ id: pond.id, name: pond.name })),
    hasKey: hasOpenRouterKey(),
  };
});

export const fetchPanel = createServerFn({ method: "GET" })
  .validator(id)
  .handler(({ data }) => {
    allowed();
    return loadPanel(data);
  });

export const createPanel = createServerFn({ method: "POST" })
  .validator(z.object({ duckIds: z.array(z.string()).min(1), pondId: id.optional() }))
  .handler(({ data }) => {
    allowed();
    return savePanel({
      id: crypto.randomUUID(),
      title: "New conversation",
      pondId: data.pondId,
      duckIds: data.duckIds,
      turns: [],
      decisions: [],
      updatedAt: new Date().toISOString(),
    });
  });

export const updatePanel = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id,
      duckIds: z.array(z.string()).min(1).optional(),
      pondId: id.nullable().optional(),
      title: z.string().trim().min(1).max(80).optional(),
    }),
  )
  .handler(({ data }) => {
    allowed();
    return mutatePanel(data.id, (panel) => {
      if (data.duckIds) panel.duckIds = data.duckIds;
      if (data.pondId !== undefined) panel.pondId = data.pondId ?? undefined;
      if (data.title) panel.title = data.title;
    });
  });

export const removePanel = createServerFn({ method: "POST" })
  .validator(id)
  .handler(({ data }) => {
    allowed();
    if (activeTurns.has(data)) throw new Error("Stop the panel before deleting this conversation.");
    deletePanel(data);
    return { deleted: true };
  });

/** Adds your message and starts the ducks on it. The page polls `fetchPanel` for replies. */
export const sendTurn = createServerFn({ method: "POST" })
  .validator(z.object({ panelId: id, text: z.string().trim().min(1).max(20000), to: z.string() }))
  .handler(({ data }) => {
    allowed();
    if (activeTurns.has(data.panelId)) throw new Error("Wait for the panel to finish, or stop it.");
    const turnId = crypto.randomUUID();
    const panel = mutatePanel(data.panelId, (panel) => {
      if (data.to !== "panel" && !panel.duckIds.includes(data.to))
        throw new Error("That duck isn't on this panel.");
      if (!panel.turns.length) panel.title = shortTitle(data.text);
      panel.turns.push({
        id: turnId,
        text: data.text,
        to: data.to,
        status: "running",
        rounds: [],
        research: [],
        briefCost: 0,
        createdAt: new Date().toISOString(),
      });
    });
    void runTurn(data.panelId, turnId);
    return panel;
  });

export const stopTurn = createServerFn({ method: "POST" })
  .validator(id)
  .handler(({ data }) => {
    allowed();
    stopPanel(getPanel(data));
    return { stopped: true };
  });

export const lookUp = createServerFn({ method: "POST" })
  .validator(z.object({ panelId: id, turnId: id, question: z.string().trim().min(1).max(2000) }))
  .handler(({ data }) => {
    allowed();
    startResearch(data.panelId, data.turnId, data.question);
    return getPanel(data.panelId);
  });

export const saveDecision = createServerFn({ method: "POST" })
  .validator(z.object({ panelId: id, turnId: id, text: z.string().trim().min(1).max(2000) }))
  .handler(({ data }) => {
    allowed();
    return mutatePanel(data.panelId, (panel) => {
      panel.decisions.push({
        id: crypto.randomUUID(),
        text: data.text,
        turnId: data.turnId,
        createdAt: new Date().toISOString(),
      });
    });
  });

export const removeDecision = createServerFn({ method: "POST" })
  .validator(z.object({ panelId: id, decisionId: id }))
  .handler(({ data }) => {
    allowed();
    return mutatePanel(data.panelId, (panel) => {
      panel.decisions = panel.decisions.filter((decision) => decision.id !== data.decisionId);
    });
  });

export const putDuck = createServerFn({ method: "POST" })
  .validator(panelDuckSchema)
  .handler(({ data }) => {
    allowed();
    saveDuck(data);
    return listDucks();
  });

export const dropDuck = createServerFn({ method: "POST" })
  .validator(z.string())
  .handler(({ data }) => {
    allowed();
    deleteDuck(data);
    return listDucks();
  });
