import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Users } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { hostColor, rosterColors } from "../lib/duck-colors";
import { modelLabel } from "../lib/models";
import { DuckAvatar } from "./duck-avatar";
import { useDismiss } from "./use-dismiss";

/**
 * Who the next message goes to: "mediator" (picks who answers), "everyone" (each duck answers
 * on its own, once), or one duck's id.
 */
export type Target = string;

type Choice = {
  value: Target;
  name: string;
  avatar?: NonNullable<Duck["avatar"]>;
  color: string;
  /** One line shown in the phone picker and as a tooltip. */
  detail: string;
  once?: boolean;
  busy: boolean;
};

/**
 * The "To" row above the composer. On wide screens every choice is a chip; on phones one button
 * shows the current choice and opens the full list. A ring marks anyone replying right now.
 */
export function DuckBar({
  ducks,
  target,
  thinking,
  editLabel,
  onTarget,
  onEdit,
}: {
  ducks: Duck[];
  target: Target;
  thinking: Message[];
  /** "Ducks", or a read-only hint while a turn runs. */
  editLabel: string;
  onTarget: (target: Target) => void;
  onEdit: () => void;
}) {
  const colors = useMemo(() => rosterColors(ducks), [ducks]);
  const busy = new Set(thinking.map((message) => message.duckId));
  const choices: Choice[] = [
    {
      value: "mediator",
      name: "Mediator",
      avatar: "wizard",
      color: hostColor,
      detail: "Brings in the ducks who can help, lets them push back, and reports back.",
      busy: busy.has("mediator") || busy.has("guide"),
    },
    ...(ducks.length > 1
      ? [
          {
            value: "everyone",
            name: "Each separately",
            color: "var(--text-2)",
            detail: "Every duck answers without seeing the others, then Mediator sums up.",
            once: true,
            busy: false,
          },
        ]
      : []),
    ...ducks.map((duck) => ({
      value: duck.id,
      name: duck.name,
      avatar: duckAvatar(duck),
      color: colors.get(duck.id)!,
      detail: `${duck.instructions.split(/(?<=[.!?])\s/)[0]} · ${modelLabel(duck.model, duck.reasoning)}`,
      busy: busy.has(duck.id),
    })),
  ];
  const current = choices.find((choice) => choice.value === target) ?? choices[0];
  return (
    <div className="duck-bar" role="group" aria-label="Send to">
      <span className="duck-bar-label">To</span>
      <div className="duck-bar-chips">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={`duck-chip ${choice.busy ? "busy" : ""}`}
            aria-pressed={choice.value === target}
            title={`${choice.name}: ${choice.detail}`}
            style={{ "--duck": choice.color }}
            onClick={() => onTarget(choice.value)}
          >
            <ChoiceIcon choice={choice} ducks={ducks} />
            <span>{choice.name}</span>
            {choice.once && <em className="once">once</em>}
          </button>
        ))}
      </div>
      <TargetPicker choices={choices} current={current} ducks={ducks} onTarget={onTarget} />
      <button
        type="button"
        className="secondary-button compact ducks-button"
        aria-label={editLabel}
        title="See and edit the ducks in this conversation"
        onClick={onEdit}
      >
        <Users size={15} />
        <span>{editLabel}</span>
      </button>
    </div>
  );
}

function ChoiceIcon({ choice, ducks }: { choice: Choice; ducks: Duck[] }) {
  if (choice.avatar) return <DuckAvatar avatar={choice.avatar} small color={choice.color} />;
  return (
    <span className="group-icon" aria-hidden>
      <Users size={14} />
      {ducks.length}
    </span>
  );
}

/** Phone-only: the current recipient as one button that opens the full, labeled list. */
function TargetPicker({
  choices,
  current,
  ducks,
  onTarget,
}: {
  choices: Choice[];
  current: Choice;
  ducks: Duck[];
  onTarget: (target: Target) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useDismiss(wrapper, open, () => setOpen(false));
  return (
    <div className="target-picker" ref={wrapper}>
      <button
        type="button"
        className={`duck-chip current ${current.busy ? "busy" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ "--duck": current.color }}
        onClick={() => setOpen(!open)}
      >
        <ChoiceIcon choice={current} ducks={ducks} />
        <span>{current.name}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="popover target-sheet" role="listbox" aria-label="Send to">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="option"
              aria-selected={choice.value === current.value}
              style={{ "--duck": choice.color }}
              onClick={() => {
                onTarget(choice.value);
                setOpen(false);
              }}
            >
              <ChoiceIcon choice={choice} ducks={ducks} />
              <span>
                <strong>
                  {choice.name}
                  {choice.once && <em className="once">once</em>}
                </strong>
                <small>{choice.detail}</small>
              </span>
              {choice.value === current.value && <Check size={16} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
