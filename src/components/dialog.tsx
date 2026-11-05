import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Modal shell shared by every dialog: native <dialog>, a header that stays put, a scrolling
 * body, and an optional footer for actions. Escape and the close button call `onClose` unless
 * `busy` is set.
 */
export function Dialog({
  title,
  description,
  busy = false,
  wide = false,
  onClose,
  footer,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  busy?: boolean;
  wide?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    // Focus the dialog itself so the close button doesn't open with a focus ring.
    dialog.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </dialog>
  );
}
