import type { Approval, RoomEvent } from "../lib/room";

const pending = new Map<string, (response: { approved: boolean; answer: string }) => void>();
export function resolveApproval(id: string, approved: boolean, answer: string) {
  const resolve = pending.get(id);
  if (!resolve) throw new Error("This request has already ended.");
  resolve({ approved, answer });
  return { resolved: true };
}
export function askApproval(
  approval: Omit<Approval, "id">,
  signal: AbortSignal,
  emit: (event: RoomEvent) => void,
) {
  if (signal.aborted) return Promise.resolve({ approved: false, answer: "" });
  const id = crypto.randomUUID();
  return new Promise<{ approved: boolean; answer: string }>((resolve) => {
    const abort = () => finish({ approved: false, answer: "" });
    const finish = (response: { approved: boolean; answer: string }) => {
      if (!pending.delete(id)) return;
      signal.removeEventListener("abort", abort);
      emit({ type: "resolved", id });
      resolve(response);
    };
    pending.set(id, finish);
    signal.addEventListener("abort", abort, { once: true });
    emit({ type: "approval", approval: { ...approval, id } });
  });
}
