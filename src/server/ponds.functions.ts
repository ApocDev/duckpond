import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { pondSchema } from "../lib/pond";
import { requireAllowedRequest } from "./access.server";
import { addPond, getPond, listPonds, updatePond, writePondNotes } from "./ponds.server";
import { getRoom, saveRoom } from "./store.server";
import { activeTurns, liveRooms } from "./conversation.server";

export const loadPonds = createServerFn({ method: "GET" }).handler(() => {
  requireAllowedRequest(getRequest());
  return listPonds();
});
export const createPond = createServerFn({ method: "POST" })
  .validator(pondSchema.pick({ name: true, ducks: true }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return addPond(data.name, data.ducks);
  });
export const savePond = createServerFn({ method: "POST" })
  .validator(pondSchema.pick({ id: true, revision: true, name: true, ducks: true }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return updatePond(data.id, data.revision, data.name, data.ducks);
  });
export const savePondNotes = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), notes: pondSchema.shape.notes }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return writePondNotes(data.id, data.notes);
  });
export const moveToPond = createServerFn({ method: "POST" })
  .validator(z.object({ roomId: z.string().uuid(), pondId: z.string().uuid().nullable() }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    if (activeTurns.has(data.roomId) || liveRooms.has(data.roomId))
      throw new Error("Stop the current replies before moving this conversation.");
    const pondId = data.pondId ? getPond(data.pondId).id : undefined;
    return saveRoom({ ...getRoom(data.roomId), pondId });
  });
