import { useLayoutEffect, useRef, useState } from "react";
import { AtSign, Mic, Square } from "lucide-react";
import { duckAvatar, type Duck } from "../lib/room";
import { insertMention, mentionAt } from "../lib/mentions";
import { DuckAvatar } from "./duck-avatar";
import { useDictation } from "./use-dictation";

export function MentionInput({
  value,
  onChange,
  ducks,
  onSend,
  onDictatingChange,
}: {
  value: string;
  onChange: (value: string) => void;
  ducks: Duck[];
  onSend: () => void;
  onDictatingChange: (active: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(value, onChange, onDictatingChange);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    function resize() {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        resize();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
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
        readOnly={dictation.active}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setDismissed(false);
          setActive(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        placeholder="Think out loud, or @ a duck..."
        rows={1}
        enterKeyHint="enter"
        maxLength={20000}
        onKeyDown={(event) => {
          if (dictation.active) {
            if (event.key === "Enter") event.preventDefault();
            return;
          }
          if (event.nativeEvent.isComposing) return;
          if (
            event.key === "Enter" &&
            window.matchMedia("(max-width: 650px), (pointer: coarse)").matches
          ) {
            setDismissed(true);
            return;
          }
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
      <div className="input-tools">
        <button
          className="mention-trigger"
          type="button"
          onClick={invite}
          disabled={dictation.active}
        >
          <AtSign size={15} /> Invite a duck
        </button>
        <button
          className="mention-trigger dictation-trigger"
          type="button"
          aria-pressed={dictation.active}
          disabled={dictation.phase === "stopping"}
          onClick={() => {
            setDismissed(true);
            input.current?.blur();
            dictation.toggle();
          }}
        >
          {dictation.active ? <Square size={14} /> : <Mic size={15} />}
          {dictation.phase === "stopping"
            ? "Finishing…"
            : dictation.active
              ? "Stop dictation"
              : "Dictate"}
        </button>
      </div>
      {dictation.active && (
        <div className="dictation-status" role="status">
          {dictation.phase === "starting"
            ? "Waiting for the microphone…"
            : dictation.phase === "stopping"
              ? "Finishing your words…"
              : "Listening… Tap Stop dictation to edit or send."}
        </div>
      )}
      {dictation.error && (
        <div className="dictation-error" role="alert">
          {dictation.error}
        </div>
      )}
    </div>
  );
}
