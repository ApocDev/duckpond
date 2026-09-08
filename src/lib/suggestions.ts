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
  const visible = room.messages.filter(
    (message) => message.status === "complete" || message.status === "stopped",
  );
  if (!visible.length && !room.notes.trim())
    throw new Error("Share your idea in the conversation or shared notes first.");
  const serialize = (messages: typeof visible) =>
    JSON.stringify({
      conversation: messages.map(({ speaker, text }) => ({ speaker, text })),
      sharedNotes: room.notes,
      previouslySuggestedNames,
      currentDucks: room.ducks.map(({ name, instructions }) => ({
        name,
        perspective: instructions,
      })),
      ...(messages.length < visible.length
        ? {
            contextNote:
              "This is a selection of the conversation. Older or oversized messages are omitted. Suggest perspectives useful to the supplied discussion; do not assume omitted topics were never considered.",
          }
        : {}),
    });
  // Suggestions need a useful sample, not a replay of the entire room.
  const budget = 60000;
  const complete = serialize(visible);
  if (complete.length <= budget) return complete;
  if (serialize([]).length > budget)
    throw new Error(
      "The shared notes and duck perspectives are too large for a suggestion. Shorten them before trying again.",
    );
  const chosen = new Set<(typeof visible)[number]>();
  const candidates = [
    ...new Set([
      ...visible.slice(-8).reverse(),
      ...visible
        .filter((message) => message.duckId === "mediator" || message.phase === "guide")
        .slice(-2)
        .reverse(),
      ...visible.filter((message) => !message.duckId).reverse(),
      ...visible.toReversed(),
    ]),
  ];
  for (const message of candidates) {
    chosen.add(message);
    if (serialize(visible.filter((item) => chosen.has(item))).length > budget)
      chosen.delete(message);
  }
  return serialize(visible.filter((message) => chosen.has(message)));
}
