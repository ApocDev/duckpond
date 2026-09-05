import { expect, it } from "vite-plus/test";
import { askApproval, resolveApproval } from "./approvals.server";
import type { RoomEvent } from "../lib/room";

it("requires an explicit response and resolves an approval only once", async () => {
  const events: RoomEvent[] = [];
  const request = askApproval(
    { duck: "Skeptic", title: "Command", detail: "pwd", input: false },
    new AbortController().signal,
    (event) => events.push(event),
  );
  const event = events[0];
  if (event.type !== "approval") throw new Error("Expected approval");
  expect(events).toHaveLength(1);
  resolveApproval(event.approval.id, false, "");
  await expect(request).resolves.toEqual({ approved: false, answer: "" });
  expect(() => resolveApproval(event.approval.id, true, "")).toThrow("already ended");
});
it("declines a pending approval when the turn is stopped", async () => {
  const controller = new AbortController();
  const request = askApproval(
    { duck: "Explorer", title: "Command", detail: "pwd", input: false },
    controller.signal,
    () => {},
  );
  controller.abort();
  await expect(request).resolves.toEqual({ approved: false, answer: "" });
});
