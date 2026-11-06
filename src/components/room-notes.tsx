import { useRef, useState } from "react";
import { ListChecks, NotebookPen } from "lucide-react";
import { useDismiss } from "./use-dismiss";

/**
 * Header button for the conversation's shared notes, which every duck reads each turn. It also
 * holds Summarize: Mediator posts a recap you can add here with one click.
 */
export function RoomNotes({
  conversation,
  notes,
  disabled,
  onSave,
  summarizeBlocked,
  onSummarize,
}: {
  /** The open conversation's id, or its draft key before it's saved. Drafts are kept per id. */
  conversation: string;
  notes: string;
  disabled: boolean;
  onSave: (notes: string) => Promise<void>;
  /** Why Summarize can't run right now, if it can't. */
  summarizeBlocked?: string;
  onSummarize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  // Unsaved edits per conversation, so switching away and back keeps them.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[conversation] ?? null;
  function setDraft(value: string | null) {
    setDrafts((current) => edited(current, [conversation], value));
  }
  const latest = useRef(conversation);
  latest.current = conversation;
  const [shown, setShown] = useState({ conversation, notes });
  if (shown.conversation !== conversation) {
    setShown({ conversation, notes });
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
  } else if (notes !== shown.notes) {
    // Text added from outside (Add to notes) joins an open draft, so saving the draft keeps it.
    setShown({ conversation, notes });
    if (draft !== null && notes.startsWith(shown.notes))
      setDraft(draft + notes.slice(shown.notes.length));
  }
  const wrapper = useRef<HTMLDivElement>(null);
  // An outside click or Escape closes the popover unless it holds unsaved edits.
  useDismiss(wrapper, open && (draft === null || draft === notes), () => {
    setOpen(false);
    setDraft(null);
  });
  const changed = draft !== null && draft !== notes;
  async function save() {
    if (!changed) return false;
    const key = conversation;
    setSaving(true);
    setError("");
    try {
      await onSave(draft.trim());
      // Saving can create the conversation, which moves the draft to its new id.
      setDrafts((current) => edited(current, [key, latest.current], null));
      setSaved(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save notes.");
      return false;
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
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
          />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="popover-actions">
            {changed ? (
              <span className="footer-note">Unsaved changes</span>
            ) : (
              saved && <span className="footer-note">Saved</span>
            )}
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
              disabled={!!summarizeBlocked}
              onClick={async () => {
                // Mediator reads the saved notes, so unsaved edits are saved before it recaps.
                if (changed && !(await save())) return;
                setOpen(false);
                onSummarize();
              }}
            >
              <ListChecks size={15} /> Summarize so far
            </button>
            <small>
              {summarizeBlocked ? `${summarizeBlocked} ` : ""}Mediator posts a recap of decisions
              and open questions in the conversation. Its Add to notes button copies it here.
            </small>
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
