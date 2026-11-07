import { useRef, useState } from "react";
import { MoreHorizontal, Plus, Search, Settings, Settings2 } from "lucide-react";
import type { Room } from "../lib/room";
import type { connections } from "../server/rooms.functions";
import { Select } from "./select";
import { useDismiss } from "./use-dismiss";

type Connection = Awaited<ReturnType<typeof connections>>[number];
const newPond = "__new";

/** Pond picker, conversation list, and provider status. */
export function Sidebar({
  ponds,
  pondId,
  rooms,
  selected,
  working,
  waiting,
  locked,
  status,
  open,
  onPond,
  onNewPond,
  onPondSettings,
  onNew,
  onSelect,
  onRename,
  onMove,
  onDelete,
  onSettings,
}: {
  ponds: { id: string; name: string; workspace: string; error: string | null }[];
  pondId: string | null;
  rooms: Room[];
  selected: string | null;
  /** Conversations with a turn running; they get a "replying" dot. */
  working: Set<string>;
  /** Conversations where a duck is waiting for your answer; they get a "needs you" tag. */
  waiting: Set<string>;
  /** Switching is blocked only while a save or dictation runs. */
  locked: boolean;
  status: Connection[];
  open: boolean;
  onPond: (id: string | null) => void;
  onNewPond: () => void;
  onPondSettings: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (room: Room) => void;
  onMove: (room: Room) => void;
  onDelete: (room: Room) => void;
  onSettings: () => void;
}) {
  const pond = ponds.find((item) => item.id === pondId);
  const signedOut = status.filter((item) => !item.connected);
  const [query, setQuery] = useState("");
  const shown = query.trim()
    ? rooms.filter((room) => room.title.toLowerCase().includes(query.trim().toLowerCase()))
    : rooms;
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <a className="brand" href="/">
        <img src="/brand/base.png" alt="" />
        Duckpond
      </a>
      <div className="pond-picker">
        <label htmlFor="pond">Pond</label>
        <Select
          id="pond"
          value={pondId ?? ""}
          disabled={locked}
          options={[
            { value: "", label: "General", detail: "No project folder" },
            ...ponds.map((item) => ({
              value: item.id,
              label: item.error ? `${item.name} (unavailable)` : item.name,
              detail: item.workspace,
            })),
            { value: newPond, label: "New pond…", separated: true },
          ]}
          onChange={(value) => (value === newPond ? onNewPond() : onPond(value || null))}
        />
        <div className="pond-meta">
          <small className="pond-path" title={pond?.workspace}>
            {/* bdi keeps the path's own order while the ellipsis trims its start. */}
            <bdi>{pond ? shortPath(pond.workspace) : "No project folder"}</bdi>
          </small>
          {pond && !pond.error && (
            <button
              type="button"
              className="text-button"
              disabled={locked}
              title={`${pond.name}: name and the ducks new conversations start with`}
              onClick={onPondSettings}
            >
              <Settings2 size={13} /> Pond settings
            </button>
          )}
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
      {rooms.length > 6 && (
        <label className="search-box">
          <Search size={14} aria-hidden />
          <input
            value={query}
            placeholder="Find a conversation"
            aria-label="Find a conversation"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      <nav className="conversation-list" aria-label="Conversation list">
        {shown.length ? (
          shown.map((room) => (
            <ConversationRow
              key={room.id}
              room={room}
              selected={room.id === selected}
              working={working.has(room.id)}
              waiting={waiting.has(room.id)}
              locked={locked}
              onSelect={() => onSelect(room.id)}
              onRename={() => onRename(room)}
              onMove={() => onMove(room)}
              onDelete={() => onDelete(room)}
            />
          ))
        ) : (
          <p className="muted empty-list">
            {rooms.length ? "No matching conversations." : "No conversations in this pond yet."}
          </p>
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
  working,
  waiting,
  locked,
  onSelect,
  onRename,
  onMove,
  onDelete,
}: {
  room: Room;
  selected: boolean;
  working: boolean;
  waiting: boolean;
  locked: boolean;
  onSelect: () => void;
  onRename: () => void;
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
        <span>{room.title}</span>
        {waiting ? (
          <em className="waiting-tag" title="A duck is waiting for your answer">
            needs you
          </em>
        ) : (
          working && <i className="working-dot" aria-label="replying" title="Replying" />
        )}
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
              onRename();
            }}
          >
            Rename
          </button>
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

/** "~/code/shelf", or "…/ponds/shelf" for deeper folders, so the sidebar shows which folder. */
function shortPath(path: string) {
  const parts = path
    .replace(/^\/home\/[^/]+/, "~")
    .split("/")
    .filter(Boolean);
  return parts.length > 3
    ? `…/${parts.slice(-2).join("/")}`
    : `${path.startsWith("/home/") ? "" : "/"}${parts.join("/")}`;
}
