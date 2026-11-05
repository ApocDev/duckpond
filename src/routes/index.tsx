import { z } from "zod";
import { createFileRoute, replaceEqualDeep } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Menu, Square, X } from "lucide-react";
import { AppSettings } from "../components/app-settings";
import { DeleteDialog, MoveDialog } from "../components/conversation-dialogs";
import { DuckBar, type Target } from "../components/duck-bar";
import { DuckSettings, type DuckSettingsSave } from "../components/duck-settings";
import { MentionInput } from "../components/mention-input";
import { PondDialog } from "../components/pond-dialog";
import { RoomNotes } from "../components/room-notes";
import { Sidebar } from "../components/sidebar";
import { Transcript } from "../components/transcript";
import { ConversationMessages } from "../components/chat-message";
import { loadPonds, moveToPond, savePond } from "../server/ponds.functions";
import type { Pond } from "../lib/pond";
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
  type Approval,
  type Duck,
  type Mode,
  type Room,
  type RoomStream,
} from "../lib/room";

export const Route = createFileRoute("/")({ loader: () => loadRooms(), component: Home });
const transport = new DefaultChatTransport<RoomStream>({ api: "/api/chat" });
const prompts = [
  "I have a game idea but I'm not sure what's fun about it yet.",
  "Help me decide between two approaches.",
  "Poke holes in something I'm building.",
];
const summaryRequest =
  "Summarize this conversation so far: where we landed, what's still disagreed, and the one question worth answering next.";
const reconnectError = "Lost the connection. Retrying when it comes back.";

// Match the composer's mobile keyboard behavior, including touch tablets.
function shouldStreamText() {
  return !window.matchMedia("(max-width: 650px), (pointer: coarse)").matches;
}

/** Per-browser conveniences: last conversation, drafts, recipients, and unsaved rosters. */
const preferencesSchema = z.object({
  selected: z.string().nullable(),
  pondId: z.string().nullable().default(null),
  drafts: z.record(z.string(), z.string()).default({}),
  targets: z.record(z.string(), z.string()).default({}),
  rosters: z.record(z.string(), ducksSchema).default({}),
});

function without<T>(record: Record<string, T>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([item]) => item !== key));
}

/** Mediator for groups; the only duck when there is just one. */
function resolveTarget(stored: string | undefined, ducks: Duck[]): Target {
  if (stored === "mediator" && ducks.length > 1) return stored;
  if (stored && ducks.some((duck) => duck.id === stored)) return stored;
  return ducks.length > 1 ? "mediator" : ducks[0].id;
}

