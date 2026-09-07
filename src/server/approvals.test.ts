import { expect, it, vi } from "vite-plus/test";
const rules = vi.hoisted(() => new Set<string>());
vi.mock("./store.server", () => ({
  hasCommandPermission: (id: string) => rules.has(id),
  saveCommandPermission: (rule: { id: string }) => {
    rules.add(rule.id);
  },
}));
import { commandPermission } from "./command-permissions.server";
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

it("remembers exact command privileges across ducks and asks again after revocation", async () => {
  const remember = commandPermission("codex", {
    command: "pnpm dlx @tanstack/intent@latest list",
    cwd: "/project",
    additionalPermissions: { network: true },
  })!;
  const approval = { duck: "Director", title: "Run command", detail: "", input: false, remember };
  const events: RoomEvent[] = [];
  const pending = askApproval(approval, new AbortController().signal, (event) =>
    events.push(event),
  );
  const event = events[0];
  if (event.type !== "approval") throw new Error("Missing approval");
  resolveApproval(event.approval.id, true, "", true);
  await expect(pending).resolves.toEqual({ approved: true, answer: "" });
  const emit = vi.fn();
  await expect(
    askApproval({ ...approval, duck: "Other duck" }, new AbortController().signal, emit),
  ).resolves.toEqual({ approved: true, answer: "" });
  expect(emit).not.toHaveBeenCalled();
  rules.delete(remember.id);
  const controller = new AbortController();
  const retry = askApproval(approval, controller.signal, emit);
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "approval" }));
  controller.abort();
  await retry;
});
it("never widens a saved command to another command, project, provider or privilege", () => {
  const request = { command: "pwd", cwd: "/project", additionalPermissions: { network: true } };
  const id = commandPermission("codex", request)!.id;
  expect(
    commandPermission("codex", { ...request, threadId: "next", reason: "explanation" })!.id,
  ).toBe(id);
  for (const changed of [
    { ...request, command: "pwd; curl example.com" },
    { ...request, cwd: "/other" },
    { ...request, additionalPermissions: { network: true, filesystem: "write" } },
  ])
    expect(commandPermission("codex", changed)!.id).not.toBe(id);
  expect(commandPermission("claude", request)!.id).not.toBe(id);
  expect(commandPermission("codex", { command: "pwd" })).toBeUndefined();
});
