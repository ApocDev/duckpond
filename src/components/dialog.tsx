import { useEffect, useId, useRef, type ReactNode } from "react";
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
  const id = useId();
  useEffect(() => {
    dialog.current?.showModal();
    // Focus a field marked data-autofocus, or else the dialog itself, so the close button doesn't
    // open with a focus ring.
    (dialog.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.current)?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {description && <p id={`${id}-description`}>{description}</p>}
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
