import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DuckAvatar } from "./duck-avatar";
import { avatarSchema } from "../lib/room";
import type { PanelDuck } from "../lib/panel";

/** Models that played personas well in the persona tests, with a rough cost per panel. */
const suggestedModels = [
  ["qwen/qwen3.8-max-0902", "Qwen 3.8 Max · good at people · about $0.05 a panel"],
  ["deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash · argues hardest · under $0.01"],
  ["anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5 · natural, polite · about $0.05"],
  ["openai/gpt-6.1-sol", "GPT-6.1 Sol · sounds like a consultant · about $0.04"],
  ["z-ai/glm-5.3", "GLM 5.3 · cheap · under $0.01"],
  ["moonshotai/kimi-k3.1-pro", "Kimi K3.1 Pro · about $0.06"],
  ["meta/muse-wonder", "Muse Wonder · great people, pricey · about $0.27"],
] as const;

const blank: PanelDuck = {
  id: "",
  name: "",
  kind: "adviser",
  brief: "",
  model: "",
  avatar: "base",
};
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "duck";

/** The shared duck library: pick a duck to edit it, or add a new one. */
export function DuckLibrary({
  ducks,
  onSave,
  onDelete,
}: {
  ducks: PanelDuck[];
  onSave: (duck: PanelDuck) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<PanelDuck>(ducks[0] ?? blank);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const isNew = !ducks.some((duck) => duck.id === editing.id);
  const set = (change: Partial<PanelDuck>) => setEditing({ ...editing, ...change });

  async function save() {
    setSaving(true);
    setError("");
    try {
      const id = editing.id || slug(editing.name);
      if (isNew && ducks.some((duck) => duck.id === id))
        throw new Error("A duck with that name already exists.");
      const duck = { ...editing, id };
      await onSave(duck);
      setEditing(duck);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the duck.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pn-library">
      <div className="pn-library-list">
        {(["adviser", "person"] as const).map((kind) => (
          <div key={kind}>
            <h4>{kind === "adviser" ? "Advisers" : "People"}</h4>
            {ducks
              .filter((duck) => duck.kind === kind)
              .map((duck) => (
                <button
                  type="button"
                  key={duck.id}
                  className={`pn-library-duck ${duck.id === editing.id ? "selected" : ""}`}
                  onClick={() => setEditing(duck)}
                >
                  <DuckAvatar avatar={duck.avatar} small />
                  <span>
                    <strong>{duck.name}</strong>
                    <small>{duck.model}</small>
                  </span>
                </button>
              ))}
          </div>
        ))}
        <button
          type="button"
          className="secondary-button compact"
          onClick={() => setEditing(blank)}
        >
          <Plus size={14} /> New duck
        </button>
      </div>
      <form
        className="pn-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="row">
          <DuckAvatar avatar={editing.avatar} />
          <h3>{editing.name || "New duck"}</h3>
        </div>
        <label className="field">
          <span>Name</span>
          <input
            value={editing.name}
            maxLength={40}
            required
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <div className="field">
          <span>Kind</span>
          <div className="pn-kinds">
            {(
              [
                ["adviser", "Adviser", "Weighs what's best for you, from their expertise."],
                ["person", "Person", "Says what they'd do, buy, or skip. Doesn't advise."],
              ] as const
            ).map(([kind, label, hint]) => (
              <button
                type="button"
                key={kind}
                className={`pn-kind ${editing.kind === kind ? "selected" : ""}`}
                onClick={() => set({ kind })}
              >
                <strong>{label}</strong>
                <span>{hint}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Who they are</span>
          <textarea
            rows={5}
            required
            maxLength={4000}
            value={editing.brief}
            placeholder="Write it to the duck: You are 15. You play after school with friends…"
            onChange={(e) => set({ brief: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Model (OpenRouter ID)</span>
          <input
            list="pn-models"
            required
            value={editing.model}
            onChange={(e) => set({ model: e.target.value })}
          />
          <datalist id="pn-models">
            {suggestedModels.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </datalist>
        </label>
        <div className="field">
          <span>Outfit</span>
          <div className="row">
            {avatarSchema.options.map((avatar) => (
              <button
                type="button"
                key={avatar}
                className={`pn-outfit ${editing.avatar === avatar ? "selected" : ""}`}
                aria-label={avatar}
                onClick={() => set({ avatar })}
              >
                <DuckAvatar avatar={avatar} />
              </button>
            ))}
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="row">
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? "Saving…" : "Save duck"}
          </button>
          {!isNew && (
            <button
              type="button"
              className="text-button danger"
              onClick={async () => {
                await onDelete(editing.id);
                setEditing(ducks.find((duck) => duck.id !== editing.id) ?? blank);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
