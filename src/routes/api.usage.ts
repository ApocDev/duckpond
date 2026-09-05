import { createFileRoute } from "@tanstack/react-router";
import { usageResponse } from "../server/usage.server";

export const Route = createFileRoute("/api/usage")({
  server: { handlers: { GET: ({ request }) => usageResponse(request) } },
});
