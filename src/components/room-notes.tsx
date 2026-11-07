import { useRef, useState } from "react";
import { NotebookPen } from "lucide-react";
import { useDismiss } from "./use-dismiss";

/** One editable set of notes: the pond's, or the open conversation's. */
export type NotesField = {
  /** Drafts are kept per key: the conversation's id (or its draft key), or "pond:<id>". */
  key: string;
  label: string;
  hint: string;
  value: string;
  save: (notes: string) => Promise<void>;
};

/**
 * Header button for the shared notes every duck reads each turn: the pond's notes, which every
 * conversation in the pond inherits, and this conversation's own.
 */
export function RoomNotes({
  conversation,
  fields,
  disabled,
}: {
  /** The open conversation's id, or its draft key before it's saved. */
  conversation: string;
  fields: NotesField[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // Unsaved edits per conversation and pond, so switching away and back keeps them.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const latest = useRef(conversation);
  latest.current = conversation;
  const values = Object.fromEntries(fields.map((field) => [field.key, field.value]));
  const [shown, setShown] = useState({ conversation, values });
  if (shown.conversation !== conversation) {
    setShown({ conversation, values });
    if (shown.conversation.startsWith("new:")) {
      // A new conversation that just got saved is the same conversation: keep the panel and draft.
      const carried = drafts[shown.conversation];
      if (carried !== undefined)
        setDrafts((current) =>
          edited(edited(current, [shown.conversation], null), [conversation], carried),
        );
    } else {
      setOpen(false);
      setSaved(false);
    }
  } else if (fields.some((field) => field.value !== shown.values[field.key])) {
    // Text added from outside (Add to notes) joins an open draft, so saving the draft keeps it.
    setShown({ conversation, values });
    for (const field of fields) {
      const before = shown.values[field.key];
      const draft = drafts[field.key];
      if (draft !== undefined && before !== undefined && field.value.startsWith(before))
        setDrafts((current) =>
          edited(current, [field.key], draft + field.value.slice(before.length)),
        );
    }
  }
  const changed = fields.filter(
    (field) => drafts[field.key] !== undefined && drafts[field.key] !== field.value,
  );
  const keys = fields.map((field) => field.key);
  const wrapper = useRef<HTMLDivElement>(null);
  // An outside click or Escape closes the popover unless it holds unsaved edits.
  useDismiss(wrapper, open && !changed.length, () => {
    setOpen(false);
    setDrafts((current) => edited(current, keys, null));
  });
  async function save() {
    setSaving(true);
    setError("");
    try {
      for (const field of changed) {
        await field.save(drafts[field.key]!.trim());
        // Saving the conversation's notes can create it, which moves its draft to the new id.
        const moved = field.key === conversation ? [latest.current] : [];
        setDrafts((current) => edited(current, [field.key, ...moved], null));
      }
      setSaved(true);
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
          if (open && !changed.length) setDrafts((current) => edited(current, keys, null));
          setOpen(!open);
        }}
      >
        <NotebookPen size={15} />
        <span>Notes</span>
        {fields.some((field) => field.value) && <i className="notes-dot" aria-label="has notes" />}
      </button>
      {open && (
        <div className="popover notes-popover" role="dialog" aria-label="Shared notes">
          <div className="popover-heading">
            <strong>Shared notes</strong>
          </div>
          <p className="popover-hint">Every duck reads these before it replies.</p>
          {fields.map((field, index) => (
            <label key={field.key} className="notes-field">
              {fields.length > 1 && (
                <span className="notes-label">
                  <strong>{field.label}</strong> {field.hint}
                </span>
              )}
              <textarea
                className="notes-editor"
                autoFocus={index === fields.length - 1}
                rows={fields.length > 1 ? 5 : 8}
                maxLength={20000}
                aria-label={field.label}
                value={drafts[field.key] ?? field.value}
                readOnly={disabled}
                placeholder="Goals, constraints, decisions to keep in mind…"
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => edited(current, [field.key], value));
                  setSaved(false);
                }}
              />
            </label>
          ))}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="popover-actions">
            {changed.length ? (
              <span className="footer-note">Unsaved changes</span>
            ) : (
              saved && <span className="footer-note">Saved</span>
            )}
            <span className="spacer" />
            <button
              type="button"
              className="text-button"
              disabled={saving || !changed.length}
              onClick={() => setDrafts((current) => edited(current, keys, null))}
            >
              Undo changes
            </button>
            <button
              type="button"
              className="primary-button compact"
              disabled={saving || disabled || !changed.length}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save notes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A copy of `drafts` with `keys` set to `value`, or removed when it's null. */
function edited(drafts: Record<string, string>, keys: string[], value: string | null) {
  const next = { ...drafts };
  for (const key of keys) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
