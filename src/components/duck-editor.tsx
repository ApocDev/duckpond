import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { ChevronDown, Sparkles, Trash2 } from "lucide-react";
import { avatarSchema, duckAvatar, duckSchema, type Duck } from "../lib/room";
import { findModel, modelLabel, type ModelCatalog } from "../lib/models";
import { mentionHandle } from "../lib/mentions";
import { DuckAvatar } from "./duck-avatar";
import { OutfitGenerator } from "./outfit-generator";
import { Select } from "./select";

/** One duck in the settings list: a summary row that expands into its editable fields. */
export function DuckEditor({
  duck,
  ducks,
  color,
  catalog,
  open,
  roomId,
  readOnly,
  canRemove,
  onToggle,
  onChange,
  onRemove,
}: {
  duck: Duck;
  ducks: Duck[];
  color: string;
  catalog?: ModelCatalog;
  open: boolean;
  /** Outfit generation needs a saved conversation. */
  roomId?: string;
  /** Lets you read the duck but not change it, while replies run. */
  readOnly: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onChange: (update: Partial<Duck>) => void;
  onRemove: () => void;
}) {
  const model = findModel(catalog?.models ?? [], duck.model);
  // Long perspectives start capped so the outfit and remove controls stay in reach.
  const long = duck.instructions.length > 500;
  const [expanded, setExpanded] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const provider = duck.provider === "claude" ? "Claude" : "Codex";
  return (
    <section className={`duck-editor ${open ? "open" : ""}`} onInvalid={() => !open && onToggle()}>
      <button
        className="duck-editor-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={`edit-${duck.id}`}
        onClick={onToggle}
      >
        <DuckAvatar avatar={duckAvatar(duck)} color={color} />
        <span>
          <strong style={{ color }}>
            {duck.name}
            <small>
              {provider} · {modelLabel(duck.model, duck.reasoning, model?.name)}
            </small>
          </strong>
          {!open && <em>{duck.instructions.split(/(?<=[.!?])\s/)[0]}</em>}
        </span>
        <ChevronDown size={16} />
      </button>
      <fieldset
        className="duck-editor-fields"
        id={`edit-${duck.id}`}
        hidden={!open}
        disabled={readOnly}
      >
        <label className="field">
          <span>Name</span>
          <input
            required
            maxLength={32}
            value={duck.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
          <small>Mention as @{mentionHandle(duck, ducks)}</small>
        </label>
        <div className="field-grid model-fields">
          <div className="field">
            <span>Provider</span>
            <Select
              label="Provider"
              value={duck.provider}
              options={[
                { value: "claude", label: "Claude" },
                { value: "codex", label: "Codex" },
              ]}
              onChange={(value) =>
                onChange({
                  provider: duckSchema.shape.provider.parse(value),
                  model: "",
                  reasoning: "",
                })
              }
            />
          </div>
          <div className="field">
            <span>Model</span>
            <Select
              label="Model"
              disabled={!catalog || !!catalog.error}
              value={model?.id ?? duck.model}
              options={[
                { value: "", label: "Account default" },
                ...(duck.model && !model
                  ? [{ value: duck.model, label: `${duck.model} (saved)` }]
                  : []),
                ...(catalog?.models.map((item) => ({ value: item.id, label: item.name })) ?? []),
              ]}
              onChange={(value) => onChange({ model: value, reasoning: "" })}
            />
          </div>
          <div className="field">
            <span>Reasoning</span>
            <Select
              label="Reasoning"
              disabled={!model?.reasoning.length}
              value={duck.reasoning ?? ""}
              options={[
                {
                  value: "",
                  label: model?.defaultReasoning
                    ? `Default (${model.defaultReasoning})`
                    : "Default",
                },
                ...(duck.reasoning && !model?.reasoning.includes(duck.reasoning)
                  ? [{ value: duck.reasoning, label: `${duck.reasoning} (saved)` }]
                  : []),
                // The default level already has its own entry, unless this duck picked it.
                ...(model?.reasoning
                  .filter((level) => level !== model.defaultReasoning || level === duck.reasoning)
                  .map((level) => ({
                    value: level,
                    label: level.charAt(0).toUpperCase() + level.slice(1),
                  })) ?? []),
              ]}
              onChange={(value) => onChange({ reasoning: value })}
            />
          </div>
        </div>
        <p className="field-hint">
          {model?.description ? `${model.description} ` : ""}Higher reasoning is slower and more
          thorough.
        </p>
        <div className={`field perspective ${long && !expanded && !readOnly ? "capped" : ""}`}>
          <label htmlFor={`perspective-${duck.id}`}>Perspective</label>
          <GrowingTextarea
            id={`perspective-${duck.id}`}
            required
            maxLength={4000}
            value={duck.instructions}
            onChange={(instructions) => onChange({ instructions })}
          />
          <small>
            What this duck cares about, how it talks, and when it should stay quiet.
            {long && (
              <button type="button" className="text-button" onClick={() => setExpanded(!expanded)}>
                {expanded ? "Show less" : "Show all"}
              </button>
            )}
          </small>
        </div>
        <div className="field">
          <span>Outfit</span>
          <div className="outfit-options" role="group" aria-label={`${duck.name} outfit`}>
            {avatarSchema.options.map((avatar) => (
              <button
                key={avatar}
                type="button"
                aria-label={`${avatar} outfit`}
                aria-pressed={duckAvatar(duck) === avatar}
                onClick={() => onChange({ avatar })}
              >
                <DuckAvatar avatar={avatar} />
              </button>
            ))}
            {duck.avatar?.startsWith("generated-") && (
              <button type="button" aria-label="Generated outfit" aria-pressed>
                <DuckAvatar avatar={duck.avatar} />
              </button>
            )}
          </div>
          {open &&
            (!roomId ? (
              <small>Save the conversation once to draw a custom outfit.</small>
            ) : drawing ? (
              <OutfitGenerator
                roomId={roomId}
                duck={duck}
                onUse={(avatar) => onChange({ avatar })}
              />
            ) : (
              <button type="button" className="text-button" onClick={() => setDrawing(true)}>
                <Sparkles size={14} /> Draw a custom outfit…
              </button>
            ))}
        </div>
        <div className="duck-editor-footer">
          <button
            type="button"
            className="text-button danger"
            disabled={!canRemove}
            title={canRemove ? undefined : "A conversation needs at least one duck"}
            onClick={onRemove}
          >
            <Trash2 size={14} /> Remove {duck.name}
          </button>
        </div>
      </fieldset>
    </section>
  );
}

/** A textarea that grows with its content instead of scrolling inside a scrolling dialog. */
function GrowingTextarea({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<"textarea">, "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !element.offsetParent) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  });
  return (
    <textarea
      {...props}
      ref={ref}
      rows={4}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
