import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { avatarSchema, duckAvatar, duckSchema, type Duck } from "../lib/room";
import { findModel, type ModelCatalog } from "../lib/models";
import { mentionHandle } from "../lib/mentions";
import { DuckAvatar } from "./duck-avatar";
import { OutfitGenerator } from "./outfit-generator";

/** One duck in the settings list: a summary row that expands into its editable fields. */
export function DuckEditor({
  duck,
  ducks,
  color,
  catalog,
  open,
  roomId,
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
  canRemove: boolean;
  onToggle: () => void;
  onChange: (update: Partial<Duck>) => void;
  onRemove: () => void;
}) {
  const model = findModel(catalog?.models ?? [], duck.model);
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
        <DuckAvatar avatar={duckAvatar(duck)} />
        <span>
          <strong style={{ color }}>{duck.name}</strong>
          <small>
            {provider} · {model?.name ?? (duck.model || "default model")}
            {duck.reasoning ? ` · ${duck.reasoning}` : ""}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>
      <div className="duck-editor-fields" id={`edit-${duck.id}`} hidden={!open}>
        <div className="field-grid">
          <label className="field wide">
            <span>Name</span>
            <input
              required
              maxLength={32}
              value={duck.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            <small>Mention as @{mentionHandle(duck, ducks)}</small>
          </label>
          <label className="field">
            <span>Provider</span>
            <select
              value={duck.provider}
              onChange={(event) =>
                onChange({
                  provider: duckSchema.shape.provider.parse(event.target.value),
                  model: "",
                  reasoning: "",
                })
              }
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <select
              disabled={!catalog || !!catalog.error}
              value={model?.id ?? duck.model}
              onChange={(event) => onChange({ model: event.target.value, reasoning: "" })}
            >
              <option value="">Account default</option>
              {duck.model && !model && <option value={duck.model}>{duck.model} (saved)</option>}
              {catalog?.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Reasoning</span>
            <select
              value={duck.reasoning ?? ""}
              disabled={!model?.reasoning.length}
              onChange={(event) => onChange({ reasoning: event.target.value })}
            >
              <option value="">
                {model?.defaultReasoning ? `Default (${model.defaultReasoning})` : "Default"}
              </option>
              {duck.reasoning && !model?.reasoning.includes(duck.reasoning) && (
                <option value={duck.reasoning}>{duck.reasoning} (saved)</option>
              )}
              {model?.reasoning.map((level) => (
                <option key={level} value={level}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {model?.description && <p className="field-hint">{model.description}</p>}
        <label className="field">
          <span>Perspective</span>
          <GrowingTextarea
            required
            maxLength={4000}
            value={duck.instructions}
            onChange={(instructions) => onChange({ instructions })}
          />
          <small>What this duck cares about, how it talks, and when it should stay quiet.</small>
        </label>
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
            (roomId ? (
              <OutfitGenerator
                roomId={roomId}
                duck={duck}
                onUse={(avatar) => onChange({ avatar })}
              />
            ) : (
              <small>Save the conversation once to draw a custom outfit.</small>
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
      </div>
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
