import { createFileRoute } from "@tanstack/react-router";
import { createChatResponse } from "../server/chat.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: ({ request }) => createChatResponse(request),
    },
  },
});
