import { useRef, useState } from "react";
import { AtSign } from "lucide-react";
import { duckAvatar, type Duck } from "../lib/room";
import { insertMention, mentionAt } from "../lib/mentions";
import { DuckAvatar } from "./duck-avatar";

export function MentionInput({
  value,
  onChange,
  ducks,
  onSend,
}: {
  value: string;
  onChange: (value: string) => void;
  ducks: Duck[];
  onSend: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const range = dismissed ? null : mentionAt(value, caret);
  const options = range
    ? ducks.filter((duck) => `${duck.name} ${duck.id}`.toLowerCase().includes(range.query))
    : [];
  const open = range !== null;
  const selected = Math.min(active, Math.max(0, options.length - 1));
  function focusAt(position: number) {
    setCaret(position);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  }
  function choose(duck: Duck) {
    if (!range) return;
    const inserted = insertMention(value, range, duck.id);
    onChange(inserted.text);
    setDismissed(true);
    focusAt(inserted.caret);
  }
  function invite() {
    const start = input.current?.selectionStart ?? value.length;
    const end = input.current?.selectionEnd ?? start;
    const current = mentionAt(value, start);
    if (current) {
      setDismissed(false);
      focusAt(start);
      return;
    }
    const prefix = value.slice(0, start) + (start > 0 && !/\s/.test(value[start - 1]) ? " @" : "@");
    onChange(prefix + value.slice(end));
    setDismissed(false);
    setActive(0);
    focusAt(prefix.length);
  }
  return (
    <div
      className="mention-input"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDismissed(true);
      }}
    >
      {open && (
        <div
          className="mention-picker"
          id="duck-mentions"
          role="listbox"
          aria-label="Available ducks"
        >
          {options.length ? (
            options.map((duck, index) => (
              <button
                id={`mention-${duck.id}`}
                key={duck.id}
                type="button"
                role="option"
                aria-selected={index === selected}
                tabIndex={-1}
                onClick={() => choose(duck)}
              >
                <DuckAvatar avatar={duckAvatar(duck)} />
                <span>
                  {duck.name}
                  <small>
                    @{duck.id} · {duck.provider === "claude" ? "Claude" : "Codex"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>No matching ducks.</p>
          )}
        </div>
      )}
      <textarea
        ref={input}
        aria-label="Message"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? "duck-mentions" : undefined}
        aria-activedescendant={
          open && options[selected] ? `mention-${options[selected].id}` : undefined
        }
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setDismissed(false);
          setActive(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        placeholder="Think out loud, or @ a duck..."
        rows={3}
        maxLength={20000}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            if (options.length)
              setActive(
                (selected + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length,
              );
          } else if (
            open &&
            !event.shiftKey &&
            (event.key === "Enter" || event.key === "Tab") &&
            options[selected]
          ) {
            event.preventDefault();
            choose(options[selected]);
          } else if (open && event.key === "Escape") {
            event.preventDefault();
            setDismissed(true);
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!open) onSend();
          }
        }}
      />
      <button className="mention-trigger" type="button" onClick={invite}>
        <AtSign size={15} /> Invite a duck
      </button>
    </div>
  );
}
