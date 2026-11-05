import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useDismiss } from "./use-dismiss";

export type SelectOption = {
  value: string;
  label: string;
  /** Secondary line under the label, such as a folder path. */
  detail?: string;
  disabled?: boolean;
  /** Draws a divider above this option, for trailing actions like "New pond…". */
  separated?: boolean;
};

/**
 * A styled single-select listbox. The list uses fixed positioning so scrolling dialogs and panels
 * can't clip it, opens upward when there's no room below, and supports arrow keys, Home/End,
 * type-ahead, Enter/Space, and Escape (without closing a surrounding dialog).
 */
export function Select({
  value,
  options,
  onChange,
  label,
  id,
  disabled = false,
  className = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name when there is no visible <label htmlFor>. */
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const typed = useRef({ text: "", at: 0 });
  const selected = options.find((option) => option.value === value);
  const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));

  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }
  useDismiss(wrapper, open, () => close(false));

  function show() {
    if (disabled || !enabled.length) return;
    const index = options.findIndex((option) => option.value === value);
    setActive(index >= 0 && !options[index].disabled ? index : enabled[0]);
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  }
  function move(step: 1 | -1) {
    const at = enabled.indexOf(active);
    setActive(enabled[Math.min(enabled.length - 1, Math.max(0, at + step))] ?? active);
  }
  function typeAhead(key: string) {
    const now = Date.now();
    typed.current = {
      text:
        now - typed.current.at < 600 ? typed.current.text + key.toLowerCase() : key.toLowerCase(),
      at: now,
    };
    const match = enabled.find((index) =>
      options[index].label.toLowerCase().startsWith(typed.current.text),
    );
    if (match !== undefined) setActive(match);
  }

  // Place the list against the trigger each time it opens.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < 220 && above > below;
    setPosition({
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 200) - 8),
      minWidth: rect.width,
      maxHeight: Math.min(320, upward ? above : below),
      ...(upward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
    list.current?.focus({ preventScroll: true });
  }, [open]);
  // A fixed list would drift from its trigger, so close it when anything else scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    function onScroll(event: Event) {
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      close(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);
  // Keep the active option visible by scrolling only the list, never its ancestors.
  useLayoutEffect(() => {
    const box = list.current;
    const item = box?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !box || !item) return;
    if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight;
  }, [open, active]);

  return (
    <div className={`select ${className}`} ref={wrapper}>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="select-value">{selected?.label ?? value}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          className="select-list"
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          style={position}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") move(1);
            else if (event.key === "ArrowUp") move(-1);
            else if (event.key === "Home") setActive(enabled[0]);
            else if (event.key === "End") setActive(enabled[enabled.length - 1]);
            else if (event.key === "Enter" || event.key === " ") choose(active);
            else if (event.key === "Escape") close();
            else if (event.key === "Tab") {
              close(false);
              return;
            } else if (event.key.length === 1) typeAhead(event.key);
            else return;
            // Keep Escape and arrows from reaching a surrounding dialog or the page.
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              className={`select-option ${index === active ? "active" : ""} ${option.separated ? "separated" : ""}`}
              onPointerMove={() => !option.disabled && setActive(index)}
              onClick={() => choose(index)}
            >
              <span>
                {option.label}
                {option.detail && <small>{option.detail}</small>}
              </span>
              {option.value === value && <Check size={14} aria-hidden />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
