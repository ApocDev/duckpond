import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { combineDucks, defaults, duckAvatar, type Duck, type DuckGroup } from "../lib/room";
import { reusableDucks } from "../server/rooms.functions";
import { DuckAvatar } from "./duck-avatar";

export function DuckPicker({
  onStart,
  onClose,
}: {
  onStart: (ducks: Duck[]) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<DuckGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let disposed = false;
    reusableDucks()
      .then((value) => {
        if (!disposed) setGroups(value);
      })
      .catch(() => {
        if (!disposed) setError("Couldn't load existing ducks. Close and try again.");
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const chosen = combineDucks(
    groups.flatMap((group) =>
      group.ducks.filter((duck) => selected.includes(`${group.id}/${duck.id}`)),
    ),
  );
  async function start(ducks: Duck[]) {
    setStarting(true);
    setError("");
    try {
      await onStart(ducks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't start a conversation.");
      setStarting(false);
    }
  }
  const query = search.trim().toLowerCase();
  const matching = groups
    .map((group) => ({
      ...group,
      ducks: group.title.toLowerCase().includes(query)
        ? group.ducks
        : group.ducks.filter((duck) => duck.name.toLowerCase().includes(query)),
    }))
    .filter((group) => group.ducks.length);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog duck-picker"
      aria-labelledby="duck-picker-title"
      onCancel={(event) => {
        if (starting) event.preventDefault();
        else onClose();
      }}
    >
      <div className="settings-heading">
        <h2 id="duck-picker-title">Start with existing ducks</h2>
        <button
          className="icon-button"
          aria-label="Close duck picker"
          disabled={starting}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p className="settings-intro">
        Choose individual ducks or bring a whole group. Messages and shared notes start fresh.
      </p>
      <label>
        Search ducks or conversations
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Game dev, Visual Director..."
        />
      </label>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="settings-intro">Loading ducks...</p>
      ) : (
        !matching.length && (
          <p className="settings-intro">
            {groups.length
              ? "No matching ducks."
              : "Ducks from your conversations will appear here."}
          </p>
        )
      )}
      {matching.map((group) => {
        const keys = group.ducks.map((duck) => `${group.id}/${duck.id}`);
        const allSelected = keys.every((key) => selected.includes(key));
        return (
          <section className="duck-picker-group" key={group.id}>
            <div className="roster-heading">
              <strong>{group.title}</strong>
              <button
                className="text-button"
                disabled={starting}
                onClick={() =>
                  setSelected((current) =>
                    allSelected
                      ? current.filter((key) => !keys.includes(key))
                      : [...new Set([...current, ...keys])],
                  )
                }
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            {group.ducks.map((duck) => {
              const key = `${group.id}/${duck.id}`;
              return (
                <label className="duck-picker-option" key={key}>
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    disabled={starting}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, key]
                          : current.filter((item) => item !== key),
                      )
                    }
                  />
                  <DuckAvatar avatar={duckAvatar(duck)} small />
                  <span>
                    <strong>{duck.name}</strong>
                    <small>
                      {duck.provider === "claude" ? "Claude" : "Codex"} ·{" "}
                      {duck.model || "Account default"}
                      {duck.reasoning ? ` · ${duck.reasoning}` : ""}
                    </small>
                  </span>
                </label>
              );
            })}
          </section>
        );
      })}
      <div className="duck-picker-footer">
        <p className="settings-intro">
          Each conversation has its own copy of the ducks. You can create or edit ducks in room
          settings.
        </p>
        <div className="settings-actions">
          <button className="text-button" disabled={starting} onClick={() => void start(defaults)}>
            Use default ducks
          </button>
          <button
            className="primary-button"
            disabled={starting || !chosen.length}
            onClick={() => void start(chosen)}
          >
            {starting ? "Starting..." : `Start conversation (${chosen.length})`}
          </button>
        </div>
      </div>
    </dialog>
  );
}
