import { useRef, useState } from "react";
import { AtSign, Plus, Settings2 } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { duckColor } from "../lib/duck-colors";
import { DuckAvatar } from "./duck-avatar";
import { useDismiss } from "./use-dismiss";

/**
 * The room's ducks, shown above the composer. A ring marks ducks that are replying and a
 * bubble shows what the first active speaker (including Guide or Mediator) is doing.
 * Clicking a duck opens its card with mention and settings actions.
 */
export function DuckStrip({
  ducks,
  thinking,
  activity,
  partnerId,
  observe,
  disabled,
  onMention,
  onSettings,
}: {
  ducks: Duck[];
  thinking: Message[];
  activity: Partial<Record<string, string>>;
  /** The selected duck in Conversation mode. */
  partnerId?: Duck["id"];
  observe: boolean;
  disabled: boolean;
  onMention: (duck: Duck) => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState<Duck["id"] | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  useDismiss(strip, open !== null, () => setOpen(null));
  const busy = new Set(thinking.map((message) => message.duckId));
  const card = ducks.find((duck) => duck.id === open);
  const speaking = thinking[0];
  return (
    <div className="duck-strip" ref={strip}>
      <div className="duck-strip-row">
        {ducks.map((duck) => (
          <button
            key={duck.id}
            type="button"
            className={`strip-duck ${busy.has(duck.id) ? "active" : ""}`}
            aria-label={duck.name}
            title={duck.name}
            aria-expanded={open === duck.id}
            onClick={() => setOpen(open === duck.id ? null : duck.id)}
          >
            <DuckAvatar avatar={duckAvatar(duck)} />
            <span style={{ color: duckColor(ducks, duck.id) }}>{duck.name}</span>
          </button>
        ))}
        <button
          type="button"
          className="strip-add"
          onClick={onSettings}
          disabled={disabled}
          aria-label="Room settings"
          title="Room settings"
        >
          <Plus size={16} />
        </button>
        {speaking && (
          <span className="strip-bubble" role="status">
            <strong style={{ color: duckColor(ducks, speaking.duckId ?? "") }}>
              {speaking.speaker}
            </strong>
            {(speaking.duckId && activity[speaking.duckId]) || "thinking"}
            {thinking.length > 1 && <small> +{thinking.length - 1}</small>}
          </span>
        )}
      </div>
      {card && (
        <div className="duck-card-popover">
          <div className="duck-card-heading">
            <DuckAvatar avatar={duckAvatar(card)} />
            <div>
              <strong style={{ color: duckColor(ducks, card.id) }}>{card.name}</strong>
              <small>
                {card.provider === "claude" ? "Claude" : "Codex"} ·{" "}
                {card.model || "Account default"}
                {card.reasoning ? ` · ${card.reasoning}` : ""}
              </small>
              {busy.has(card.id) ? (
                <small className="active">{activity[card.id] || "Thinking"}</small>
              ) : card.id === partnerId ? (
                <small>Conversation partner</small>
              ) : (
                observe && <small>Observing</small>
              )}
            </div>
          </div>
          <p>{card.instructions}</p>
          <div className="duck-card-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setOpen(null);
                onMention(card);
              }}
            >
              <AtSign size={13} /> Mention
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => {
                setOpen(null);
                onSettings();
              }}
            >
              <Settings2 size={13} /> Room settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
