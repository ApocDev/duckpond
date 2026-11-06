import { useState } from "react";
import type { Pond } from "../lib/pond";
import type { Duck } from "../lib/room";
import { createPond } from "../server/ponds.functions";
import { Dialog } from "./dialog";

/** Creates a pond in a folder, or opens the pond already saved there. */
export function PondDialog({
  ducks,
  onCreated,
  onClose,
}: {
  ducks: Duck[];
  onCreated: (pond: Pond) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
    <Dialog
      title="New pond"
      description="A pond is a project folder. Ducks work inside it, and its default ducks are saved there."
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="text-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pond-form" className="primary-button" disabled={saving}>
            {saving ? "Opening…" : "Create pond"}
          </button>
        </>
      }
    >
      <form
        id="pond-form"
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My game"
            disabled={saving}
          />
        </label>
        <label className="field">
          <span>Folder</span>
          <input
            required
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="/home/you/code/my-game"
            disabled={saving}
          />
          <small>
            An existing absolute path on this machine. If it already has a pond, that pond opens.
          </small>
        </label>
        <p className="field-hint">
          Starts with the ducks you have now: {ducks.map((duck) => duck.name).join(", ")}. You can
          change them after.
        </p>
        {error && (
          <p role="alert" className="banner error">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
