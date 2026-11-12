import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowUp, Menu, Plus, Square, Trash2, Users, X } from "lucide-react";
import { DuckAvatar } from "../components/duck-avatar";
import { DuckLibrary } from "../components/panel-ducks";
import { TurnView, type Ducks } from "../components/panel-turn";
import type { Panel, PanelDuck } from "../lib/panel";
import {
  createPanel,
  dropDuck,
  fetchPanel,
  loadPanelApp,
  lookUp,
  putDuck,
  removeDecision,
  removePanel,
  saveDecision,
  sendTurn,
  stopTurn,
  updatePanel,
} from "../server/panel.functions";

export const Route = createFileRoute("/panel")({
  validateSearch: z.object({
    id: z.string().uuid().optional(),
    view: z.enum(["ducks"]).optional(),
  }),
  loader: () => loadPanelApp(),
  component: PanelPage,
});

const starterPanel = ["simplifier", "skeptic", "weekend-gamer", "teen-gamer", "casual-player"];
const isRunning = (panel: Panel) =>
  panel.turns.some(
    (turn) => turn.status === "running" || turn.research.some((note) => note.status === "running"),
  );

function PanelPage() {
  const app = Route.useLoaderData();
  const { id, view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const ducks: Ducks = new Map(app.ducks.map((duck) => [duck.id, duck]));

  useEffect(() => {
    setPanel(undefined);
    setError("");
    if (id) fetchPanel({ data: id }).then(setPanel, (cause: Error) => setError(cause.message));
  }, [id]);

  // While ducks or research are working, poll for their replies. Every reply is saved as it lands.
  const running = panel ? isRunning(panel) : false;
  useEffect(() => {
    if (!panel || !running) return;
    const timer = setTimeout(() => {
      fetchPanel({ data: panel.id }).then(
        async (next) => {
          setPanel(next);
          if (!isRunning(next)) await router.invalidate();
        },
        () => {},
      );
    }, 1200);
    return () => clearTimeout(timer);
  }, [panel, running, router]);

  async function act<T>(task: () => Promise<T>) {
    setError("");
    try {
      return await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  async function startConversation(duckIds: string[], pondId: string | undefined, text: string) {
    const created = await act(() => createPanel({ data: { duckIds, pondId } }));
    if (!created) return;
    const started = await act(() => sendTurn({ data: { panelId: created.id, text, to: "panel" } }));
    await router.invalidate();
    await navigate({ search: { id: created.id } });
    if (started) setPanel(started);
  }

  return (
    <div className={`pn-shell ${menuOpen ? "menu-open" : ""}`}>
      <aside className="pn-sidebar">
        <div className="pn-brand">
          <DuckAvatar avatar="base" small />
          <strong>Duckpond</strong>
          <span className="pn-note">panel</span>
          <span className="spacer" />
          <button
            type="button"
            className="icon-button pn-mobile"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setMenuOpen(false);
            void navigate({ search: {} });
          }}
        >
          <Plus size={16} /> New question
        </button>
        <nav className="pn-list">
          {app.panels.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`pn-list-item ${item.id === id ? "selected" : ""}`}
              onClick={() => {
                setMenuOpen(false);
                void navigate({ search: { id: item.id } });
              }}
            >
              <span>{item.title}</span>
              {item.running && <i className="pn-live" aria-label="working" />}
            </button>
          ))}
        </nav>
        <div className="pn-sidebar-footer">
          <button
            type="button"
            className={`secondary-button ${view === "ducks" ? "selected" : ""}`}
            onClick={() => {
              setMenuOpen(false);
              void navigate({ search: { view: "ducks" } });
            }}
          >
            <Users size={16} /> Ducks
          </button>
          <a className="text-button" href="/">
            Classic Duckpond
          </a>
        </div>
      </aside>
      <main className="pn-main">
        <div className="pn-bar">
          <button
            type="button"
            className="icon-button pn-mobile"
            aria-label="Menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={18} />
          </button>
          <strong className="pn-title">
            {view === "ducks" ? "Ducks" : panel ? panel.title : id ? "" : "New question"}
          </strong>
          {panel && (
            <span className="pn-note">
              {app.ponds.find((pond) => pond.id === panel.pondId)?.name ?? "No project folder"}
            </span>
          )}
          <span className="spacer" />
          {panel && !running && (
            <button
              type="button"
              className="icon-button"
              aria-label="Delete conversation"
              onClick={async () => {
                if (!(await act(() => removePanel({ data: panel.id })))) return;
                await router.invalidate();
                await navigate({ search: {} });
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
        {!app.hasKey && (
          <p className="pn-banner">
            DUCKPOND_AI_GATEWAY_URL or DUCKPOND_AI_GATEWAY_KEY isn't set on the server, so the ducks
            can't reply. Add them to .env and restart.
          </p>
        )}
        {error && <p className="pn-banner error">{error}</p>}
        {view === "ducks" ? (
          <DuckLibrary
            ducks={app.ducks}
            onSave={async (duck) => {
              await putDuck({ data: duck });
              await router.invalidate();
            }}
            onDelete={async (duckId) => {
              await act(() => dropDuck({ data: duckId }));
              await router.invalidate();
            }}
          />
        ) : panel ? (
          <Conversation
            panel={panel}
            ducks={ducks}
            ponds={app.ponds}
            onChange={setPanel}
            act={act}
          />
        ) : id ? null : (
          <NewQuestion ducks={app.ducks} ponds={app.ponds} onStart={startConversation} />
        )}
      </main>
    </div>
  );
}

type Ponds = { id: string; name: string }[];

function DuckPicker({
  ducks,
  selected,
  onChange,
}: {
  ducks: PanelDuck[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="pn-picker">
      {(["adviser", "person"] as const).map((kind) => (
        <div key={kind}>
          <h4>{kind === "adviser" ? "Advisers" : "People"}</h4>
          {ducks
            .filter((duck) => duck.kind === kind)
            .map((duck) => (
              <label key={duck.id} className="pn-pick">
                <input
                  type="checkbox"
                  checked={selected.includes(duck.id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, duck.id]
                        : selected.filter((item) => item !== duck.id),
                    )
                  }
                />
                <DuckAvatar avatar={duck.avatar} small />
                <span>
                  <strong>{duck.name}</strong>
                  <small>{duck.model.split("/")[1]}</small>
                </span>
              </label>
            ))}
        </div>
      ))}
    </div>
  );
}

function PondSelect({
  ponds,
  value,
  onChange,
}: {
  ponds: Ponds;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  return (
    <label className="field">
      <span>Project folder for research</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">None, web only</option>
        {ponds.map((pond) => (
          <option key={pond.id} value={pond.id}>
            {pond.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function NewQuestion({
  ducks,
  ponds,
  onStart,
}: {
  ducks: PanelDuck[];
  ponds: Ponds;
  onStart: (duckIds: string[], pondId: string | undefined, text: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(
    starterPanel.filter((id) => ducks.some((duck) => duck.id === id)),
  );
  const [pondId, setPondId] = useState<string>();
  return (
    <div className="pn-new">
      <div className="pn-new-body">
        <h2>Who's on the panel?</h2>
        <p className="pn-note">
          Advisers weigh what's best for you. People say what they'd do, buy, or skip.
        </p>
        <DuckPicker ducks={ducks} selected={selected} onChange={setSelected} />
        <PondSelect ponds={ponds} value={pondId} onChange={setPondId} />
      </div>
      <Composer
        placeholder="Ask the panel a question…"
        disabled={!selected.length}
        onSend={(text) => onStart(selected, pondId, text)}
      />
    </div>
  );
}

function Conversation({
  panel,
  ducks,
  ponds,
  onChange,
  act,
}: {
  panel: Panel;
  ducks: Ducks;
  ponds: Ponds;
  onChange: (panel: Panel) => void;
  act: <T>(task: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [to, setTo] = useState("panel");
  const [editing, setEditing] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const turnRunning = panel.turns.some((turn) => turn.status === "running");
  const latestBrief = panel.turns.findLast((turn) => turn.brief);
  const waitingCall =
    latestBrief && !panel.decisions.some((decision) => decision.turnId === latestBrief.id)
      ? latestBrief.brief?.question
      : undefined;
  const researching = panel.turns.flatMap((turn) =>
    turn.research.filter((note) => note.status === "running"),
  );

  // New turns land at the bottom; follow them there.
  const count = panel.turns.length;
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: "smooth" });
  }, [count]);

  async function update(task: () => Promise<Panel>) {
    const next = await act(task);
    if (next) onChange(next);
  }

  return (
    <div className="pn-convo">
      <div className="pn-thread" ref={thread}>
        <div className="pn-column">
          {panel.turns.map((turn, index) => (
            <TurnView
              key={turn.id}
              turn={turn}
              ducks={ducks}
              latest={index === panel.turns.length - 1}
              decision={panel.decisions.find((decision) => decision.turnId === turn.id)}
              onDecide={(text) =>
                update(() => saveDecision({ data: { panelId: panel.id, turnId: turn.id, text } }))
              }
              onLookUp={(question) =>
                update(() => lookUp({ data: { panelId: panel.id, turnId: turn.id, question } }))
              }
            />
          ))}
        </div>
      </div>
      <aside className="pn-rail">
        <section>
          <h4>
            Panel
            <button type="button" className="text-button" onClick={() => setEditing(!editing)}>
              {editing ? "Done" : "Edit"}
            </button>
          </h4>
          {editing ? (
            <>
              <DuckPicker
                ducks={[...ducks.values()]}
                selected={panel.duckIds}
                onChange={(duckIds) =>
                  duckIds.length && update(() => updatePanel({ data: { id: panel.id, duckIds } }))
                }
              />
              <PondSelect
                ponds={ponds}
                value={panel.pondId}
                onChange={(pondId) =>
                  update(() => updatePanel({ data: { id: panel.id, pondId: pondId ?? null } }))
                }
              />
            </>
          ) : (
            <ul className="pn-rail-ducks">
              {panel.duckIds.map((duckId) => (
                <li key={duckId}>
                  <DuckAvatar avatar={ducks.get(duckId)?.avatar ?? "base"} small />
                  {ducks.get(duckId)?.name ?? duckId}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4>Decided here</h4>
          {panel.decisions.length ? (
            <ol>
              {panel.decisions.map((decision) => (
                <li key={decision.id}>
                  {decision.text}
                  <button
                    type="button"
                    className="text-button"
                    aria-label="Remove decision"
                    onClick={() =>
                      update(() =>
                        removeDecision({ data: { panelId: panel.id, decisionId: decision.id } }),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="pn-note">Nothing yet. Save a decision under a brief or a reply.</p>
          )}
        </section>
        {(researching.length > 0 || waitingCall) && (
          <section>
            <h4>Waiting on</h4>
            {researching.map((note) => (
              <p key={note.id} className="pn-waiting research">
                Research: {note.question}
              </p>
            ))}
            {waitingCall && <p className="pn-waiting">Your call: {waitingCall}</p>}
          </section>
        )}
      </aside>
      <Composer
        placeholder={to === "panel" ? "Ask the panel…" : `Ask ${ducks.get(to)?.name}…`}
        disabled={turnRunning}
        busy={turnRunning}
        onStop={() => act(() => stopTurn({ data: panel.id }))}
        onSend={(text) => update(() => sendTurn({ data: { panelId: panel.id, text, to } }))}
        to={{
          value: to,
          onChange: setTo,
          options: [
            ["panel", `Panel (${panel.duckIds.length})`],
            ...panel.duckIds.map(
              (duckId) => [duckId, ducks.get(duckId)?.name ?? duckId] as [string, string],
            ),
          ],
        }}
      />
    </div>
  );
}

function Composer({
  placeholder,
  disabled,
  busy = false,
  onSend,
  onStop,
  to,
}: {
  placeholder: string;
  disabled: boolean;
  busy?: boolean;
  onSend: (text: string) => Promise<void>;
  onStop?: () => void;
  to?: { value: string; onChange: (value: string) => void; options: [string, string][] };
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  async function send() {
    if (!text.trim() || disabled || sending) return;
    setSending(true);
    try {
      await onSend(text.trim());
      setText("");
    } finally {
      setSending(false);
    }
  }
  return (
    <form
      className="pn-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {to && (
        <select
          aria-label="Send to"
          value={to.value}
          onChange={(event) => to.onChange(event.target.value)}
        >
          {to.options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
      <textarea
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {busy ? (
        <button type="button" className="secondary-button" onClick={onStop}>
          <Square size={14} /> Stop
        </button>
      ) : (
        <button
          type="submit"
          className="primary-button"
          disabled={disabled || sending || !text.trim()}
          aria-label="Send"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </form>
  );
}
