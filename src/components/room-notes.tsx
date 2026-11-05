import { useRef, useState } from "react";
import { ListChecks, NotebookPen } from "lucide-react";
import { useDismiss } from "./use-dismiss";

/**
 * Header button for the conversation's shared notes, which every duck reads each turn. It also
 * holds Summarize: Mediator posts a recap you can add here with one click.
 */
export function RoomNotes({
  notes,
  disabled,
  onSave,
  canSummarize,
  onSummarize,
}: {
  notes: string;
  disabled: boolean;
  onSave: (notes: string) => Promise<void>;
  canSummarize: boolean;
  onSummarize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  // An outside click or Escape closes the popover unless it holds unsaved edits.
  useDismiss(wrapper, open && (draft === null || draft === notes), () => {
    setOpen(false);
    setDraft(null);
  });
  const changed = draft !== null && draft !== notes;
  async function save() {
    if (!changed) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft.trim());
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save notes.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="room-notes" ref={wrapper}>
      <button
        type="button"
        className="secondary-button compact"
        aria-label="Shared notes"
        aria-expanded={open}
        onClick={() => {
          // Closing keeps unsaved edits for when the panel opens again.
          if (open && !changed) setDraft(null);
          setOpen(!open);
        }}
      >
        <NotebookPen size={15} />
        <span>Notes</span>
        {notes && <i className="notes-dot" aria-label="has notes" />}
      </button>
      {open && (
        <div className="popover notes-popover" role="dialog" aria-label="Shared notes">
          <div className="popover-heading">
            <strong>Shared notes</strong>
          </div>
          <p className="popover-hint">Every duck reads these before it replies.</p>
          <textarea
            className="notes-editor"
            autoFocus
            rows={8}
            maxLength={20000}
            aria-label="Shared notes"
            value={draft ?? notes}
            readOnly={disabled}
            placeholder="Goals, constraints, decisions to keep in mind…"
            onChange={(event) => setDraft(event.target.value)}
          />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="popover-actions">
            {changed && <span className="footer-note">Unsaved changes</span>}
            <span className="spacer" />
            <button
              type="button"
              className="text-button"
              disabled={saving || !changed}
              onClick={() => setDraft(null)}
            >
              Undo changes
            </button>
            <button
              type="button"
              className="primary-button compact"
              disabled={saving || disabled || !changed}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save notes"}
            </button>
          </div>
          <div className="notes-summary">
            <button
              type="button"
              className="secondary-button compact"
              disabled={!canSummarize}
              onClick={() => {
                setOpen(false);
                onSummarize();
              }}
            >
              <ListChecks size={15} /> Summarize so far
            </button>
            <small>
              Mediator posts a recap of decisions and open questions in the conversation. Its Add to
              notes button copies it here.
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
