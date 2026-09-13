import { z } from "zod";
import { duckSchema, ducksSchema } from "./room";

export const pondManifestSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  ducks: z.array(duckSchema.omit({ instructions: true })).min(1),
});
export const pondSchema = z.object({
  id: pondManifestSchema.shape.id,
  name: pondManifestSchema.shape.name,
  workspace: z.string().min(1),
  ducks: ducksSchema,
  revision: z.string(),
});
export type Pond = z.infer<typeof pondSchema>;
