import { z } from "zod";
import { duckSchema, type Room } from "./room";

export const suggestionSchema = z.object({
  reason: z.string().trim().min(1).max(900),
  suggestions: z
    .array(
      z.object({
        name: duckSchema.shape.name,
        instructions: duckSchema.shape.instructions,
        reason: z.string().trim().min(1).max(900),
      }),
    )
    .max(5),
});
export type DuckSuggestion = z.infer<typeof suggestionSchema>;

export function suggestionContext(
  room: Pick<Room, "messages" | "notes" | "ducks">,
  previouslySuggestedNames: string[] = [],
) {
  const messages = room.messages
    .filter((message) => message.status === "complete" || message.status === "stopped")
    .map(({ speaker, text }) => ({ speaker, text }));
  if (!messages.length && !room.notes.trim())
    throw new Error("Share your idea in the conversation or shared notes first.");
  return JSON.stringify({
    conversation: messages,
    sharedNotes: room.notes,
    previouslySuggestedNames,
    currentDucks: room.ducks.map(({ name, instructions }) => ({ name, perspective: instructions })),
  });
}
