import { createFileRoute } from "@tanstack/react-router";
import { requireAllowedRequest } from "../server/access.server";
import { avatarImage } from "../server/outfits.server";

export const Route = createFileRoute("/api/avatar")({
  server: {
    handlers: {
      GET: ({ request }) => {
        requireAllowedRequest(request);
        try {
          return new Response(
            new Uint8Array(avatarImage(new URL(request.url).searchParams.get("id") ?? "")),
            {
              headers: {
                "Content-Type": "image/png",
                "Cache-Control": "private, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
              },
            },
          );
        } catch {
          return new Response("Outfit not found", { status: 404 });
        }
      },
    },
  },
});
