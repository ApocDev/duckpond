import { z } from "zod";

/** Bound to one room and one running speaker; callers cannot choose their identity. */
export type RoomTools = {
  definitions: { name: string; description: string; inputSchema: z.ZodObject }[];
  call: (name: string, input: unknown) => unknown;
};

export function callRoomTool(tools: RoomTools | undefined, name: string, input: unknown) {
  try {
    if (!tools?.definitions.some((definition) => definition.name === name))
      throw new Error("This room tool is not available to this speaker.");
    return { text: JSON.stringify(tools.call(name, input)), success: true };
  } catch (error) {
    return { text: error instanceof Error ? error.message : "Room tool failed", success: false };
  }
}
