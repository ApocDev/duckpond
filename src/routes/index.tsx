import { z } from "zod";
import { createFileRoute, replaceEqualDeep } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ListChecks, Menu, Pencil, Square, X } from "lucide-react";
import { AppSettings } from "../components/app-settings";
import { DeleteDialog, MoveDialog, RenameDialog } from "../components/conversation-dialogs";
import { DuckBar, type Target } from "../components/duck-bar";
import { DuckSettings } from "../components/duck-settings";
import { MentionInput } from "../components/mention-input";
import { PondDialog } from "../components/pond-dialog";
import { RoomNotes, type NotesField } from "../components/room-notes";
import { Sidebar } from "../components/sidebar";
import { Transcript } from "../components/transcript";
import { ConversationMessages, clock, listNames, useNow } from "../components/chat-message";
import { loadPonds, moveToPond, savePond, savePondNotes } from "../server/ponds.functions";
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
  selectDucks,
  summaryRequest,
  type Approval,
  type Duck,
  type Mode,
  type Room,
  type RoomStream,
} from "../lib/room";
import { pathsOutside } from "../lib/approval";
import { mentionHandle } from "../lib/mentions";

export const Route = createFileRoute("/")({ loader: () => loadRooms(), component: Home });
const transport = new DefaultChatTransport<RoomStream>({ api: "/api/chat" });
const prompts = [
  "Help me figure out what to work on next.",
  "Help me decide between two approaches.",
  "Poke holes in something I'm building.",
];
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
  if (stored === "mediator" || (stored === "everyone" && ducks.length > 1)) return stored;
  if (stored && ducks.some((duck) => duck.id === stored)) return stored;
  return ducks.length > 1 ? "mediator" : ducks[0].id;
}

/**
 * The composer's line while a turn runs: the phase, who is working, and how long the turn has
 * taken, e.g. "Mediator is choosing who answers  0:42" or "Skeptic and Explorer are replying  1:10".
 */
