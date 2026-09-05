import { expect, it } from "vite-plus/test";
import { groupMessages } from "./message-groups";
import type { Message } from "./room";

it("groups existing parallel replies without mixing user turns or hiding the guide", () => {
  const messages: Message[] = [
    {
      id: "1",
      speaker: "You",
      text: "Review this",
      status: "complete",
      phase: "conversation",
      createdAt: "",
    },
    {
      id: "2",
      speaker: "Explorer",
      duckId: "explorer",
      text: "An idea",
      status: "complete",
      phase: "review",
      createdAt: "",
    },
    {
      id: "3",
      speaker: "Skeptic",
      duckId: "skeptic",
      text: "A risk",
      status: "thinking",
      phase: "review",
      createdAt: "",
    },
    {
      id: "4",
      speaker: "Explorer",
      duckId: "explorer",
      text: "A response",
      status: "complete",
      phase: "discussion",
      createdAt: "",
    },
    {
      id: "5",
      speaker: "Guide",
      duckId: "guide",
      text: "A summary",
      status: "complete",
      phase: "guide",
      createdAt: "",
    },
    {
      id: "6",
      speaker: "You",
      text: "My answer",
      status: "complete",
      phase: "conversation",
      createdAt: "",
    },
    {
      id: "7",
      speaker: "Explorer",
      duckId: "explorer",
      text: "One reply",
      status: "complete",
      phase: "conversation",
      createdAt: "",
    },
  ];
  const groups = groupMessages(messages);
  expect(groups.map((group) => [group.kind, group.id])).toEqual([
    ["message", "1"],
    ["round", "2"],
    ["message", "5"],
    ["message", "6"],
    ["message", "7"],
  ]);
  expect(groups[1]).toMatchObject({ messages: messages.slice(1, 4) });
  expect(groupMessages(messages.slice(0, 2))[1].kind).toBe("round");
});
