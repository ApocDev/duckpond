import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { ducksSchema, providerSchema } from "../lib/room";
import { validateModelSelection } from "../lib/models";
import { providerModels } from "./models.server";
import { createRoom, getRoom, listRooms, saveRoom } from "./store.server";
import { activeTurns, liveRooms } from "./conversation.server";
import { providerStatus } from "./providers.server";
import { requireAllowedRequest } from "./access.server";
import { resolveApproval } from "./approvals.server";
import { suggestParticipant } from "./suggestions.server";

export const loadRooms = createServerFn({ method: "GET" })
  .validator(z.object({ streamText: z.boolean() }).optional())
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    const rooms = listRooms().map((stored) => {
      const room = liveRooms.get(stored.id)?.room ?? stored;
      return {
        ...room,
        messages: room.messages.map((message) =>
          message.status === "thinking" && !activeTurns.has(room.id)
            ? { ...message, status: "stopped" as const }
            : message.status === "thinking" &&
                (data?.streamText !== true || "PASS".startsWith(message.text.trim()))
              ? { ...message, text: "" }
              : message,
        ),
      };
    });
    return {
      rooms,
      active: [...liveRooms.entries()].map(([roomId, live]) => ({
        roomId,
        approvals: live.approvals,
      })),
    };
  });
export const newRoom = createServerFn({ method: "POST" }).handler(() => {
  requireAllowedRequest(getRequest());
  return createRoom();
});
export const connections = createServerFn({ method: "GET" }).handler(() => {
  requireAllowedRequest(getRequest());
  return providerStatus();
});
export const loadModels = createServerFn({ method: "GET" })
  .validator(z.object({ provider: providerSchema, refresh: z.boolean().optional() }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return providerModels(data.provider, data.refresh);
  });
export const suggestDuck = createServerFn({ method: "POST" })
  .validator(
    z.object({
      roomId: z.string().uuid().optional(),
      ducks: ducksSchema,
      notes: z.string().max(20000),
    }),
  )
  .handler(async ({ data }) => {
    const request = getRequest();
    requireAllowedRequest(request);
    const messages = data.roomId ? getRoom(data.roomId).messages : [];
    const timeout = AbortSignal.timeout(120000);
    try {
      return await suggestParticipant(
        { messages, ducks: data.ducks, notes: data.notes },
        AbortSignal.any([request.signal, timeout]),
      );
    } catch (error) {
      if (timeout.aborted) throw new Error("The suggestion took too long. Try again.");
      throw error;
    }
  });
export const updateRoom = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      ducks: ducksSchema,
      notes: z.string().max(20000),
      observe: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    requireAllowedRequest(getRequest());
    if (activeTurns.has(data.id))
      throw new Error("Stop the current replies before changing the room.");
    const room = getRoom(data.id);
    await Promise.all(
      data.ducks.map(async (duck) => {
        const previous = room.ducks.find((item) => item.id === duck.id);
        if (
          previous?.provider === duck.provider &&
          previous.model === duck.model &&
          previous.reasoning === duck.reasoning
        )
          return;
        if (!duck.model && !duck.reasoning) return;
        validateModelSelection(duck, await providerModels(duck.provider));
      }),
    );
    // Discovery can take time; a conversation may have started while it was running.
    if (activeTurns.has(data.id))
      throw new Error("Stop the current replies before changing the room.");
    return saveRoom({ ...getRoom(data.id), ...data });
  });
export const stopRoom = createServerFn({ method: "POST" })
  .validator(z.string().uuid())
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    activeTurns.get(data)?.abort();
    return { stopped: true };
  });
export const answerApproval = createServerFn({ method: "POST" })
  .validator(
    z.object({ id: z.string().uuid(), approved: z.boolean(), answer: z.string().max(20000) }),
  )
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return resolveApproval(data.id, data.approved, data.answer);
  });