function WorkingLine({ messages }: { messages: Room["messages"] }) {
  const now = useNow();
  const asked = messages.findLastIndex((message) => !message.duckId);
  const turn = messages.slice(asked + 1);
  const thinking = turn.filter((message) => message.status === "thinking");
  const started = Date.parse((messages[asked] ?? thinking[0]).createdAt);
  const host = thinking.find((message) => message.duckId === "mediator");
  const summary = thinking.find((message) => message.duckId === "guide");
  const ducks = thinking.filter((message) => message !== host && message !== summary);
  const names = ducks.map((message) => message.speaker);
  const replied = turn.some(
    (message) => message.status === "complete" && message.duckId !== "mediator",
  );
  const phase = summary
    ? "Mediator is summing up"
    : host && !ducks.length
      ? replied
        ? "Mediator is weighing the replies"
        : "Mediator is choosing who answers"
      : names.length === 1
        ? `${names[0]} is ${ducks[0].tools?.at(-1) ?? (ducks[0].text || ducks[0].written ? "writing" : "thinking")}`
        : `${listNames(names)} are replying`;
  // The timer sits apart from the phase so a narrow screen trims the words, never the time.
  return (
    <>
      <span className="phase" title={names.join(", ") || undefined}>
        {phase}
      </span>
      <span className="elapsed" title="Time since you sent the message">
        {clock(Math.floor((now - started) / 1000))} total
      </span>
    </>
  );
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
    | { kind: "rename"; room: Room }
    | { kind: "delete"; room: Room }
    | null
  >(null);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  /** Set from submit until this tab's reply stream ends; only the composer waits on it. */
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof connections>>>([]);
  const [remoteActive, setRemoteActive] = useState(initial.active);
  const [needsSync, setNeedsSync] = useState(false);
  // Every pending approval, tagged with its conversation. Only the open one shows its cards.
  const [approvals, setApprovals] = useState<{ roomId: string; approval: Approval }[]>(
    initial.active.flatMap((item) =>
      item.approvals.map((approval) => ({ roomId: item.roomId, approval })),
    ),
  );
  // The conversation whose reply stream this tab is reading, if any.
  const [streaming, setStreaming] = useState<string | null>(null);
  const streamingRef = useRef<string | null>(null);
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
      if (event.type === "approval" && streamingRef.current) {
        const roomId = streamingRef.current;
        setApprovals((current) => [...current, { roomId, approval: event.approval }]);
      }
      if (event.type === "resolved")
        setApprovals((current) => current.filter((item) => item.approval.id !== event.id));
      if (event.type === "message")
        setRooms((current) =>
          current.map((item) =>
            item.id !== streamingRef.current
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
  // Turns run on the server; a conversation is busy while one runs there or streams here.
  const working = new Set([
    ...remoteActive.map((item) => item.roomId),
    ...(localBusy && streaming ? [streaming] : []),
  ]);
  const busy = needsSync || (!!selected && working.has(selected));
  const waiting = new Set(approvals.map((item) => item.roomId));
  const roomApprovals = approvals
    .filter((item) => item.roomId === selected)
    .map((item) => item.approval);

  // Escape closes the phone drawer, like any other overlay.
  useEffect(() => {
    if (!sidebar) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setSidebar(false);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [sidebar]);

  // The tab title tells a hidden tab's owner that a duck is waiting on them or replies finished.
  const [ready, setReady] = useState(false);
  const workingKey = [...working].sort().join();
  const previousWorking = useRef(workingKey);
  useEffect(() => {
    const now = new Set(workingKey.split(",").filter(Boolean));
    const finished = previousWorking.current.split(",").some((id) => id && !now.has(id));
    previousWorking.current = workingKey;
    if (finished && document.visibilityState === "hidden") setReady(true);
  }, [workingKey]);
  useEffect(() => {
    const clear = () => document.visibilityState === "visible" && setReady(false);
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
  }, []);
  useEffect(() => {
    document.title = waiting.size
      ? "Waiting for you · Duckpond"
      : ready
        ? "Replies ready · Duckpond"
        : "Duckpond";
  }, [waiting.size, ready]);
  /** Only the busy conversation's composer and roster lock; navigation never does. */
  const composerLocked = busy || saving || sending || dictating;

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
          value.active.flatMap((item) =>
            item.approvals.map((approval) => ({ roomId: item.roomId, approval })),
          ),
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
    // Leaving a streaming conversation drops only this tab's stream; polling follows the turn.
    if (localBusy && streamingRef.current !== id) {
      void chat.stop();
      setNeedsSync(true);
    }
    setApprovals([]);
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
  async function saveDucks(value: { ducks: Duck[]; pondName?: string; pondDefaults?: boolean }) {
    await guard(async () => {
      if (dialog?.kind === "pond-defaults") {
        await savePond({
          data: {
            id: dialog.pond.id,
            revision: dialog.pond.revision,
            name: value.pondName ?? dialog.pond.name,
            ducks: value.ducks,
          },
        });
        setPonds(await loadPonds());
        if (!drafts[newKey]?.trim()) setNewRosters((current) => without(current, dialog.pond.id));
      } else {
        const active = await ensureRoom(value.ducks);
        receiveRoom(await updateRoom({ data: { id: active.id, ducks: value.ducks } }));
        if (value.pondDefaults && pond) {
          await savePond({ data: { ...pond, ducks: value.ducks } });
          setPonds(await loadPonds());
        }
      }
      setDialog(null);
    }, "Couldn't save the ducks.");
  }
  async function saveNotes(notes: string) {
    const active = await ensureRoom();
    receiveRoom(await updateRoom({ data: { id: active.id, notes } }));
  }
  async function savePondNotesFor(id: string, notes: string) {
    const saved = await savePondNotes({ data: { id, notes } });
    setPonds((current) => current.map((item) => (item.id === id ? { ...item, ...saved } : item)));
  }
  async function send(kind: "message" | "summary") {
    const text = kind === "summary" ? summaryRequest : input.trim();
    const mode: Mode =
      kind === "summary"
        ? "guide"
        : target === "everyone"
          ? "review"
          : target === "mediator"
            ? "discussion"
            : "conversation";
    if (!text || composerLocked) return;
    setError("");
    setSending(true);
    let activeRoomId = selected;
    try {
      // This tab reads one reply stream at a time. Another conversation's turn keeps running on
      // the server; drop its stream and let polling follow it.
      if (localBusy) {
        await chat.stop();
        setNeedsSync(true);
      }
      const active = await ensureRoom();
      activeRoomId = active.id;
      streamingRef.current = active.id;
      setStreaming(active.id);
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
            target: targetDuck?.id ?? ducks[0].id,
          },
        },
      );
    } catch (cause) {
      if (kind !== "summary")
        setDrafts((current) => ({ ...current, [activeRoomId ?? newKey]: text }));
      setError(cause instanceof Error ? cause.message : "Couldn't send your message.");
    } finally {
      setSending(false);
      streamingRef.current = null;
      setStreaming(null);
      setNeedsSync(true);
    }
  }
  async function stop() {
    if (!selected) return;
    setStopping(true);
    try {
      await stopRoom({ data: selected });
    } catch {
      setStopping(false);
      setError("Couldn't stop the replies. Try again.");
    }
  }

  const thinking = room?.messages.filter((message) => message.status === "thinking") ?? [];
  /**
   * "Edit and ask again" after a failed or stopped reply: puts back the message that reply answered,
   * with the To choice it used. A duck's retry goes to that duck alone; a stopped Summarize reruns.
   */
  function retry(messageId: string) {
    if (!room) return;
    const index = room.messages.findIndex((message) => message.id === messageId);
    const asked = room.messages.slice(0, index).findLastIndex((message) => !message.duckId);
    const question = room.messages[asked];
    if (!question) return;
    if (question.text === summaryRequest) return void send("summary");
    const reply = room.messages[index];
    const turn = room.messages.slice(asked + 1, index + 1);
    const host = reply.duckId === "mediator" || reply.duckId === "guide";
    const duck = ducks.find((item) => item.id === reply.duckId);
    const retarget = host
      ? turn.some((message) => message.phase === "review")
        ? "everyone"
        : turn.some((message) => message.phase === "discussion")
          ? "mediator"
          : undefined
      : reply.duckId;
    if (retarget) setTargets((current) => ({ ...current, [key]: retarget }));
    // In a Mediator round the duck was answering Mediator's question to it, not your message.
    const handoff =
      duck && reply.phase === "discussion"
        ? turn.findLast(
            (message) => message.duckId === "mediator" && message.text.startsWith(`@${duck.id}`),
          )
        : undefined;
    // Other ducks it names become plain names, so they aren't sent the question too.
    const asking = handoff
      ? handoff.text
          .replace(/^@[\w-]+:?\s*/, "")
          .split("\n\nDeliverable:")[0]
          .replace(
            /@([\w-]+)/g,
            (mention, id: string) =>
              ducks.find((item) => item.id === id || mentionHandle(item, ducks) === id)?.name ??
              mention,
          )
      : question.text;
    // The duck is now the recipient, so a mention of it in the old text would be redundant.
    const text = duck
      ? asking
          .replace(new RegExp(`@(${duck.id}|${mentionHandle(duck, ducks)})\\b[,:]?\\s*`, "gi"), "")
          .trim()
      : asking;
    if (!input.trim()) setInput(text);
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(),
    );
  }
  const summarizeBlocked = !room?.messages.length
    ? "Send a message first."
    : composerLocked
      ? "Available when the replies finish."
      : undefined;
  // The pond's notes, which every conversation in it inherits, sit above this conversation's.
  const notesFields: NotesField[] = [
    ...(pond
      ? [
          {
            key: `pond:${pond.id}`,
            label: "This pond",
            hint: `Every conversation in ${pond.name} reads these.`,
            value: pond.notes,
            save: (notes: string) => savePondNotesFor(pond.id, notes),
          },
        ]
      : []),
    {
      key: room?.id ?? newKey,
      label: "This conversation",
      hint: "Only this conversation reads these.",
      value: room?.notes ?? "",
      save: saveNotes,
    },
  ];
  // Who a direct message reaches: the selected duck plus anyone mentioned in the draft.
  const replying = targetDuck
    ? selectDucks(ducks, input, targetDuck.id).map((duck) => duck.name)
    : [];
  const statusLine = needsSync ? (
    "Reconnecting…"
  ) : roomApprovals.length ? (
    `${roomApprovals[0].duck} is waiting for your answer above.`
  ) : busy ? (
    room && thinking.length ? (
      <WorkingLine messages={room.messages} />
    ) : (
      "Working…"
    )
  ) : target === "mediator" ? (
    "Mediator picks who answers, lets them push back, and reports back."
  ) : target === "everyone" ? (
    "Every duck answers without seeing the others, then Mediator sums up."
  ) : (
    `${replying.length > 1 ? `${listNames(replying)} answer separately, with no Mediator summary` : `Only ${targetDuck?.name} replies`}. Type @ to add a duck.`
  );
  const offline = (["claude", "codex"] as const)
    .filter(
      (provider) =>
        ducks.some((duck) => duck.provider === provider) &&
        status.some((item) => item.provider === provider && !item.connected),
    )
    .map((provider) => (provider === "claude" ? "Claude" : "Codex"));
  const placeholder =
    target === "mediator"
      ? "Ask the group…"
      : target === "everyone"
        ? "Ask every duck separately…"
        : `Message ${targetDuck?.name ?? "a duck"}…`;

  return (
    <div className={`app-shell ${preferencesLoaded ? "" : "restoring"}`}>
      <Sidebar
        ponds={ponds}
        pondId={selectedPond}
        rooms={pondRooms}
        selected={selected}
        working={working}
        waiting={waiting}
        locked={saving || dictating || !preferencesLoaded}
        status={status}
        open={sidebar}
        onPond={(id) =>
          void switchRoom(rooms.find((item) => (item.pondId ?? null) === id)?.id ?? null, id).catch(
            (cause: unknown) =>
              setError(cause instanceof Error ? cause.message : "Couldn't switch ponds."),
          )
        }
        onNewPond={() => setDialog({ kind: "new-pond" })}
        onPondSettings={() => void openPondDefaults()}
        onNew={() => void startNew()}
        onSelect={(id) =>
          void switchRoom(id).catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : "Couldn't open that conversation."),
          )
        }
        onRename={(item) => setDialog({ kind: "rename", room: item })}
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
            {room ? (
              <button
                type="button"
                className="title-button"
                title={`${room.title} (click to rename)`}
                onClick={() => setDialog({ kind: "rename", room })}
              >
                <h1>{room.title}</h1>
                <Pencil size={13} aria-hidden />
              </button>
            ) : (
              <h1>New conversation</h1>
            )}
            <span>
              {pond?.name ?? "General"} · {ducks.length} {ducks.length === 1 ? "duck" : "ducks"} +
              Mediator
            </span>
          </div>
          <button
            type="button"
            className="secondary-button compact summarize-button"
            aria-label="Summarize"
            title={
              summarizeBlocked ??
              "Mediator recaps where things landed, what's still disagreed, and the next question."
            }
            disabled={!!summarizeBlocked}
            onClick={() => void send("summary")}
          >
            <ListChecks size={15} />
            <span>Summarize</span>
          </button>
          <RoomNotes
            conversation={room?.id ?? newKey}
            fields={notesFields}
            disabled={saving || dictating}
          />
        </header>
        <Transcript key={selected} messages={room?.messages}>
          {room?.messages.length ? (
            <div className="messages">
              <ConversationMessages
                messages={room.messages}
                ducks={room.ducks}
                notes={room.notes}
                workspace={room.workspace}
                onRetry={busy ? undefined : retry}
                onSumUp={busy ? undefined : () => void send("summary")}
                onAddToNotes={(text) => saveNotes(appended(room.notes, text))}
                pondNotes={
                  pond && {
                    notes: pond.notes,
                    add: (text) => savePondNotesFor(pond.id, appended(pond.notes, text)),
                  }
                }
              />
            </div>
          ) : (
            <div className="welcome">
              <h2>New conversation{pond ? ` in ${pond.name}` : ""}</h2>
              <p>Use To, below, to pick who answers:</p>
              <ul className="welcome-modes">
                <li>
                  <strong className="host">Mediator</strong> brings in the ducks who can help, lets
                  them push back, and reports back. Best for most questions.
                </li>
                <li>
                  <strong>Each separately</strong> asks every duck at once without letting them see
                  each other, then Mediator sums up. Good for a blind second opinion.
                </li>
                <li>
                  <strong>One duck</strong> answers alone. Type @ to bring in another; each answers
                  on its own, with no Mediator summary.
                </li>
              </ul>
              <p className="muted">
                This conversation gets its own copy of the {pond ? pond.name : "starting"} ducks, so
                changing them under Ducks leaves other conversations alone. A duck with nothing
                useful to add says so instead of padding its reply.
              </p>
              {!!offline.length && (
                <p className="banner error" role="status">
                  {offline.join(" and ")} {offline.length === 1 ? "isn't" : "aren't"} signed in, so
                  ducks that use {offline.length === 1 ? "it" : "them"} can't reply. Open Settings
                  to see how to sign in.
                </p>
              )}
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
          {!!roomApprovals.length && (
            <div className="approvals">
              {roomApprovals.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} />
              ))}
            </div>
          )}
          <DuckBar
            ducks={ducks}
            target={target}
            thinking={thinking}
            editLabel="Ducks"
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
              exclude={targetDuck?.id}
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
                disabled={!input.trim() || saving || sending || dictating}
                type="submit"
                aria-label="Send"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </form>
          <p className={`composer-status ${busy ? "live" : ""}`} role="status">
            {statusLine}
          </p>
        </div>
      </main>
      {dialog?.kind === "ducks" && (
        <DuckSettings
          key={room?.id ?? newKey}
          scope={{ kind: "conversation", roomId: room?.id, pond, room }}
          ducks={ducks}
          readOnly={busy}
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
          ponds={ponds}
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
      {dialog?.kind === "rename" && (
        <RenameDialog
          room={dialog.room}
          onClose={() => setDialog(null)}
          onRename={async (title) => {
            receiveRoom(await updateRoom({ data: { id: dialog.room.id, title } }));
            setDialog(null);
          }}
        />
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
  const outside =
    approval.command && approval.cwd ? pathsOutside(approval.command, approval.cwd) : [];
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
      <strong>
        {approval.duck} {approval.input ? "has a question" : "asks permission"}
      </strong>
      <div>{approval.title}</div>
      {approval.reason && <p>{approval.reason}</p>}
      {approval.path && (
        <p>
          File <code>{approval.path}</code>
          {approval.cwd && !!pathsOutside(`read ${approval.path}`, approval.cwd).length && (
            <strong className="approval-warning"> · outside this folder</strong>
          )}
        </p>
      )}
      {approval.preview && (
        <pre className="approval-command">
          <code>{approval.preview}</code>
        </pre>
      )}
      {approval.command && (
        <pre className="approval-command">
          <code>{approval.command}</code>
        </pre>
      )}
      {!!outside.length && (
        <p className="approval-warning">
          Check these paths, they may be outside this folder: {outside.join(", ")}
        </p>
      )}
      {approval.cwd && (
        <p className="muted">
          {approval.command ? "Runs from" : "Project folder"} <code>{approval.cwd}</code>
        </p>
      )}
      {approval.remember && (
        <p className="muted">
          "Always allow" saves this exact command for every duck on this provider in this folder.
          You can revoke it in Settings.
        </p>
      )}
      {approval.editsInFolder && (
        <p className="muted">
          "Allow edits this turn" lets {approval.duck} change files in this folder without asking
          again until it replies.
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
        {(approval.remember || approval.editsInFolder) && (
          <button
            disabled={sending}
            type="button"
            className="secondary-button"
            onClick={() => respond(true, true)}
          >
            {approval.remember ? "Always allow here" : "Allow edits this turn"}
          </button>
        )}
        <button disabled={sending} type="submit" className="primary-button">
          {approval.input ? "Submit" : "Allow once"}
        </button>
      </div>
    </form>
  );
}

/** Notes with `text` added as a new paragraph. */
function appended(notes: string, text: string) {
  return notes.trim() ? `${notes.trim()}\n\n${text}` : text;
}
