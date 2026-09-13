import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { pondSchema } from "../lib/pond";
import { requireAllowedRequest } from "./access.server";
import { getPond, listPonds, openPond, updatePond } from "./ponds.server";
import { getRoom, saveRoom } from "./store.server";
import { activeTurns, liveRooms } from "./conversation.server";

export const loadPonds = createServerFn({ method: "GET" }).handler(() => {
  requireAllowedRequest(getRequest());
  return listPonds();
});
export const createPond = createServerFn({ method: "POST" })
  .validator(pondSchema.pick({ name: true, workspace: true, ducks: true }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return openPond(data.name, data.workspace, data.ducks);
  });
export const savePond = createServerFn({ method: "POST" })
  .validator(pondSchema.pick({ id: true, revision: true, name: true, ducks: true }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return updatePond(data.id, data.revision, data.name, data.ducks);
  });
export const moveToPond = createServerFn({ method: "POST" })
  .validator(z.object({ roomId: z.string().uuid(), pondId: z.string().uuid().nullable() }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    if (activeTurns.has(data.roomId) || liveRooms.has(data.roomId))
      throw new Error("Stop the current replies before moving this conversation.");
    const pond = data.pondId ? getPond(data.pondId) : undefined;
    return saveRoom({ ...getRoom(data.roomId), pondId: pond?.id, workspace: pond?.workspace });
  });