function Home() {
  const initial = Route.useLoaderData();
  const [rooms, setRooms] = useState<Room[]>(initial.rooms);
  const [ponds, setPonds] = useState(initial.ponds);
  const [selectedPond, setSelectedPond] = useState<string | null>(initial.rooms[0]?.pondId ?? null);
  const pond = ponds.find((item) => item.id === selectedPond);
  const newKey = `new:${selectedPond ?? "general"}`;
  const [selected, setSelected] = useState<string | null>(initial.rooms[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [newRosters, setNewRosters] = useState<Record<string, Duck[]>>({});
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const key = selected ?? newKey;
  const input = drafts[key] ?? "";
  function setInput(value: string) {
    setDrafts((current) => ({ ...current, [key]: value }));
  }
  const newDucks =
    newRosters[selectedPond ?? "general"] ?? (pond?.ducks.length ? pond.ducks : defaults);
  const room = rooms.find((item) => item.id === selected);
  const pondRooms = rooms.filter((item) => (item.pondId ?? null) === selectedPond);
  const ducks = room?.ducks ?? newDucks;
  const target = resolveTarget(targets[key], ducks);
  const targetDuck = ducks.find((duck) => duck.id === target);

  const [dictating, setDictating] = useState(false);
  const [dialog, setDialog] = useState<
    | { kind: "ducks" }
    | { kind: "pond-defaults"; pond: Pond }
    | { kind: "new-pond" }
    | { kind: "settings" }
    | { kind: "move"; room: Room }
    | { kind: "delete"; room: Room }
    | null
  >(null);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof connections>>>([]);
  const [remoteActive, setRemoteActive] = useState(initial.active);
  const [needsSync, setNeedsSync] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>(
    initial.active.flatMap((item) => item.approvals),
  );
  const [activity, setActivity] = useState<Partial<Record<string, string>>>({});
  const runningRoom = useRef<string | null>(null);
  const submission = useRef<{
    roomId: string;
    messageId: string;
    text: string;
    restoreDraft: boolean;
  } | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("duckpond:preferences");
      const parsed = preferencesSchema.safeParse(stored ? JSON.parse(stored) : null);
      if (parsed.success) {
        setDrafts(parsed.data.drafts);
        setTargets(parsed.data.targets);
        setNewRosters(parsed.data.rosters);
        const previous = initial.rooms.find((item) => item.id === parsed.data.selected);
        if (previous) {
          setSelected(previous.id);
          setSelectedPond(previous.pondId ?? null);
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
        "duckpond:preferences",
        JSON.stringify({ selected, pondId: selectedPond, drafts, targets, rosters: newRosters }),
      );
    } catch {
      // Keep the controls usable even when browser storage is unavailable.
    }
  }, [preferencesLoaded, selected, selectedPond, drafts, targets, newRosters]);

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
  const locked = busy || saving || dictating;

  // Poll while a turn runs elsewhere or the stream dropped; the server owns the turn.
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
                ? "Your message didn't arrive. It's back in the box; try again."
                : "The summary request didn't arrive. Try again.",
            );
          }
          submission.current = null;
        } else {
          setError((message) => (message === reconnectError ? "" : message));
        }
        setNeedsSync(false);
        if (!value.active.some((item) => item.roomId === selected)) setStopping(false);
      } catch {
        if (!disposed) {
          setNeedsSync(true);
          setError(reconnectError);
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
    void cleanup().catch(() => setError("Couldn't remove unused empty conversations."));
  }, [preferencesLoaded, initial.rooms, selected, drafts]);

  /** Runs a save-like action with the shared saving flag and error banner. */
  async function guard(action: () => Promise<void>, fallback: string) {
    setSaving(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setSaving(false);
    }
  }
  async function switchRoom(id: string | null, pondId = selectedPond) {
    if (room && room.id !== id && !input.trim() && isUntouchedRoom(room)) {
      const result = await removeRoom({ data: { id: room.id, onlyIfUntouched: true } });
      if (result.deleted) setRooms((current) => current.filter((item) => item.id !== room.id));
    }
    setSelectedPond(id ? (rooms.find((item) => item.id === id)?.pondId ?? null) : pondId);
    setSelected(id);
    setSidebar(false);
  }
  /** The open conversation, created on first use so drafts never make empty rooms. */
  async function ensureRoom(roster = ducks) {
    if (room) return room;
    const created = await newRoom({ data: { ducks: roster, pondId: selectedPond ?? undefined } });
    receiveRoom(created);
    setDrafts((current) => ({ ...current, [newKey]: "", [created.id]: current[newKey] ?? "" }));
    setTargets((current) => ({ ...current, [created.id]: target }));
    setSelected(created.id);
    return created;
  }
  async function startNew() {
    await guard(async () => {
      const current = await loadPonds();
      setPonds(current);
      const fresh = current.find((item) => item.id === selectedPond);
      if (fresh?.error) throw new Error(fresh.error);
      if (!drafts[newKey]?.trim())
        setNewRosters((current) => without(current, selectedPond ?? "general"));
      await switchRoom(null);
    }, "Couldn't start a conversation.");
  }
  async function openPondDefaults() {
    await guard(async () => {
      const current = await loadPonds();
      setPonds(current);
      const fresh = current.find((item) => item.id === selectedPond);
      if (!fresh || fresh.error) throw new Error(fresh?.error ?? "Pond not found");
      setDialog({ kind: "pond-defaults", pond: fresh });
    }, "Couldn't read the pond.");
  }
  async function savePondDefaults(saved: Pond, value: { ducks: Duck[]; name: string }) {
    await savePond({
      data: { id: saved.id, revision: saved.revision, name: value.name, ducks: value.ducks },
    });
    setPonds(await loadPonds());
  }
  async function saveDucks(value: DuckSettingsSave) {
    await guard(async () => {
      if (dialog?.kind === "pond-defaults") {
        await savePondDefaults(dialog.pond, {
          ducks: value.ducks,
          name: value.pondName ?? dialog.pond.name,
        });
        if (!drafts[newKey]?.trim()) setNewRosters((current) => without(current, dialog.pond.id));
      } else {
        const active = await ensureRoom(value.ducks);
        receiveRoom(await updateRoom({ data: { id: active.id, ducks: value.ducks } }));
        if (value.asPondDefaults && selectedPond) {
          const fresh = (await loadPonds()).find((item) => item.id === selectedPond);
          if (!fresh || fresh.error) throw new Error(fresh?.error ?? "Pond not found");
          await savePondDefaults(fresh, { ducks: value.ducks, name: fresh.name });
        }
      }
      setDialog(null);
    }, "Couldn't save the ducks.");
  }
  async function saveNotes(notes: string) {
    const active = await ensureRoom();
    receiveRoom(await updateRoom({ data: { id: active.id, notes } }));
  }
  async function send(kind: "message" | "review" | "summary") {
    const text = kind === "summary" ? summaryRequest : input.trim();
    const mode: Mode =
      kind === "summary"
        ? "guide"
        : kind === "review"
          ? "review"
          : target === "mediator"
            ? "discussion"
            : "conversation";
    if (!text || locked) return;
    setError("");
    setSaving(true);
    setActivity({});
    let activeRoomId = selected;
    try {
      const active = await ensureRoom();
      activeRoomId = active.id;
      runningRoom.current = active.id;
      const messageId = crypto.randomUUID();
      submission.current = { roomId: active.id, messageId, text, restoreDraft: kind !== "summary" };
      if (kind !== "summary") {
        setDrafts((current) => ({ ...current, [key]: "", [active.id]: "" }));
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
            mode,
            target: target === "mediator" ? ducks[0].id : target,
          },
        },
      );
    } catch (cause) {
      if (kind !== "summary")
        setDrafts((current) => ({ ...current, [activeRoomId ?? newKey]: text }));
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

  const thinking = room?.messages.filter((message) => message.status === "thinking") ?? [];
  const first = thinking[0];
  const statusLine = needsSync
    ? "Reconnecting…"
    : approvals.length
      ? `${approvals[0].duck} is waiting for your answer above.`
      : busy
        ? first
          ? `${first.speaker}: ${(first.duckId && activity[first.duckId]) || "thinking"}${thinking.length > 1 ? ` · ${thinking.length - 1} more working` : ""}`
          : "Working…"
        : target === "mediator"
          ? "Mediator brings in the ducks who can help, lets them push back, and reports back."
          : `Only ${targetDuck?.name} replies. Type @ to add another duck.`;
  const placeholder =
    target === "mediator" ? "Ask the group…" : `Message ${targetDuck?.name ?? "a duck"}…`;

  return (
    <div className="app-shell">
      <Sidebar
        ponds={ponds}
        pondId={selectedPond}
        rooms={pondRooms}
        selected={selected}
        locked={locked || !preferencesLoaded}
        status={status}
        open={sidebar}
        onPond={(id) =>
          void switchRoom(rooms.find((item) => (item.pondId ?? null) === id)?.id ?? null, id).catch(
            (cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Couldn't switch ponds."),
          )
        }
        onNewPond={() => setDialog({ kind: "new-pond" })}
        onPondDefaults={() => void openPondDefaults()}
        onNew={() => void startNew()}
        onSelect={(id) =>
          void switchRoom(id).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Couldn't open that conversation."),
          )
        }
        onMove={(item) => setDialog({ kind: "move", room: item })}
        onDelete={(item) => setDialog({ kind: "delete", room: item })}
        onSettings={() => setDialog({ kind: "settings" })}
      />
      {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}
      <main className="conversation">
        <header className="conversation-header">
          <button
            className="icon-button mobile-only"
            aria-label="Conversations"
            aria-expanded={sidebar}
            onClick={() => setSidebar(!sidebar)}
          >
            <Menu size={20} />
          </button>
          <div className="conversation-title">
            <h1 title={room?.title}>{room?.title ?? "New conversation"}</h1>
            <span>
              {pond?.name ?? "General"} · {ducks.length} {ducks.length === 1 ? "duck" : "ducks"}
            </span>
          </div>
          <RoomNotes
            key={room?.id ?? newKey}
            notes={room?.notes ?? ""}
            disabled={locked}
            onSave={saveNotes}
          />
        </header>
        <Transcript key={selected} messages={room?.messages}>
          {room?.messages.length ? (
            <div className="messages">
              <ConversationMessages messages={room.messages} ducks={room.ducks} />
            </div>
          ) : (
            <div className="welcome">
              <h2>New conversation{pond ? ` in ${pond.name}` : ""}</h2>
              <p>
                Choose who you're talking to below. <strong>Mediator</strong> brings in the ducks
                who can help and reports back. Pick one duck for a direct answer.
              </p>
              <div className="suggestions">
                {prompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => setInput(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Transcript>
        <div className="composer-area">
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button className="icon-button" onClick={() => setError("")} aria-label="Dismiss">
                <X size={15} />
              </button>
            </div>
          )}
          {approvals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
          <DuckBar
            ducks={ducks}
            target={target}
            thinking={thinking}
            editDisabled={locked}
            onTarget={(value) => setTargets((current) => ({ ...current, [key]: value }))}
            onEdit={() => setDialog({ kind: "ducks" })}
          />
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send("message");
            }}
          >
            <MentionInput
              key={selected}
              value={input}
              onChange={setInput}
              ducks={ducks}
              placeholder={placeholder}
              onSend={() => void send("message")}
              onDictatingChange={setDictating}
            />
            {busy ? (
              <button
                className="send-button stop"
                type="button"
                onClick={stop}
                disabled={stopping}
                aria-label="Stop replies"
              >
                <Square size={13} fill="currentColor" />
                <span>{stopping ? "Stopping" : "Stop"}</span>
              </button>
            ) : (
              <button
                className="send-button"
                disabled={!input.trim() || saving || dictating}
                type="submit"
                aria-label="Send"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </form>
          <div className="composer-footer">
            <span className={`composer-status ${busy ? "live" : ""}`} role="status">
              {statusLine}
            </span>
            <span className="composer-actions">
              <button
                type="button"
                className="text-button"
                disabled={locked || !input.trim() || ducks.length < 2}
                title="Every duck answers without seeing the others, then Mediator sums up"
                onClick={() => void send("review")}
              >
                Ask each separately
              </button>
              <button
                type="button"
                className="text-button"
                disabled={locked || !room?.messages.length}
                title="Mediator recaps the conversation once"
                onClick={() => void send("summary")}
              >
                Summarize
              </button>
            </span>
          </div>
        </div>
      </main>
      {dialog?.kind === "ducks" && (
        <DuckSettings
          key={room?.id ?? newKey}
          scope={{ kind: "conversation", roomId: room?.id, pond, notes: room?.notes ?? "" }}
          ducks={ducks}
          saving={saving}
          error={error}
          onSave={saveDucks}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "pond-defaults" && (
        <DuckSettings
          scope={{ kind: "pond", pond: dialog.pond }}
          ducks={dialog.pond.ducks}
          saving={saving}
          error={error}
          onSave={saveDucks}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
        />
      )}
      {dialog?.kind === "new-pond" && (
        <PondDialog
          ducks={ducks}
          onClose={() => setDialog(null)}
          onCreated={async (created) => {
            setPonds(await loadPonds());
            await switchRoom(null, created.id);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "settings" && (
        <AppSettings status={status} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          room={dialog.room}
          ponds={ponds}
          onClose={() => setDialog(null)}
          onMove={async (pondId) => {
            const moved = await moveToPond({ data: { roomId: dialog.room.id, pondId } });
            receiveRoom(moved);
            setSelected(moved.id);
            setSelectedPond(pondId);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          room={dialog.room}
          onClose={() => setDialog(null)}
          onDelete={async () => {
            const deleting = dialog.room;
            await removeRoom({ data: { id: deleting.id, onlyIfUntouched: false } });
            setRooms((current) => current.filter((item) => item.id !== deleting.id));
            setDrafts((current) => without(current, deleting.id));
            setTargets((current) => without(current, deleting.id));
            if (selected === deleting.id)
              setSelected(pondRooms.find((item) => item.id !== deleting.id)?.id ?? null);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

/** A duck's request for permission or input, answered inline above the composer. */
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
      setError(cause instanceof Error ? cause.message : "Couldn't send your answer.");
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
      <strong>{approval.duck} needs your answer</strong>
      <div>{approval.title}</div>
      {approval.reason && <p>{approval.reason}</p>}
      {approval.command && (
        <pre className="approval-command">
          <code>{approval.command}</code>
        </pre>
      )}
      {approval.cwd && (
        <p className="muted">
          In <code>{approval.cwd}</code>
        </p>
      )}
      {approval.remember && (
        <p className="muted">
          "Always allow" saves this exact command for every duck in this folder. You can revoke it
          in Settings.
        </p>
      )}
      <details>
        <summary>Technical details</summary>
        <pre>{approval.detail}</pre>
      </details>
      {approval.url?.startsWith("https://") && (
        <a href={approval.url} target="_blank" rel="noreferrer">
          Open the requested page
        </a>
      )}
      {approval.fields?.map((field) => (
        <label key={field.key} className={field.kind === "boolean" ? "check" : "field"}>
          {field.kind === "boolean" ? (
            <>
              <input
                type="checkbox"
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [field.key]: event.target.checked }))
                }
              />
              {field.label}
            </>
          ) : (
            <>
              <span>{field.label}</span>
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
        <p className="muted">Check the technical details before continuing.</p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="approval-actions">
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
            Always allow here
          </button>
        )}
        <button disabled={sending} type="submit" className="primary-button">
          {approval.input ? "Submit" : "Allow once"}
        </button>
      </div>
    </form>
  );
}
