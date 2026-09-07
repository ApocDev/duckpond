import { z } from "zod";
import { duckSchema } from "./room";

export const outfitRequestSchema = z.object({
  roomId: z.string().uuid(),
  duck: duckSchema,
  description: z.string().trim().max(1000),
});
export const outfitJobSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  duckId: z.string(),
  description: z.string(),
  createdAt: z.string().default(""),
  status: z.enum(["running", "complete", "error"]),
  error: z.string().optional(),
});
export type OutfitJob = z.infer<typeof outfitJobSchema>;
