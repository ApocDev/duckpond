import { useState } from "react";
import type { Pond } from "../lib/pond";
import type { Duck } from "../lib/room";
import { createPond } from "../server/ponds.functions";
import { Dialog } from "./dialog";

/** Creates a pond in a folder, or opens the pond already saved there. */
export function PondDialog({
  ducks,
  from,
  onCreated,
  onClose,
}: {
  /** The ducks the new pond starts with: the open pond's. */
  ducks: Duck[];
  /** Name of the pond those ducks come from. */
  from: string;
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
      const folder = workspace.trim();
      // An empty name becomes the folder's name, which is what most people would type anyway.
      const pond = await createPond({
        data: {
          name: name.trim() || folder.replace(/\/+$/, "").split("/").at(-1) || "Pond",
          workspace: folder,
          ducks,
        },
      });
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
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Defaults to the folder's name"
            disabled={saving}
          />
        </label>
        <label className="field">
          <span>Folder</span>
          <input
            required
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="Full path, such as /home/you/code/project"
            disabled={saving}
          />
          <small>
            An existing absolute path on this machine. If it already has a pond, that pond opens.
          </small>
        </label>
        <p className="field-hint">
          Starts with {from}'s ducks: {ducks.map((duck) => duck.name).join(", ")}. You can change
          them after.
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
