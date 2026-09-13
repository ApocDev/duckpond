import { contextStatusSchema } from "./context.server";
import { readProviderSession } from "./store.server";
import { listCommandPermissions, deleteCommandPermission } from "./store.server";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { ducksSchema, providerSchema } from "../lib/room";
import { validateModelSelection } from "../lib/models";
import { providerModels } from "./models.server";
import {
  createRoom,
  deleteRoom,
  getRoom,
  listDuckGroups,
  listRooms,
  saveRoom,
} from "./store.server";
import { activeTurns, liveRooms } from "./conversation.server";
import { providerStatus } from "./providers.server";
import { requireAllowedRequest } from "./access.server";
import { resolveApproval } from "./approvals.server";
import { suggestParticipant } from "./suggestions.server";
import { getPond, listPonds } from "./ponds.server";

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
      ponds: listPonds(),
      active: [...liveRooms.entries()].map(([roomId, live]) => ({
        roomId,
        approvals: live.approvals,
      })),
    };
  });
export const newRoom = createServerFn({ method: "POST" })
  .validator(
    z.object({ ducks: ducksSchema.optional(), pondId: z.string().uuid().optional() }).optional(),
  )
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    const pond = data?.pondId ? getPond(data.pondId) : undefined;
    return createRoom(data?.ducks ?? pond?.ducks, pond);
  });
export const reusableDucks = createServerFn({ method: "GET" }).handler(() => {
  requireAllowedRequest(getRequest());
  return [
    ...listPonds()
      .filter((pond) => !pond.error)
      .map((pond) => ({ id: pond.id, title: `${pond.name} defaults`, ducks: pond.ducks })),
    ...listDuckGroups(),
  ];
});
export const removeRoom = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), onlyIfUntouched: z.boolean().default(false) }))
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    if (activeTurns.has(data.id) || liveRooms.has(data.id)) {
      if (data.onlyIfUntouched) return { deleted: false };
      throw new Error("Stop the current replies before deleting this conversation.");
    }
    return { deleted: deleteRoom(data.id, data.onlyIfUntouched) };
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
    z
      .object({
        roomId: z.string().uuid().optional(),
        pondId: z.string().uuid().optional(),
        ducks: ducksSchema,
        previouslySuggestedNames: z.array(z.string().max(32)).max(25).default([]),
        idea: z.string().trim().min(1).max(2000).optional(),
        inspectWorkspace: z.boolean().default(false),
        notes: z.string().max(20000),
      })
      .refine((data) => !data.inspectWorkspace || (!!data.pondId && !data.idea && !data.roomId), {
        message:
          "Workspace suggestions require a pond and cannot include a conversation or persona idea.",
      }),
  )
  .handler(async ({ data }) => {
    const request = getRequest();
    requireAllowedRequest(request);
    const room = data.roomId ? getRoom(data.roomId) : undefined;
    const messages = room?.messages ?? [];
    const workspace = room?.workspace ?? (data.pondId ? getPond(data.pondId).workspace : undefined);
    const timeout = AbortSignal.timeout(data.inspectWorkspace ? 180000 : 120000);
    try {
      return await suggestParticipant(
        { id: data.roomId, messages, ducks: data.ducks, notes: data.notes, workspace },
        AbortSignal.any([request.signal, timeout]),
        data.previouslySuggestedNames,
        data.idea,
        data.inspectWorkspace,
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
    z.object({
      id: z.string().uuid(),
      approved: z.boolean(),
      answer: z.string().max(20000),
      remember: z.boolean().default(false),
    }),
  )
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return resolveApproval(data.id, data.approved, data.answer, data.remember);
  });

export const savedPermissions = createServerFn({ method: "GET" }).handler(() => {
  requireAllowedRequest(getRequest());
  return listCommandPermissions();
});
export const revokePermission = createServerFn({ method: "POST" })
  .validator(z.string())
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    deleteCommandPermission(data);
    return { revoked: true };
  });

export const loadContext = createServerFn({ method: "GET" })
  .validator(z.string().uuid())
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    const room = getRoom(data);
    return [
      ...room.ducks,
      { id: "mediator", name: "Mediator" },
      { id: "guide", name: "Guide" },
    ].map((duck) => {
      const session = z
        .object({ context: contextStatusSchema.optional() })
        .optional()
        .parse(readProviderSession(`${room.id}/${duck.id}`));
      return { id: duck.id, name: duck.name, context: session?.context ?? null };
    });
  });
