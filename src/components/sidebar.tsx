import { useRef, useState } from "react";
import { MoreHorizontal, Plus, Settings, SlidersHorizontal } from "lucide-react";
import type { Room } from "../lib/room";
import type { connections } from "../server/rooms.functions";
import { useDismiss } from "./use-dismiss";

type Connection = Awaited<ReturnType<typeof connections>>[number];
const newPond = "__new";

/** Pond picker, conversation list, and provider status. */
export function Sidebar({
  ponds,
  pondId,
  rooms,
  selected,
  locked,
  status,
  open,
  onPond,
  onNewPond,
  onPondDefaults,
  onNew,
  onSelect,
  onMove,
  onDelete,
  onSettings,
}: {
  ponds: { id: string; name: string; error: string | null }[];
  pondId: string | null;
  rooms: Room[];
  selected: string | null;
  /** Switching is blocked while ducks reply or a save runs. */
  locked: boolean;
  status: Connection[];
  open: boolean;
  onPond: (id: string | null) => void;
  onNewPond: () => void;
  onPondDefaults: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onMove: (room: Room) => void;
  onDelete: (room: Room) => void;
  onSettings: () => void;
}) {
  const pond = ponds.find((item) => item.id === pondId);
  const signedOut = status.filter((item) => !item.connected);
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <a className="brand" href="/">
        <img src="/brand/base.png" alt="" />
        Duckpond
      </a>
      <div className="pond-picker">
        <label htmlFor="pond">Pond</label>
        <div className="row">
          <select
            id="pond"
            value={pondId ?? ""}
            disabled={locked}
            onChange={(event) =>
              event.target.value === newPond ? onNewPond() : onPond(event.target.value || null)
            }
          >
            <option value="">General</option>
            {ponds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.error ? " (unavailable)" : ""}
              </option>
            ))}
            <option value={newPond}>New pond…</option>
          </select>
          <button
            type="button"
            className="icon-button"
            disabled={locked || !pond || !!pond.error}
            title={pond ? `${pond.name} default ducks` : "General uses the built-in ducks"}
            aria-label="Pond default ducks"
            onClick={onPondDefaults}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
        {pond?.error && <p className="field-error">{pond.error}</p>}
      </div>
      <button
        type="button"
        className="secondary-button new-conversation"
        disabled={locked || !!pond?.error}
        onClick={onNew}
      >
        <Plus size={16} /> New conversation
      </button>
      <nav className="conversation-list" aria-label="Conversation list">
        {rooms.length ? (
          rooms.map((room) => (
            <ConversationRow
              key={room.id}
              room={room}
              selected={room.id === selected}
              locked={locked}
              onSelect={() => onSelect(room.id)}
              onMove={() => onMove(room)}
              onDelete={() => onDelete(room)}
            />
          ))
        ) : (
          <p className="muted empty-list">No conversations in this pond yet.</p>
        )}
      </nav>
      <footer className="sidebar-footer">
        <span className="connections" title="Provider sign-in status">
          {(["claude", "codex"] as const).map((provider) => {
            const connection = status.find((item) => item.provider === provider);
            return (
              <span key={provider}>
                <i className={`status-dot ${connection?.connected ? "connected" : ""}`} />
                {provider === "claude" ? "Claude" : "Codex"}
              </span>
            );
          })}
        </span>
        <button type="button" className="icon-button" aria-label="Settings" onClick={onSettings}>
          <Settings size={16} />
        </button>
        {!!signedOut.length && (
          <button type="button" className="banner warning" onClick={onSettings}>
            {signedOut
              .map((item) => (item.provider === "claude" ? "Claude" : "Codex"))
              .join(" and ")}{" "}
            needs sign-in
          </button>
        )}
      </footer>
    </aside>
  );
}

function ConversationRow({
  room,
  selected,
  locked,
  onSelect,
  onMove,
  onDelete,
}: {
  room: Room;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useDismiss(wrapper, menu, () => setMenu(false));
  return (
    <div className="conversation-row" ref={wrapper}>
      <button
        type="button"
        className="conversation-link"
        aria-current={selected ? "page" : undefined}
        disabled={locked}
        title={room.title}
        onClick={onSelect}
      >
        {room.title}
      </button>
      <button
        type="button"
        className="icon-button row-menu-button"
        aria-label={`Options for ${room.title}`}
        aria-expanded={menu}
        disabled={locked}
        onClick={() => setMenu(!menu)}
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div className="popover menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              onMove();
            }}
          >
            Move to another pond
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setMenu(false);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
