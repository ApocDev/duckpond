import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { duckAvatar, duckRole, type Duck } from "../lib/room";
import { insertMention, mentionAt, mentionHandle } from "../lib/mentions";
import { rosterColors } from "../lib/duck-colors";
import { DuckAvatar } from "./duck-avatar";
import { useDictation } from "./use-dictation";

export function MentionInput({
  value,
  onChange,
  ducks,
  placeholder,
  exclude,
  onSend,
  onDictatingChange,
}: {
  value: string;
  onChange: (value: string) => void;
  ducks: Duck[];
  placeholder: string;
  /** A duck already receiving the message, so mentioning it would add nothing. */
  exclude?: string;
  onSend: () => void;
  onDictatingChange: (active: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const colors = useMemo(() => rosterColors(ducks), [ducks]);
  const dictation = useDictation(value, onChange, onDictatingChange);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    function resize() {
      if (!element) return;
      element.style.height = "0px";
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
    ? ducks.filter(
        (duck) =>
          duck.id !== exclude &&
          `${duck.name} ${duck.id} ${mentionHandle(duck, ducks)}`
            .toLowerCase()
            .includes(range.query),
      )
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
    const inserted = insertMention(value, range, mentionHandle(duck, ducks));
    onChange(inserted.text);
    setDismissed(true);
    focusAt(inserted.caret);
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
                <DuckAvatar avatar={duckAvatar(duck)} color={colors.get(duck.id)} />
                <span>
                  <strong style={{ color: colors.get(duck.id) }}>{duck.name}</strong>
                  <small>
                    @{mentionHandle(duck, ducks)} · {duckRole(duck.instructions)}
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
        placeholder={placeholder}
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
          className="icon-button dictation-trigger"
          type="button"
          aria-label={dictation.active ? "Stop dictation" : "Dictate"}
          title={dictation.active ? "Stop dictation" : "Dictate"}
          aria-pressed={dictation.active}
          disabled={dictation.phase === "stopping"}
          onClick={() => {
            setDismissed(true);
            input.current?.blur();
            dictation.toggle();
          }}
        >
          {dictation.active ? <Square size={14} /> : <Mic size={16} />}
        </button>
      </div>
      {dictation.active && (
        <div className="dictation-status" role="status">
          {dictation.phase === "starting"
            ? "Waiting for the microphone…"
            : dictation.phase === "stopping"
              ? "Finishing your words…"
              : "Listening… Tap the square to stop."}
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
