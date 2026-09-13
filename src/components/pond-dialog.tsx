import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Pond } from "../lib/pond";
import type { Duck } from "../lib/room";
import { createPond } from "../server/ponds.functions";

export function PondDialog({
  ducks,
  onCreated,
  onClose,
}: {
  ducks: Duck[];
  onCreated: (pond: Pond) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function save() {
    setSaving(true);
    setError("");
    try {
      const pond = await createPond({ data: { name, workspace: workspace.trim(), ducks } });
      await onCreated(pond);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't open this pond.");
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog pond-dialog"
      aria-labelledby="pond-dialog-title"
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="settings-heading">
          <h2 id="pond-dialog-title">Create or open a pond</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close pond setup"
            disabled={saving}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <label>
          Pond name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Game dev"
            disabled={saving}
          />
        </label>
        <label>
          Workspace directory
          <input
            required
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="/home/jim/code/fivenines"
            disabled={saving}
          />
        </label>
        <p className="settings-intro">
          Choose an existing directory on this machine. Agents run here, and pond settings and
          persona files are saved in .duckpond/. If it already contains a pond, that pond opens.
        </p>
        <p className="settings-intro">
          A new pond starts with these ducks: {ducks.map((duck) => duck.name).join(", ")}.
        </p>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        <div className="settings-actions">
          <button type="button" className="text-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? "Opening..." : "Create or open pond"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function MovePondDialog({
  title,
  currentPond,
  ponds,
  onMove,
  onClose,
}: {
  title: string;
  currentPond?: string;
  ponds: { id: string; name: string; error: string | null }[];
  onMove: (pondId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(currentPond ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="move-pond-title"
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else onClose();
      }}
    >
      <h2 id="move-pond-title">Move "{title}"</h2>
      <p className="settings-intro">
        Messages and ducks stay the same. Future replies use the destination pond's workspace.
      </p>
      <label>
        Destination pond
        <select
          value={selected}
          disabled={saving}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">General</option>
          {ponds.map((pond) => (
            <option key={pond.id} value={pond.id} disabled={!!pond.error}>
              {pond.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        <button className="text-button" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={saving || selected === (currentPond ?? "")}
          onClick={() => {
            setSaving(true);
            void onMove(selected || null).catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Couldn't move the conversation.");
              setSaving(false);
            });
          }}
        >
          Move conversation
        </button>
      </div>
    </dialog>
  );
}
