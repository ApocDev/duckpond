import { useEffect, type RefObject } from "react";

/** Calls `onDismiss` on a pointer press outside `ref` or on Escape while `active`. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return;
    function pointer(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onDismiss();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [ref, active, onDismiss]);
}
