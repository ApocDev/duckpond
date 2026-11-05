import { useRef, useState } from "react";
import Markdown from "react-markdown";
import { NotebookPen } from "lucide-react";
import { useDismiss } from "./use-dismiss";

/** Header button for the conversation's shared notes, which every duck reads each turn. */
export function RoomNotes({
  notes,
  disabled,
  onSave,
}: {
  notes: string;
  disabled: boolean;
  onSave: (notes: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  useDismiss(wrapper, open && draft === null, () => setOpen(false));
  async function save() {
    if (draft === null) return;
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
        onClick={() => setOpen(!open)}
      >
        <NotebookPen size={15} />
        <span>Notes</span>
        {notes && <i className="notes-dot" aria-label="has notes" />}
      </button>
      {open && (
        <div className="popover notes-popover">
          <div className="popover-heading">
            <strong>Shared notes</strong>
            {draft === null && (
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => setDraft(notes)}
              >
                Edit
              </button>
            )}
          </div>
          <p className="popover-hint">Every duck reads these before it replies.</p>
          {draft === null ? (
            <div className="shared-notes">
              {notes ? <Markdown>{notes}</Markdown> : <p className="muted">No notes yet.</p>}
            </div>
          ) : (
            <>
              <textarea
                className="notes-editor"
                autoFocus
                rows={8}
                maxLength={20000}
                value={draft}
                placeholder="Goals, constraints, decisions to keep in mind…"
                onChange={(event) => setDraft(event.target.value)}
              />
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="popover-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={saving}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-button compact"
                  disabled={saving || disabled}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save notes"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
