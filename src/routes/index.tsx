import { AgentContext } from "../components/agent-context";
import { z } from "zod";
import { createFileRoute, replaceEqualDeep } from "@tanstack/react-router";
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
import { DuckPicker } from "../components/duck-picker";
import { PondDialog, MovePondDialog } from "../components/pond-dialog";
import { loadPonds, moveToPond, savePond } from "../server/ponds.functions";
import type { Pond } from "../lib/pond";
import { DuckAvatar } from "../components/duck-avatar";
import { MentionInput } from "../components/mention-input";
import { Transcript } from "../components/transcript";
import { ConversationMessages } from "../components/chat-message";
import {
  answerApproval,
  connections,
  loadRooms,
  newRoom,
  removeRoom,
  stopRoom,
  updateRoom,
} from "../server/rooms.functions";
import {
  defaults,
  ducksSchema,
  isUntouchedRoom,
  duckSchema,
  duckAvatar,
  modeSchema,
  type Approval,
  type Duck,
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

// Match the composer's mobile keyboard behavior, including touch tablets.
function shouldStreamText() {
  return !window.matchMedia("(max-width: 650px), (pointer: coarse)").matches;
}

const composerPreferencesSchema = z.object({
  selected: z.string().nullable(),
  rooms: z.record(z.string(), z.object({ mode: modeSchema, target: duckSchema.shape.id })),
  drafts: z.record(z.string(), z.string()).default({}),
  newDucks: ducksSchema.optional(),
  pondId: z.string().nullable().default(null),
  rosters: z.record(z.string(), ducksSchema).default({}),
});

function Home() {
  const initial = Route.useLoaderData();
  const [rooms, setRooms] = useState<Room[]>(initial.rooms);
  const [ponds, setPonds] = useState(initial.ponds);
  const [selectedPond, setSelectedPond] = useState<string | null>(initial.rooms[0]?.pondId ?? null);
  const pond = ponds.find((item) => item.id === selectedPond);
  const newKey = `new:${selectedPond ?? "general"}`;
  const [selected, setSelected] = useState<string | null>(initial.rooms[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newRosters, setNewRosters] = useState<Record<string, Duck[]>>({});
  const newDucks =
    newRosters[selectedPond ?? "general"] ?? (pond?.ducks.length ? pond.ducks : defaults);
  const input = drafts[selected ?? newKey] ?? "";
  function setInput(value: string) {
    const key = selected ?? newKey;
    setDrafts((current) => ({
      ...current,
      [key]: value,
    }));
  }
  const [dictating, setDictating] = useState(false);
  const [composerPreferences, setComposerPreferences] = useState<
    z.infer<typeof composerPreferencesSchema>["rooms"]
  >({});
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const preferenceKey = selected ?? newKey;
  const mode = composerPreferences[preferenceKey]?.mode ?? "conversation";
  const target = composerPreferences[preferenceKey]?.target ?? "explorer";
  function setMode(mode: Mode) {
    setComposerPreferences((current) => ({ ...current, [preferenceKey]: { mode, target } }));
  }
  function setTarget(target: Duck["id"]) {
    setComposerPreferences((current) => ({ ...current, [preferenceKey]: { mode, target } }));
  }
  useEffect(() => {
    try {
      const stored = localStorage.getItem("duckpond:composer");
      const parsed = composerPreferencesSchema.safeParse(stored ? JSON.parse(stored) : null);
      if (parsed.success) {
        setComposerPreferences(parsed.data.rooms);
        setDrafts({
          ...parsed.data.drafts,
          "new:general": parsed.data.drafts["new:general"] ?? parsed.data.drafts.new ?? "",
        });
        setNewRosters({
          ...(parsed.data.newDucks ? { general: parsed.data.newDucks } : {}),
          ...parsed.data.rosters,
        });
        const previousRoom = initial.rooms.find((room) => room.id === parsed.data.selected);
        if (previousRoom) {
          setSelected(previousRoom.id);
          setSelectedPond(previousRoom.pondId ?? null);
        } else if (parsed.data.selected === null) {
          setSelected(null);
          setSelectedPond(
            initial.ponds.some((item) => item.id === parsed.data.pondId)
              ? parsed.data.pondId
              : null,
          );
        }
      }
    } catch {
      // Storage can be unavailable in private or restricted browser sessions.
    }
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(
        "duckpond:composer",
        JSON.stringify({
          selected,
          rooms: composerPreferences,
          drafts,
          rosters: newRosters,
          pondId: selectedPond,
        }),
      );
    } catch {
      // Keep the controls usable even when browser storage is unavailable.
    }
  }, [preferencesLoaded, composerPreferences, selected, drafts, newRosters, selectedPond]);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const [creatingPond, setCreatingPond] = useState(false);
  const [editingPond, setEditingPond] = useState<Pond | null>(null);
  const [moving, setMoving] = useState<Room | null>(null);
  const [panel, setPanel] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof connections>>>([]);
  const [remoteActive, setRemoteActive] = useState(initial.active);
  const [needsSync, setNeedsSync] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>(
    initial.active.flatMap((item) => item.approvals),
  );
  const [activity, setActivity] = useState<Partial<Record<Duck["id"], string>>>({});
  const runningRoom = useRef<string | null>(null);
  const submission = useRef<{
    roomId: string;
    messageId: string;
    text: string;
    restoreDraft: boolean;
  } | null>(null);
  const room = rooms.find((item) => item.id === selected);
  const pondRooms = rooms.filter((item) => (item.pondId ?? null) === selectedPond);
  const ducks = room?.ducks ?? newDucks;
  const currentTarget = ducks.some((duck) => duck.id === target) ? target : ducks[0].id;
  function receiveRoom(value: Room) {
    setRooms((current) =>
      replaceEqualDeep(current, [value, ...current.filter((item) => item.id !== value.id)]),
    );
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
    onError: (cause) => {
      setError(cause.message);
      setNeedsSync(true);
    },
  });
  const localBusy = chat.status === "submitted" || chat.status === "streaming";
  const busy = localBusy || needsSync || remoteActive.some((item) => item.roomId === selected);
  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    async function refresh() {
      if (localBusy || refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const value = await loadRooms({ data: { streamText: shouldStreamText() } });
        if (disposed) return;
        setRooms((current) => replaceEqualDeep(current, value.rooms));
        setPonds((current) => replaceEqualDeep(current, value.ponds));
        setRemoteActive(value.active);
        setApprovals(
          value.active.filter((item) => item.roomId === selected).flatMap((item) => item.approvals),
        );
        const pending = submission.current;
        if (pending) {
          const accepted = value.rooms
            .find((item) => item.id === pending.roomId)
            ?.messages.some((message) => message.id === pending.messageId);
          if (accepted) setError("");
          else {
            if (pending.restoreDraft)
              setDrafts((current) => ({
                ...current,
                [pending.roomId]: current[pending.roomId] || pending.text,
              }));
            setError(
              pending.restoreDraft
                ? "Your message wasn't received. It's back in the draft; try sending again."
                : "The summary request wasn't received. Try again.",
            );
          }
          submission.current = null;
        } else {
          setError((message) =>
            message === "Could not reconnect. Retrying when the connection returns." ? "" : message,
          );
        }
        setNeedsSync(false);
        if (!value.active.some((item) => item.roomId === selected)) setStopping(false);
      } catch {
        if (!disposed) {
          setNeedsSync(true);
          setError("Could not reconnect. Retrying when the connection returns.");
        }
      } finally {
        refreshing = false;
      }
    }
    function resume() {
      if (document.visibilityState === "hidden") return;
      setNeedsSync(true);
      // Drop a stale HTTP stream only. The server keeps the turn and pending approvals alive.
      if (localBusy) void chat.stop();
      else void refresh();
    }
    if (needsSync || remoteActive.length) void refresh();
    const timer = setInterval(() => {
      if (needsSync || remoteActive.length) void refresh();
    }, 2000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [remoteActive.length, localBusy, selected, needsSync, chat.stop]);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    connections()
      .then(setStatus)
      .catch(() => setError("Couldn't check provider connections."));
  }, []);

  const cleanedEmptyRooms = useRef(false);
  useEffect(() => {
    if (!preferencesLoaded || cleanedEmptyRooms.current) return;
    cleanedEmptyRooms.current = true;
    async function cleanup() {
      for (const item of initial.rooms) {
        if (item.id === selected || drafts[item.id]?.trim() || !isUntouchedRoom(item)) continue;
        const result = await removeRoom({ data: { id: item.id, onlyIfUntouched: true } });
        if (result.deleted) setRooms((current) => current.filter((room) => room.id !== item.id));
      }
    }
    void cleanup().catch(() =>
      setError("Couldn't remove unused empty conversations. Try reloading."),
    );
  }, [preferencesLoaded, initial.rooms, selected, drafts]);

  async function switchRoom(id: string | null, roster?: Duck[], pondId = selectedPond) {
    setSaving(true);
    setError("");
    try {
      if (room && room.id !== id && !input.trim() && isUntouchedRoom(room)) {
        const result = await removeRoom({ data: { id: room.id, onlyIfUntouched: true } });
        if (result.deleted) setRooms((current) => current.filter((item) => item.id !== room.id));
      }
      const destination = id ? (rooms.find((item) => item.id === id)?.pondId ?? null) : pondId;
      if (roster)
        setNewRosters((current) => ({
          ...current,
          [destination ?? "general"]: structuredClone(roster),
        }));
      setSelectedPond(destination);
      setSelected(id);
      setSidebar(false);
      setCreating(false);
    } finally {
      setSaving(false);
    }
  }
  async function startNew() {
    setSaving(true);
    setError("");
    try {
      const current = await loadPonds();
      setPonds(current);
      const selected = current.find((item) => item.id === selectedPond);
      if (selected?.error) throw new Error(selected.error);
      await switchRoom(null, drafts[newKey]?.trim() ? newDucks : (selected?.ducks ?? defaults));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't start a conversation.");
    } finally {
      setSaving(false);
    }
  }
  async function editPond() {
    setSaving(true);
    setError("");
    try {
      const current = await loadPonds();
      setPonds(current);
      const selected = current.find((item) => item.id === selectedPond);
      if (!selected || selected.error) throw new Error(selected?.error ?? "Pond not found");
      setEditingPond(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't read the pond.");
    } finally {
      setSaving(false);
    }
  }
  async function savePondSettings(value: { ducks: Duck[]; pondName?: string }) {
    if (!editingPond) return;
    setSaving(true);
    setError("");
    try {
      await savePond({
        data: {
          id: editingPond.id,
          revision: editingPond.revision,
          name: value.pondName ?? editingPond.name,
          ducks: value.ducks,
        },
      });
      setPonds(await loadPonds());
      if (!drafts[newKey]?.trim())
        setNewRosters((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => id !== editingPond.id)),
        );
      setEditingPond(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the pond.");
    } finally {
      setSaving(false);
    }
  }
  async function deleteConversation() {
    if (!deleting) return;
    setSaving(true);
    setError("");
    try {
      await removeRoom({ data: { id: deleting.id, onlyIfUntouched: false } });
      setRooms((current) => current.filter((item) => item.id !== deleting.id));
      setDrafts((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== deleting.id)),
      );
      setComposerPreferences((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== deleting.id)),
      );
      if (selected === deleting.id)
        setSelected(pondRooms.find((item) => item.id !== deleting.id)?.id ?? null);
      setDeleting(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't delete this conversation.");
    } finally {
      setSaving(false);
    }
  }
  async function send(summarize = false) {
    const text = summarize
      ? "Summarize this conversation and help me work through the next unresolved question."
      : input.trim();
    const requestedMode = summarize ? "guide" : mode;
    if (!text || busy || saving || dictating) return;
    setError("");
    setSaving(true);
    setActivity({});
    let activeRoomId = selected;
    try {
      const active =
        room ?? (await newRoom({ data: { ducks, pondId: selectedPond ?? undefined } }));
      activeRoomId = active.id;
      if (!room) {
        receiveRoom(active);
        setComposerPreferences((current) => ({
          ...current,
          [active.id]: { mode: requestedMode, target: currentTarget },
        }));
        setSelected(active.id);
      }
      runningRoom.current = active.id;
      const messageId = crypto.randomUUID();
      submission.current = { roomId: active.id, messageId, text, restoreDraft: !summarize };
      if (summarize) setMode("guide");
      else {
        setDrafts((current) => ({ ...current, [selected ?? newKey]: "", [active.id]: "" }));
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.closest(".composer")) focused.blur();
      }
      await chat.sendMessage(
        { text },
        {
          body: {
            roomId: active.id,
            submissionId: messageId,
            streamText: shouldStreamText(),
            text,
            mode: requestedMode,
            target: currentTarget,
          },
        },
      );
    } catch (cause) {
      if (!summarize) setDrafts((current) => ({ ...current, [activeRoomId ?? newKey]: text }));
      setError(cause instanceof Error ? cause.message : "Couldn't send your message.");
    } finally {
      setSaving(false);
      runningRoom.current = null;
      setNeedsSync(true);
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
      const active =
        room ??
        (await newRoom({ data: { ducks: value.ducks, pondId: selectedPond ?? undefined } }));
      const updated = await updateRoom({ data: { id: active.id, ...value } });
      receiveRoom(updated);
      if (!room)
        setDrafts((current) => ({ ...current, [newKey]: "", [updated.id]: current[newKey] ?? "" }));
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
        <div className="pond-selector">
          <label htmlFor="current-pond">POND</label>
          <select
            id="current-pond"
            value={selectedPond ?? ""}
            disabled={busy || saving || dictating || !preferencesLoaded}
            onChange={(event) => {
              const id = event.target.value || null;
              void switchRoom(
                rooms.find((item) => (item.pondId ?? null) === id)?.id ?? null,
                undefined,
                id,
              ).catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "Couldn't switch ponds."),
              );
            }}
          >
            <option value="">General</option>
            {ponds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.error ? " (unavailable)" : ""}
              </option>
            ))}
          </select>
          <div className="pond-controls">
            {pond && (
              <button
                className="text-button"
                disabled={busy || saving || dictating}
                onClick={() => void editPond()}
              >
                Edit pond
              </button>
            )}
            <button
              className="text-button"
              disabled={busy || saving || dictating}
              onClick={() => setCreatingPond(true)}
            >
              + New pond
            </button>
          </div>
          {pond?.error && <p className="pond-error">{pond.error}</p>}
        </div>
        <button
          className="new-chat"
          onClick={() => void startNew()}
          disabled={busy || saving || dictating || !preferencesLoaded || !!pond?.error}
        >
          <Plus size={16} /> New conversation
        </button>
        <button
          className="text-button choose-ducks"
          disabled={busy || saving || dictating || !!pond?.error}
          onClick={() => setCreating(true)}
        >
          Choose other ducks
        </button>
        <div className="section-label">YOUR CONVERSATIONS</div>
        <div className="room-list">
          {pondRooms.length ? (
            pondRooms.map((item) => (
              <div className="room-row" key={item.id}>
                <button
                  disabled={busy || saving || dictating}
                  className={`room-link ${item.id === selected ? "selected" : ""}`}
                  onClick={() =>
                    void switchRoom(item.id).catch((cause: unknown) =>
                      setError(
                        cause instanceof Error ? cause.message : "Couldn't switch conversations.",
                      ),
                    )
                  }
                >
                  <MessageCircle size={15} />
                  <span>{item.title}</span>
                </button>
                <details className="room-menu">
                  <summary
                    aria-label={`Actions for ${item.title}`}
                    aria-disabled={busy || saving || dictating}
                    onClick={(event) => {
                      if (busy || saving || dictating) event.preventDefault();
                    }}
                  >
                    ···
                  </summary>
                  <div>
                    <button
                      disabled={busy || saving || dictating}
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        void switchRoom(null, item.ducks).catch((cause: unknown) =>
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : "Couldn't start a conversation.",
                          ),
                        );
                      }}
                    >
                      New conversation with these ducks
                    </button>
                    <button
                      disabled={busy || saving || dictating}
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        setMoving(item);
                      }}
                    >
                      Move to pond
                    </button>
                    <button
                      className="delete-conversation-button"
                      disabled={busy || saving || dictating}
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        setError("");
                        setDeleting(item);
                      }}
                    >
                      Delete conversation
                    </button>
                  </div>
                </details>
              </div>
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
              {pond?.name ?? "General"} <span>/</span> Conversation
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
        <Transcript key={selected} messages={room?.messages}>
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
              <ConversationMessages messages={room.messages} ducks={room.ducks} />
            </div>
          )}
        </Transcript>
        <div className="composer-wrap" data-dictating={dictating} tabIndex={-1}>
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
          {!!room?.messages.length && (
            <div className="conversation-actions">
              <button
                className="summary-button"
                disabled={busy || saving || dictating}
                onClick={() => void send(true)}
              >
                <NotebookPen size={14} /> Summarize and guide
              </button>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <MentionInput
              key={selected}
              value={input}
              onChange={setInput}
              ducks={ducks}
              onSend={() => void send()}
              onDictatingChange={setDictating}
            />
            <div className="composer-controls">
              <div className="composer-options">
                <select
                  aria-label="Conversation mode"
                  value={mode}
                  disabled={busy || saving || dictating}
                  onChange={(event) => setMode(modeSchema.parse(event.target.value))}
                >
                  <option value="conversation">Conversation</option>
                  <option value="review">Independent review</option>
                  <option value="discussion">Discuss together</option>
                  <option value="guide">Guided conversation</option>
                </select>
                {mode === "conversation" && (
                  <select
                    aria-label="Reply from"
                    value={currentTarget}
                    disabled={busy || saving || dictating}
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
                  disabled={!input.trim() || saving || dictating}
                  type="submit"
                  aria-label="Send message"
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-hint">
            {needsSync ? (
              "Reconnecting to your conversation…"
            ) : busy ? (
              "The ducks are thinking. You can stop them at any time."
            ) : mode === "review" ? (
              "All ducks give independent input, then Guide summarizes and asks one next question."
            ) : mode === "discussion" ? (
              "Mediator directs the ducks' discussion and brings you the result."
            ) : mode === "guide" ? (
              "Guide replies alone. Choose Independent review for everyone's input."
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
            disabled={busy || saving || dictating}
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
        {room && <AgentContext key={room.id} roomId={room.id} />}
        <div className="notes-heading">
          <NotebookPen size={15} />
          <span>SHARED NOTES</span>
          <button
            className="text-button"
            onClick={() => setEditing(true)}
            disabled={busy || saving || dictating}
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
          pondId={selectedPond ?? undefined}
          ducks={ducks}
          notes={room?.notes ?? ""}
          observe={room?.observe ?? false}
          saving={saving}
          error={error}
          onSave={saveSettings}
          onClose={() => setEditing(false)}
        />
      )}
      {creating && (
        <DuckPicker
          onStart={(roster) => switchRoom(null, roster)}
          onClose={() => setCreating(false)}
        />
      )}
      {creatingPond && (
        <PondDialog
          ducks={ducks}
          onClose={() => setCreatingPond(false)}
          onCreated={async (pond) => {
            setPonds(await loadPonds());
            await switchRoom(null, pond.ducks, pond.id);
            setCreatingPond(false);
          }}
        />
      )}
      {editingPond && (
        <Settings
          pond={editingPond}
          ducks={editingPond.ducks}
          notes=""
          observe={false}
          saving={saving}
          error={error}
          onSave={savePondSettings}
          onClose={() => {
            setEditingPond(null);
            setError("");
          }}
        />
      )}
      {moving && (
        <MovePondDialog
          title={moving.title}
          currentPond={moving.pondId}
          ponds={ponds}
          onClose={() => setMoving(null)}
          onMove={async (pondId) => {
            const moved = await moveToPond({ data: { roomId: moving.id, pondId } });
            receiveRoom(moved);
            setSelected(moved.id);
            setSelectedPond(pondId);
            setMoving(null);
          }}
        />
      )}
      {deleting && (
        <DeleteConversation
          room={deleting}
          saving={saving}
          error={error}
          onDelete={deleteConversation}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function DeleteConversation({
  room,
  saving,
  error,
  onDelete,
  onClose,
}: {
  room: Room;
  saving: boolean;
  error: string;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="delete-conversation-title"
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else onClose();
      }}
    >
      <div className="settings-heading">
        <h2 id="delete-conversation-title">Delete "{room.title}"?</h2>
      </div>
      <p className="settings-intro">
        This removes the conversation's messages and shared notes. Its ducks stay available to
        reuse. This cannot be undone.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        <button className="text-button" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primary-button delete-conversation-button"
          disabled={saving}
          onClick={() => void onDelete()}
        >
          {saving ? "Deleting..." : "Delete conversation"}
        </button>
      </div>
    </dialog>
  );
}

function ApprovalCard({ approval }: { approval: Approval }) {
  const [answers, setAnswers] = useState<Record<string, string | boolean | number>>({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  async function respond(approved: boolean, remember = false) {
    setError("");
    setSending(true);
    try {
      await answerApproval({
        data: { id: approval.id, approved, remember, answer: JSON.stringify(answers) },
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
      <div>{approval.title}</div>
      {approval.reason && <p>{approval.reason}</p>}
      {approval.command && (
        <pre className="approval-command">
          <code>{approval.command}</code>
        </pre>
      )}
      {approval.cwd && (
        <p className="approval-directory">
          In <code>{approval.cwd}</code>
        </p>
      )}
      {approval.remember && (
        <p>
          Always allow saves this exact command and requested access in this project for all ducks.
          Revoke it in room settings.
        </p>
      )}
      <details>
        <summary>Technical details</summary>
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
        {approval.remember && (
          <button
            disabled={sending}
            type="button"
            className="secondary-button"
            onClick={() => respond(true, true)}
          >
            Always allow in this project
          </button>
        )}
        <button disabled={sending} type="submit" className="primary-button">
          {approval.input ? "Submit" : "Allow once"}
        </button>
      </div>
    </form>
  );
}
