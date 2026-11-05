import { useState } from "react";
import type { Room } from "../lib/room";
import { Dialog } from "./dialog";
import { Select } from "./select";

/** Renames a conversation; titles start as the first message, cut at a word. */
export function RenameDialog({
  room,
  onRename,
  onClose,
}: {
  room: Room;
  onRename: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(room.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title="Rename conversation"
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="text-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="rename-form" className="primary-button" disabled={saving}>
            {saving ? "Saving…" : "Rename"}
          </button>
        </>
      }
    >
      <form
        id="rename-form"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          setSaving(true);
          void onRename(title.trim()).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Couldn't rename it.");
            setSaving(false);
          });
        }}
      >
        <label className="field">
          <span>Title</span>
          <input
            autoFocus
            required
            maxLength={80}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** Moves a conversation to another pond; later replies run in that pond's folder. */
export function MoveDialog({
  room,
  ponds,
  onMove,
  onClose,
}: {
  room: Room;
  ponds: { id: string; name: string; error: string | null }[];
  onMove: (pondId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(room.pondId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={`Move "${room.title}"`}
      description="Messages and ducks stay the same. Later replies run in the new pond's folder."
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="text-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={saving || selected === (room.pondId ?? "")}
            onClick={() => {
              setSaving(true);
              void onMove(selected || null).catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Couldn't move it.");
                setSaving(false);
              });
            }}
          >
            {saving ? "Moving…" : "Move"}
          </button>
        </>
      }
    >
      <div className="field">
        <span>Pond</span>
        <Select
          label="Pond"
          value={selected}
          disabled={saving}
          options={[
            { value: "", label: "General" },
            ...ponds.map((pond) => ({ value: pond.id, label: pond.name, disabled: !!pond.error })),
          ]}
          onChange={setSelected}
        />
      </div>
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Confirms deleting a conversation's messages and notes. */
export function DeleteDialog({
  room,
  onDelete,
  onClose,
}: {
  room: Room;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title={`Delete "${room.title}"?`}
      description="This removes its messages and notes. It can't be undone. Its ducks can still be reused from other conversations."
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="text-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button danger"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onDelete().catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : "Couldn't delete it.");
                setSaving(false);
              });
            }}
          >
            {saving ? "Deleting…" : "Delete"}
          </button>
        </>
      }
    >
      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
