import { z } from "zod";
import { ducksSchema } from "./room";

/** A named group of conversations with shared notes and the ducks new conversations start with. */
export const pondSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  ducks: ducksSchema,
  /** Notes every duck reads in every conversation in this pond. */
  notes: z.string().max(20000).default(""),
  /** Changes on every save of the name or ducks, so two editors can't overwrite each other. */
  revision: z.string(),
});
export type Pond = z.infer<typeof pondSchema>;
