import { useMemo } from "react";
import { Settings2 } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { hostColor, rosterColors } from "../lib/duck-colors";
import { DuckAvatar } from "./duck-avatar";

/** Who the next message goes to: "mediator", who picks speakers, or one duck's id. */
export type Target = string;

/**
 * The "To" row above the composer. Selecting a chip sets the recipient; a ring marks anyone
 * currently replying.
 */
export function DuckBar({
  ducks,
  target,
  thinking,
  editDisabled,
  onTarget,
  onEdit,
}: {
  ducks: Duck[];
  target: Target;
  thinking: Message[];
  editDisabled: boolean;
  onTarget: (target: Target) => void;
  onEdit: () => void;
}) {
  const colors = useMemo(() => rosterColors(ducks), [ducks]);
  const busy = new Set(thinking.map((message) => message.duckId));
  const hostBusy = busy.has("mediator") || busy.has("guide");
  return (
    <div className="duck-bar" role="group" aria-label="Send to">
      <span className="duck-bar-label">To</span>
      <div className="duck-bar-chips">
        {ducks.length > 1 && (
          <Chip
            name="Mediator"
            avatar="wizard"
            color={hostColor}
            detail="Picks who answers"
            selected={target === "mediator"}
            busy={hostBusy}
            onSelect={() => onTarget("mediator")}
          />
        )}
        {ducks.map((duck) => (
          <Chip
            key={duck.id}
            name={duck.name}
            avatar={duckAvatar(duck)}
            color={colors.get(duck.id)!}
            detail={`${duck.provider === "claude" ? "Claude" : "Codex"} · ${duck.model || "default model"}`}
            selected={target === duck.id}
            busy={busy.has(duck.id)}
            onSelect={() => onTarget(duck.id)}
          />
        ))}
      </div>
      <button
        type="button"
        className="secondary-button compact"
        aria-label="Edit ducks"
        onClick={onEdit}
        disabled={editDisabled}
      >
        <Settings2 size={15} />
        <span>Edit ducks</span>
      </button>
    </div>
  );
}

function Chip({
  name,
  avatar,
  color,
  detail,
  selected,
  busy,
  onSelect,
}: {
  name: string;
  avatar: NonNullable<Duck["avatar"]>;
  color: string;
  detail: string;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`duck-chip ${busy ? "busy" : ""}`}
      aria-pressed={selected}
      title={`${name} · ${detail}`}
      style={{ "--duck": color }}
      onClick={onSelect}
    >
      <DuckAvatar avatar={avatar} small />
      <span>{name}</span>
    </button>
  );
}
