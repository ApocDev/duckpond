import { useState } from "react";
import type { Pond } from "../lib/pond";
import { defaults, type Duck } from "../lib/room";
import { createPond } from "../server/ponds.functions";
import { Dialog } from "./dialog";
import { Select } from "./select";

/** Creates a pond in a folder, or opens the pond already saved there. */
export function PondDialog({
  ponds,
  onCreated,
  onClose,
}: {
  /** Ponds whose default ducks the new pond can copy instead of the app's defaults. */
  ponds: { id: string; name: string; ducks: Duck[] }[];
  onCreated: (pond: Pond) => Promise<void>;
  onClose: () => void;
}) {
  const [source, setSource] = useState("");
  const ducks = ponds.find((pond) => pond.id === source)?.ducks ?? defaults;
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
        <div className="field">
          <span>Starting ducks</span>
          <Select
            label="Starting ducks"
            value={source}
            disabled={saving}
            options={[
              { value: "", label: "Default ducks" },
              ...ponds
                .filter((pond) => pond.ducks.length)
                .map((pond) => ({ value: pond.id, label: `Copy ${pond.name}'s ducks` })),
            ]}
            onChange={setSource}
          />
          <small>
            {ducks.map((duck) => duck.name).join(", ")}. You can change them after. An existing pond
            keeps its own ducks.
          </small>
        </div>
        {error && (
          <p role="alert" className="banner error">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
