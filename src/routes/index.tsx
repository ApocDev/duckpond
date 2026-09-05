import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronDown,
  Circle,
  MessageCircle,
  NotebookPen,
  Plus,
  Settings2,
  Square,
  Users,
  X,
} from "lucide-react";
import Markdown from "react-markdown";
import { Settings } from "../components/settings";
import { DuckAvatar } from "../components/duck-avatar";
import { MentionInput } from "../components/mention-input";
import { Transcript } from "../components/transcript";
import {
  answerApproval,
  connections,
  loadRooms,
  newRoom,
  stopRoom,
  updateRoom,
} from "../server/rooms.functions";
import {
  defaults,
  duckSchema,
  duckAvatar,
  modeSchema,
  type Approval,
  type Duck,
  type Message,
  type Mode,
  type Room,
  type RoomStream,
} from "../lib/room";

export const Route = createFileRoute("/")({ loader: () => loadRooms(), component: Home });
const transport = new DefaultChatTransport<RoomStream>({ api: "/api/chat" });
const prompts = [
  "I have an idea for a game, but I'm not sure what's fun about it yet.",
  "Help me think through a decision I'm stuck on.",
  "I want a second opinion on something I'm building.",
];

function Home() {
  const initial = Route.useLoaderData();
  const [rooms, setRooms] = useState<Room[]>(initial.rooms);
  const [selected, setSelected] = useState(initial.rooms[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("conversation");
  const [target, setTarget] = useState<Duck["id"]>("explorer");
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof connections>>>([]);
  const [remoteActive, setRemoteActive] = useState(initial.active);
  const [approvals, setApprovals] = useState<Approval[]>(
    initial.active.flatMap((item) => item.approvals),
  );
  const [activity, setActivity] = useState<Partial<Record<Duck["id"], string>>>({});
  const runningRoom = useRef<string | null>(null);
  const room = rooms.find((item) => item.id === selected);
  const ducks = room?.ducks ?? defaults;
  const currentTarget = ducks.some((duck) => duck.id === target) ? target : ducks[0].id;
  function receiveRoom(value: Room) {
    setRooms((current) => [value, ...current.filter((item) => item.id !== value.id)]);
  }
  const chat = useChat<RoomStream>({
    transport,
    onData: (part) => {
      if (part.type !== "data-room") return;
      const event = part.data;
      if (event.type === "room") receiveRoom(event.room);
      if (event.type === "error") setError(event.message);
      if (event.type === "approval") setApprovals((current) => [...current, event.approval]);
      if (event.type === "resolved")
        setApprovals((current) => current.filter((item) => item.id !== event.id));
      if (event.type === "activity")
        setActivity((current) => ({ ...current, [event.duckId]: event.label }));
      if (event.type === "message")
        setRooms((current) =>
          current.map((item) =>
            item.id !== runningRoom.current
              ? item
              : {
                  ...item,
                  messages: item.messages.some((message) => message.id === event.message.id)
                    ? item.messages.map((message) =>
                        message.id === event.message.id ? event.message : message,
                      )
                    : [...item.messages, event.message],
                },
          ),
        );
    },
    onError: (cause) => setError(cause.message),
  });
  const localBusy = chat.status === "submitted" || chat.status === "streaming";
  const busy = localBusy || remoteActive.some((item) => item.roomId === selected);
  useEffect(() => {
    if (!remoteActive.length || localBusy) return;
    const timer = setInterval(() => {
      loadRooms()
        .then((value) => {
          setRooms(value.rooms);
          setRemoteActive(value.active);
          setApprovals(
            value.active
              .filter((item) => item.roomId === selected)
              .flatMap((item) => item.approvals),
          );
        })
        .catch(() => setError("Could not reconnect to the conversation."));
    }, 2000);
    return () => clearInterval(timer);
  }, [remoteActive.length, localBusy, selected]);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    connections()
      .then(setStatus)
      .catch(() => setError("Couldn't check provider connections."));
  }, []);

  async function create() {
    setSaving(true);
    setError("");
    try {
      const value = await newRoom();
      receiveRoom(value);
      setSelected(value.id);
      setSidebar(false);
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create a conversation.");
    } finally {
      setSaving(false);
    }
  }
  async function send() {
    const text = input.trim();
    if (!text || busy || saving) return;
    setError("");
    setSaving(true);
    setActivity({});
    try {
      const active = room ?? (await newRoom());
      if (!room) {
        receiveRoom(active);
        setSelected(active.id);
      }
      runningRoom.current = active.id;
      setInput("");
      await chat.sendMessage(
        { text },
        { body: { roomId: active.id, text, mode, target: currentTarget } },
      );
    } catch (cause) {
      setInput(text);
      setError(cause instanceof Error ? cause.message : "Couldn't send your message.");
    } finally {
      setSaving(false);
      setStopping(false);
      setApprovals([]);
    }
  }
  async function stop() {
    const id = runningRoom.current ?? selected;
    if (!id) return;
    setStopping(true);
    try {
      await stopRoom({ data: id });
    } catch {
      setStopping(false);
      setError("Couldn't stop the replies. Try again.");
    }
  }
  async function saveSettings(value: { ducks: Duck[]; notes: string; observe: boolean }) {
    setSaving(true);
    setError("");
    try {
      const active = room ?? (await newRoom());
      const updated = await updateRoom({ data: { id: active.id, ...value } });
      receiveRoom(updated);
      setSelected(updated.id);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save room settings.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? "mobile-open" : ""}`}>
        <a className="brand" href="/">
          <span className="brand-mark">
            <img src="/brand/base.png" alt="" />
          </span>
          duckpond<span className="poc">POC</span>
        </a>
        <button className="new-chat" onClick={create} disabled={busy || saving}>
          <Plus size={16} /> New conversation
        </button>
        <div className="section-label">YOUR CONVERSATIONS</div>
        <div className="room-list">
          {rooms.length ? (
            rooms.map((item) => (
              <button
                key={item.id}
                disabled={busy || saving}
                className={`room-link ${item.id === selected ? "selected" : ""}`}
                onClick={() => {
                  setSelected(item.id);
                  setSidebar(false);
                  setError("");
                }}
              >
                <MessageCircle size={15} />
                <span>{item.title}</span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">
              Your thoughts have a home here.
              <br />
              Start your first conversation.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="section-label">CONNECTIONS</div>
          {(["claude", "codex"] as const).map((provider) => {
            const connection = status.find((item) => item.provider === provider);
            return (
              <div className="connection" key={provider}>
                <span className={`status-dot ${connection?.connected ? "connected" : ""}`} />
                <span>{provider === "claude" ? "Claude" : "Codex"}</span>
                <small>
                  {!connection
                    ? "Checking"
                    : connection.connected
                      ? "Subscription"
                      : "Sign-in needed"}
                </small>
              </div>
            );
          })}
          <div className="local-note">Saved on this machine</div>
        </div>
      </aside>
      <main className="conversation">
        <header className="conversation-header">
          <button
            className="icon-button mobile-only"
            aria-label="Toggle conversations"
            onClick={() => setSidebar(!sidebar)}
          >
            <MessageCircle size={19} />
          </button>
          <div>
            <div className="breadcrumb">
              Your pond <span>/</span> Conversation
            </div>
            <h1>{room?.title ?? "A little room to think."}</h1>
          </div>
          <button className="participants-toggle" onClick={() => setPanel(!panel)}>
            <Users size={16} />
            <span>
              {ducks.length} {ducks.length === 1 ? "duck" : "ducks"}
            </span>
            <ChevronDown size={13} />
          </button>
        </header>
        <Transcript key={selected}>
          {!room?.messages.length ? (
            <div className="welcome">
              <div className="welcome-mark">
                <img src="/brand/base.png" alt="" />
              </div>
              <span className="eyebrow">THINK OUT LOUD</span>
              <h2>
                Good ideas start
                <br />
                with a conversation.
              </h2>
              <p>
                A few different minds. Room to disagree.
                <br />
                Bring a half-formed thought and see where it goes.
              </p>
              <div className="suggestions">
                {prompts.map((prompt) => (
                  <button key={prompt} onClick={() => setInput(prompt)}>
                    {prompt}
                    <ArrowUp size={16} />
                  </button>
                ))}
              </div>
              <div className="welcome-ducks">
                {ducks.map((duck) => (
                  <span key={duck.id}>
                    <DuckAvatar avatar={duckAvatar(duck)} small />
                    {duck.name}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              <div className="date-divider">
                <span>Room to think. No need to have it figured out.</span>
              </div>
              {room.messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
            </div>
          )}
        </Transcript>
        <div className="composer-wrap">
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <MentionInput
              value={input}
              onChange={setInput}
              ducks={ducks}
              onSend={() => void send()}
            />
            <div className="composer-controls">
              <div className="composer-options">
                <select
                  aria-label="Conversation mode"
                  value={mode}
                  disabled={busy || saving}
                  onChange={(event) => setMode(modeSchema.parse(event.target.value))}
                >
                  <option value="conversation">Conversation</option>
                  <option value="review">Independent review</option>
                  <option value="discussion">Discuss together</option>
                </select>
                {mode === "conversation" && (
                  <select
                    aria-label="Reply from"
                    value={currentTarget}
                    disabled={busy || saving}
                    onChange={(event) => setTarget(duckSchema.shape.id.parse(event.target.value))}
                  >
                    {ducks.map((duck) => (
                      <option value={duck.id} key={duck.id}>
                        {duck.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {busy ? (
                <button
                  className="send-button stop-button"
                  type="button"
                  onClick={stop}
                  disabled={stopping}
                  aria-label="Stop replies"
                >
                  <Square size={14} fill="currentColor" />
                  {stopping ? "Stopping" : "Stop"}
                </button>
              ) : (
                <button
                  className="send-button"
                  disabled={!input.trim() || saving}
                  type="submit"
                  aria-label="Send message"
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-hint">
            {busy ? (
              "The ducks are thinking. You can stop them at any time."
            ) : mode === "review" ? (
              "Each duck considers your thought independently before seeing the others' replies."
            ) : mode === "discussion" ? (
              "Independent thoughts, then one round of replies to each other."
            ) : (
              <>
                <span className="keyboard-hint">Enter to send · Shift + Enter for a new line</span>
                <span className="touch-hint">Return for a new line · Tap the arrow to send</span>
              </>
            )}
          </div>
        </div>
      </main>
      <aside className={`ducks-panel ${panel ? "mobile-open" : ""}`}>
        <div className="panel-heading">
          <span>IN THE ROOM</span>
          <button
            className="icon-button"
            onClick={() => setEditing(true)}
            disabled={busy || saving}
            aria-label="Edit personas and room settings"
          >
            <Settings2 size={16} />
          </button>
        </div>
        <p className="panel-intro">
          Different perspectives.
          <br />
          One conversation.
        </p>
        {ducks.map((duck) => {
          const thinking = room?.messages.some(
            (message) => message.duckId === duck.id && message.status === "thinking",
          );
          return (
            <div className="duck-card" key={duck.id}>
              <div className="duck-card-heading">
                <DuckAvatar avatar={duckAvatar(duck)} />
                <div>
                  <h3>{duck.name}</h3>
                  <span className="model-label">
                    {duck.provider === "claude" ? "Claude" : "Codex"} ·{" "}
                    {duck.model || "Account default"}
                    {duck.reasoning ? ` · ${duck.reasoning}` : ""}
                  </span>
                </div>
              </div>
              <p>{duck.instructions}</p>
              <span className={`participation ${thinking ? "thinking" : ""}`}>
                <Circle size={7} fill="currentColor" />
                {thinking
                  ? activity[duck.id] || "Thinking"
                  : duck.id === currentTarget && mode === "conversation"
                    ? "Conversation partner"
                    : room?.observe
                      ? "Observing"
                      : "On request"}
              </span>
            </div>
          );
        })}
        <div className="notes-heading">
          <NotebookPen size={15} />
          <span>SHARED NOTES</span>
          <button
            className="text-button"
            onClick={() => setEditing(true)}
            disabled={busy || saving}
          >
            Edit
          </button>
        </div>
        <div className="shared-notes">
          {room?.notes ? (
            <Markdown>{room.notes}</Markdown>
          ) : (
            <p>Keep a question, constraint, or thought here. Every duck sees these notes.</p>
          )}
        </div>
        <div className="panel-foot">
          <span className="status-dot connected" />
          {room?.observe ? "Observers may join after a reply" : "Ducks speak when invited"}
        </div>
      </aside>
      {editing && (
        <Settings
          key={room?.id ?? "new"}
          roomId={room?.id}
          ducks={ducks}
          notes={room?.notes ?? ""}
          observe={room?.observe ?? false}
          saving={saving}
          error={error}
          onSave={saveSettings}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const human = !message.duckId;
  return (
    <article data-scroll-anchor className={`chat-message ${human ? "human-message" : ""}`}>
      {human ? (
        <span className="avatar human">J</span>
      ) : (
        <DuckAvatar avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })} />
      )}
      <div className="message-body">
        <div className="message-heading">
          <strong>{message.speaker}</strong>
          {message.provider && <span>{message.provider === "claude" ? "Claude" : "Codex"}</span>}
          {message.phase !== "conversation" && <span className="phase-label">{message.phase}</span>}
          {message.status === "stopped" && <span>Stopped</span>}
        </div>
        <div className={`message-text ${message.status === "error" ? "message-error" : ""}`}>
          {message.text ? (
            <Markdown>{message.text}</Markdown>
          ) : (
            <span className="thinking-text">
              {message.status === "thinking" ? "Thinking..." : "Reply stopped."}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
function ApprovalCard({ approval }: { approval: Approval }) {
  const [answers, setAnswers] = useState<Record<string, string | boolean | number>>({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  async function respond(approved: boolean) {
    setError("");
    setSending(true);
    try {
      await answerApproval({
        data: { id: approval.id, approved, answer: JSON.stringify(answers) },
      });
    } catch (cause) {
      setSending(false);
      setError(cause instanceof Error ? cause.message : "Couldn't answer request");
    }
  }
  return (
    <form
      className="approval-card"
      onSubmit={(event) => {
        event.preventDefault();
        void respond(true);
      }}
    >
      <strong>{approval.duck} needs your input</strong>
      <div>{approval.input ? "A question before continuing" : "Permission to use a tool"}</div>
      <details>
        <summary>{approval.title}</summary>
        <pre>{approval.detail}</pre>
      </details>
      {approval.url?.startsWith("https://") && (
        <a href={approval.url} target="_blank" rel="noreferrer">
          Open requested page
        </a>
      )}
      {approval.fields?.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.kind === "boolean" ? (
            <input
              type="checkbox"
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [field.key]: event.target.checked }))
              }
            />
          ) : (
            <>
              <input
                required={field.required}
                type={field.kind === "number" ? "number" : "text"}
                list={`options-${approval.id}-${field.key}`}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [field.key]:
                      field.kind === "number" ? Number(event.target.value) : event.target.value,
                  }))
                }
              />
              <datalist id={`options-${approval.id}-${field.key}`}>
                {field.options.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </>
          )}
        </label>
      ))}
      {approval.input && !approval.fields?.length && (
        <p>Review the request details before continuing.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="settings-actions">
        <button
          disabled={sending}
          type="button"
          onClick={() => respond(false)}
          className="text-button"
        >
          Decline
        </button>
        <button disabled={sending} type="submit" className="primary-button">
          {approval.input ? "Submit" : "Allow once"}
        </button>
      </div>
    </form>
  );
}
