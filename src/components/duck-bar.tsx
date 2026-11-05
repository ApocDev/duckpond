import { useLayoutEffect, useMemo, useRef } from "react";
import { Users } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { hostColor, rosterColors } from "../lib/duck-colors";
import { modelLabel } from "../lib/models";
import { DuckAvatar } from "./duck-avatar";

/**
 * Who the next message goes to: "mediator" (picks who answers), "everyone" (each duck answers
 * on its own, once), or one duck's id.
 */
export type Target = string;

/**
 * The "To" row above the composer. Selecting a chip sets the recipient; a ring marks anyone
 * replying right now. The row scrolls sideways rather than wrapping.
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
  const row = useRef<HTMLDivElement>(null);
  // Keep the selected chip in view when the row scrolls.
  useLayoutEffect(() => {
    const chip = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    const box = row.current;
    if (!chip || !box) return;
    const left = chip.getBoundingClientRect().left - box.getBoundingClientRect().left;
    const right = left + chip.offsetWidth;
    if (left < 0) box.scrollLeft += left - 8;
    else if (right > box.clientWidth - 28) box.scrollLeft += right - box.clientWidth + 36;
  }, [target]);
  return (
    <div className="duck-bar" role="group" aria-label="Send to">
      <span className="duck-bar-label">To</span>
      <div className="duck-bar-scroll">
        <div className="duck-bar-chips" ref={row}>
          {ducks.length > 1 && (
            <>
              <Chip
                name="Mediator"
                avatar="wizard"
                color={hostColor}
                detail="Brings in the ducks who can help and reports back"
                selected={target === "mediator"}
                busy={busy.has("mediator") || busy.has("guide")}
                onSelect={() => onTarget("mediator")}
              />
              <button
                type="button"
                className="duck-chip everyone"
                aria-pressed={target === "everyone"}
                title="Every duck answers on its own without seeing the others, then Mediator sums up. Applies to one message."
                onClick={() => onTarget("everyone")}
              >
                <span className="stack" aria-hidden>
                  {ducks.slice(0, 3).map((duck) => (
                    <DuckAvatar key={duck.id} avatar={duckAvatar(duck)} small />
                  ))}
                </span>
                <span>Each separately</span>
              </button>
              <span className="duck-bar-divider" aria-hidden />
            </>
          )}
          {ducks.map((duck) => (
            <Chip
              key={duck.id}
              name={duck.name}
              avatar={duckAvatar(duck)}
              color={colors.get(duck.id)!}
              detail={`${duck.provider === "claude" ? "Claude" : "Codex"} · ${modelLabel(duck.model, duck.reasoning)}`}
              selected={target === duck.id}
              busy={busy.has(duck.id)}
              onSelect={() => onTarget(duck.id)}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="secondary-button compact"
        aria-label="Edit ducks"
        title="Edit the ducks in this conversation"
        onClick={onEdit}
        disabled={editDisabled}
      >
        <Users size={15} />
        <span>Ducks</span>
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
