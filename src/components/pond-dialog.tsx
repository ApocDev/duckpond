import { useState } from "react";
import type { Pond } from "../lib/pond";
import { defaults, type Duck } from "../lib/room";
import { createPond } from "../server/ponds.functions";
import { Dialog } from "./dialog";
import { Select } from "./select";

/** Creates a pond: a named group of conversations with its own notes and starting ducks. */
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    setError("");
    try {
      const pond = await createPond({ data: { name: name.trim(), ducks } });
      await onCreated(pond);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create this pond.");
      setSaving(false);
    }
  }
  return (
    <Dialog
      title="New pond"
      description="A pond groups conversations about one project. They share its notes and start with its ducks."
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="text-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pond-form" className="primary-button" disabled={saving}>
            {saving ? "Creating…" : "Create pond"}
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
            disabled={saving}
          />
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
          <small>{ducks.map((duck) => duck.name).join(", ")}. You can change them after.</small>
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
