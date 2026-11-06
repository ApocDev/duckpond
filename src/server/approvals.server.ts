import { hasCommandPermission, saveCommandPermission } from "./store.server";
import type { Approval, RoomEvent } from "../lib/room";

const pending = new Map<
  string,
  (response: { approved: boolean; answer: string; remember?: boolean }) => void
>();
export function resolveApproval(id: string, approved: boolean, answer: string, remember = false) {
  const resolve = pending.get(id);
  if (!resolve) throw new Error("This request has already ended.");
  resolve({ approved, answer, remember });
  return { resolved: true };
}
/** Asks the person; `remember` comes back true when they allowed an edit for the rest of the turn. */
export function askApproval(
  approval: Omit<Approval, "id">,
  signal: AbortSignal,
  emit: (event: RoomEvent) => void,
): Promise<{ approved: boolean; answer: string; remember?: boolean }> {
  if (signal.aborted) return Promise.resolve({ approved: false, answer: "" });
  if (approval.remember && hasCommandPermission(approval.remember.id))
    return Promise.resolve({ approved: true, answer: "" });
  const id = crypto.randomUUID();
  return new Promise<{ approved: boolean; answer: string; remember?: boolean }>((resolve) => {
    const abort = () => finish({ approved: false, answer: "" });
    const finish = (response: { approved: boolean; answer: string; remember?: boolean }) => {
      // "Remember" saves a command permission, or for an edit lets the caller allow later edits
      // in this turn; nothing is stored for edits.
      if (response.approved && response.remember) {
        if (approval.remember) saveCommandPermission(approval.remember);
        else if (!approval.editsInFolder) throw new Error("This request cannot be remembered.");
      }
      if (!pending.delete(id)) return;
      signal.removeEventListener("abort", abort);
      emit({ type: "resolved", id });
      resolve({
        approved: response.approved,
        answer: response.answer,
        // Only an edit's per-turn allow needs to reach the caller; commands are saved above.
        ...(response.approved && response.remember && approval.editsInFolder
          ? { remember: true }
          : {}),
      });
    };
    pending.set(id, finish);
    signal.addEventListener("abort", abort, { once: true });
    emit({ type: "approval", approval: { ...approval, id } });
  });
}
