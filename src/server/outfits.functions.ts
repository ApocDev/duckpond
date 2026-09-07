import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { outfitRequestSchema } from "../lib/outfits";
import { requireAllowedRequest } from "./access.server";
import { getRoom } from "./store.server";
import { listOutfits, startOutfit } from "./outfits.server";

export const generateOutfit = createServerFn({ method: "POST" })
  .validator(outfitRequestSchema)
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    getRoom(data.roomId);
    return startOutfit(data);
  });
export const loadOutfits = createServerFn({ method: "GET" })
  .validator(z.string().uuid())
  .handler(({ data }) => {
    requireAllowedRequest(getRequest());
    return listOutfits(data);
  });
