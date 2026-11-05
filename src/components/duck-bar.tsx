import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Users } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { hostColor, rosterColors } from "../lib/duck-colors";
import { DuckAvatar } from "./duck-avatar";
import { useDismiss } from "./use-dismiss";

/**
 * Who the next message goes to: "mediator" (picks who answers), "everyone" (each duck answers
 * on its own), or one duck's id. The choice sticks until you change it.
 */
export type Target = string;

type Choice = {
  value: Target;
  name: string;
  avatar?: NonNullable<Duck["avatar"]>;
  /** Several small avatars instead of one, for "Each separately". */
  stack?: NonNullable<Duck["avatar"]>[];
  color: string;
  /** One line shown in the pickers and as a tooltip. */
  detail: string;
  busy: boolean;
};

/**
 * The "To" row above the composer: Mediator, Each separately, or one duck, the same three ways
 * the empty conversation explains. Wide screens show them side by side, with ducks in one picker;
 * phones show the current choice as one button that opens all of them.
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
  const mediator: Choice = {
    value: "mediator",
    name: "Mediator",
    avatar: "wizard",
    color: hostColor,
    detail: "Brings in the ducks who can help, lets them push back, and reports back.",
    busy: busy.has("mediator") || busy.has("guide"),
  };
  const everyone: Choice = {
    value: "everyone",
    name: "Each separately",
    stack: ducks.slice(0, 3).map(duckAvatar),
    color: "var(--text-2)",
    detail: "Every duck answers without seeing the others, then Mediator sums up.",
    busy: false,
  };
  const duckChoices: Choice[] = ducks.map((duck) => ({
    value: duck.id,
    name: duck.name,
    avatar: duckAvatar(duck),
    color: colors.get(duck.id)!,
    detail: duck.instructions.split(/(?<=[.!?])\s/)[0],
    busy: busy.has(duck.id),
  }));
  const modes = [mediator, ...(ducks.length > 1 ? [everyone] : [])];
  const current = [...modes, ...duckChoices].find((choice) => choice.value === target) ?? mediator;
  const direct = duckChoices.find((choice) => choice.value === target);
  return (
    <div className="duck-bar" role="group" aria-label="Send to">
      <span className="duck-bar-label">To</span>
      <div className="mode-switch">
        <ModeButton choice={mediator} pressed={target === "mediator"} onTarget={onTarget} />
        {ducks.length > 1 && (
          <ModeButton choice={everyone} pressed={target === "everyone"} onTarget={onTarget} />
        )}
        {ducks.length > 1 ? (
          <Picker
            className="mode"
            pressed={!!direct}
            groups={[{ choices: duckChoices }]}
            current={direct}
            label="One duck"
            trigger={
              direct ? (
                <>
                  <ChoiceIcon choice={direct} />
                  <span>{direct.name}</span>
                </>
              ) : (
                <span className="mode-placeholder">One duck</span>
              )
            }
            onPick={onTarget}
          />
        ) : (
          <ModeButton choice={duckChoices[0]} pressed={!!direct} onTarget={onTarget} />
        )}
      </div>
      <Picker
        className="target-picker-button"
        wrapperClassName="target-picker"
        pressed
        groups={[
          { label: "How to ask", choices: modes },
          { label: "One duck", choices: duckChoices },
        ]}
        current={current}
        label="Send to"
        trigger={
          <>
            <ChoiceIcon choice={current} />
            <span>{current.name}</span>
          </>
        }
        onPick={onTarget}
      />
      <button
        type="button"
        className="secondary-button compact ducks-button"
        aria-label={editLabel}
        title="See and edit the ducks in this conversation"
        onClick={onEdit}
      >
        <Users size={15} aria-hidden />
        <span>{editLabel}</span>
      </button>
    </div>
  );
}

function ModeButton({
  choice,
  pressed,
  onTarget,
}: {
  choice: Choice;
  pressed: boolean;
  onTarget: (target: Target) => void;
}) {
  return (
    <button
      type="button"
      className={`mode ${choice.busy ? "busy" : ""}`}
      aria-pressed={pressed}
      title={choice.detail}
      onClick={() => onTarget(choice.value)}
    >
      <ChoiceIcon choice={choice} />
      <span>{choice.name}</span>
    </button>
  );
}

function ChoiceIcon({ choice }: { choice: Choice }) {
  if (choice.avatar) return <DuckAvatar avatar={choice.avatar} small color={choice.color} />;
  return (
    <span className="roster-stack" aria-hidden>
      {choice.stack?.map((avatar, index) => (
        <DuckAvatar key={index} avatar={avatar} small />
      ))}
    </span>
  );
}

/**
 * A button that opens a list of choices above it, each with its avatar and a short description.
 * Arrow keys move through the list; Escape or a pick returns focus to the button.
 */
function Picker({
  className,
  wrapperClassName = "picker",
  pressed,
  groups,
  current,
  label,
  trigger,
  onPick,
}: {
  className: string;
  wrapperClassName?: string;
  pressed: boolean;
  groups: { label?: string; choices: Choice[] }[];
  current?: Choice;
  label: string;
  trigger: ReactNode;
  onPick: (target: Target) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    button.current?.focus();
  }
  useDismiss(wrapper, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const list = wrapper.current?.querySelector<HTMLElement>("[role=listbox]");
    (
      list?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      list?.querySelector<HTMLElement>("[role=option]")
    )?.focus();
  }, [open]);
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=option]")];
    const index = options.findIndex((option) => option === document.activeElement);
    const next =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? options.length - 1
              : undefined;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (next === undefined) return;
    event.preventDefault();
    options[(next + options.length) % options.length]?.focus();
  }
  return (
    <div className={wrapperClassName} ref={wrapper}>
      <button
        ref={button}
        type="button"
        className={`${className} ${current?.busy ? "busy" : ""}`}
        aria-pressed={pressed}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={current ? `${current.name}: ${current.detail}` : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="popover picker-list" role="listbox" aria-label={label} onKeyDown={move}>
          {groups.map((group) => (
            <div key={group.label ?? "choices"} role="group" aria-label={group.label}>
              {group.label && <p className="picker-group">{group.label}</p>}
              {group.choices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  role="option"
                  aria-selected={choice.value === current?.value}
                  onClick={() => {
                    onPick(choice.value);
                    close();
                  }}
                >
                  <ChoiceIcon choice={choice} />
                  <span>
                    <strong>{choice.name}</strong>
                    <small>{choice.detail}</small>
                  </span>
                  {choice.value === current?.value && <Check size={16} aria-hidden />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
