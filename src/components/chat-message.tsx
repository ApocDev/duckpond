import { createContext, useContext, useEffect, useMemo, useRef, memo, useState } from "react";
import { MessageMarkdown } from "./message-markdown";
import { Check, ChevronDown, Plus, RotateCcw } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { groupMessages } from "../lib/message-groups";
import { mentionHandle } from "../lib/mentions";
import { hostColor, rosterColors, speakerColor } from "../lib/duck-colors";
import { modelLabel } from "../lib/models";
import { DuckAvatar } from "./duck-avatar";

const DuckNames = createContext<Record<string, string>>({});
const DuckColors = createContext(new Map<string, string>());
/** Re-asks one duck after its reply failed; the host decides how. */
const Retry = createContext<((duckId: string) => void) | undefined>(undefined);
/** The conversation's notes, so Mediator's reports can be added to them. */
const Notes = createContext<{ notes: string; add?: (text: string) => Promise<void> }>({
  notes: "",
});

/** The transcript: your messages, single replies, and grouped reply rounds. */
export const ConversationMessages = memo(function ConversationMessages({
  messages,
  ducks,
  notes,
  onRetry,
  onAddToNotes,
}: {
  messages: Message[];
  ducks: Duck[];
  notes: string;
  onRetry?: (duckId: string) => void;
  onAddToNotes: (text: string) => Promise<void>;
}) {
  const entries = messages
    .filter((message) => message.duckId)
    .map((message) => [message.duckId!, message.speaker]);
  for (const duck of ducks)
    entries.push([duck.id, duck.name], [mentionHandle(duck, ducks), duck.name]);
  const signature = JSON.stringify(Object.fromEntries(entries));
  const names = useMemo<Record<string, string>>(() => JSON.parse(signature), [signature]);
  const colors = useMemo(() => rosterColors(ducks), [ducks]);
  const notesValue = useMemo(() => ({ notes, add: onAddToNotes }), [notes, onAddToNotes]);
  return (
    <Notes.Provider value={notesValue}>
      <Retry.Provider value={onRetry}>
        <DuckColors.Provider value={colors}>
          <DuckNames.Provider value={names}>
            {groupMessages(messages).map((group) =>
              group.kind === "message" ? (
                <ChatMessage key={group.id} message={group.message} />
              ) : (
                <ReplyRound key={group.id} messages={group.messages} />
              ),
            )}
          </DuckNames.Provider>
        </DuckColors.Provider>
      </Retry.Provider>
    </Notes.Provider>
  );
});

/** One line once every reply finished; a running or interrupted round stays open. */
function ReplyRound({ messages }: { messages: Message[] }) {
  const [expanded, setExpanded] = useState(false);
  const working = unique(messages.filter((message) => message.status === "thinking"));
  const unfinished = messages.filter(
    (message) => message.status === "error" || message.status === "stopped",
  ).length;
  const spoke = messages.filter((message) => message.status === "complete");
  const passed = messages.filter((message) => message.status === "passed");
  const settled = spoke.length + passed.length === messages.length;
  const open = !settled || expanded;
  const speakers = unique(spoke).filter((message) => !isHost(message));
  const colors = useContext(DuckColors);
  return (
    <section className={`reply-round ${open ? "open" : ""}`} aria-label="Duck replies">
      <button
        type="button"
        className="round-heading"
        aria-expanded={open}
        disabled={!settled}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="round-avatars">
          {unique(messages.filter((message) => !isHost(message)))
            .slice(0, 4)
            .map((message) => (
              <DuckAvatar
                key={message.duckId}
                avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })}
                color={speakerColor(colors, message.duckId!)}
              />
            ))}
        </span>
        <span className="round-summary">
          {settled
            ? roundSummary(
                messages[0].phase,
                speakers.map((message) => message.speaker),
                unique(passed).length,
              )
            : working.length
              ? `${listNames(working.map((message) => message.speaker))} ${working.length === 1 ? "is" : "are"} still working · ${spoke.length + passed.length} of ${messages.length} replied`
              : `${unfinished} ${unfinished === 1 ? "reply" : "replies"} didn't finish`}
        </span>
        {settled && (
          <span className="round-toggle">
            {expanded ? "Hide" : "Show"} <ChevronDown size={14} />
          </span>
        )}
      </button>
      {open && (
        <div className="round-replies">
          {messages.map((message) => (
            <RoundReply key={message.id} message={message} />
          ))}
        </div>
      )}
    </section>
  );
}

function isHost(message: Message) {
  return message.duckId === "mediator" || message.duckId === "guide";
}

function unique(messages: Message[]) {
  return [...new Map(messages.map((message) => [message.duckId, message])).values()];
}

/** "Skeptic", "Skeptic and Explorer", or "Skeptic, Explorer and 2 others". */
export function listNames(names: string[]) {
  return names.length <= 2
    ? names.join(" and ")
    : names.length === 3
      ? `${names[0]}, ${names[1]} and ${names[2]}`
      : `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

function roundSummary(phase: Message["phase"], names: string[], passes: number) {
  const passNote = passes ? ` · ${passes} passed` : "";
  if (!names.length)
    return passes ? `Nobody had anything to add${passNote}` : "Mediator answered directly";
  if (phase === "review")
    return `${names.length} independent ${names.length === 1 ? "answer" : "answers"}${passNote}`;
  const who = listNames(names);
  return phase === "discussion"
    ? `Mediator consulted ${who}${passNote}`
    : `${who} replied${passNote}`;
}

const RoundReply = memo(function RoundReply({ message }: { message: Message }) {
  const color = speakerColor(useContext(DuckColors), message.duckId!);
  if (message.status === "passed") return <PassedLine message={message} />;
  if (message.duckId === "mediator" && message.status === "complete")
    return <HandoffLine message={message} />;
  return (
    <article data-scroll-anchor className="round-reply">
      <MessageHeading message={message} color={color} />
      <MessageText message={message} />
    </article>
  );
});

/**
 * Mediator's instructions to a duck, folded to one line: they explain the process, not the
 * answer, so they stay out of the way until asked for.
 */
function HandoffLine({ message }: { message: Message }) {
  const names = useContext(DuckNames);
  const [open, setOpen] = useState(false);
  const [, handle, rest] = message.text.match(/^@([\w-]+):?\s*([\s\S]*)$/) ?? [];
  const who = handle ? (names[handle] ?? handle) : undefined;
  const summary = (rest ?? message.text).split(/(?<=[.!?])\s|\n/)[0];
  return (
    <div data-scroll-anchor className={`handoff-line ${open ? "open" : ""}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <DuckAvatar avatar="wizard" small color={hostColor} />
        <span>
          <strong>Mediator {who ? `asked ${who}` : "noted"}:</strong> {summary}
        </span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && <MessageText message={message} />}
    </div>
  );
}

function PassedLine({ message }: { message: Message }) {
  const color = speakerColor(useContext(DuckColors), message.duckId!);
  return (
    <p data-scroll-anchor className="passed-line">
      <DuckAvatar
        avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })}
        small
        color={color}
      />
      {message.speaker} had nothing to add
    </p>
  );
}

function MessageHeading({ message, color }: { message: Message; color: string }) {
  const retry = useContext(Retry);
  return (
    <div className="message-heading">
      <DuckAvatar
        avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })}
        small
        color={color}
      />
      <strong
        style={{ color }}
        title={message.model ? modelLabel(message.model, message.reasoning) : undefined}
      >
        {message.speaker}
      </strong>
      {message.phase === "review" && <span className="message-meta">answered independently</span>}
      {message.status === "thinking" && <LiveStatus message={message} />}
      {message.status === "stopped" && <span className="message-meta">stopped</span>}
      {message.status === "error" && <span className="message-meta error">failed</span>}
      {(message.status === "error" || message.status === "stopped") &&
        retry &&
        message.duckId &&
        !isHost(message) && (
          <button
            type="button"
            className="text-button retry"
            onClick={() => retry(message.duckId!)}
          >
            <RotateCcw size={13} /> Ask {message.speaker} again
          </button>
        )}
      {message.status !== "thinking" && !!message.tools?.length && (
        <details className="tool-log">
          <summary>
            {message.tools.length} {message.tools.length === 1 ? "step" : "steps"}
          </summary>
          <ul>
            {message.tools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * "reading docs/plan.md · 1:42" while a reply runs. Shows whichever changed last, new text or a
 * new step, and says "no update for 1:10" once a minute passes without either.
 */
function LiveStatus({ message }: { message: Message }) {
  const now = useNow();
  const last = useRef({
    text: message.written ?? message.text.length,
    tools: message.tools?.length ?? 0,
    at: 0,
  });
  const writing = useRef(false);
  const text = message.written ?? message.text.length;
  const tools = message.tools?.length ?? 0;
  if (text !== last.current.text || tools !== last.current.tools || !last.current.at) {
    if (tools !== last.current.tools) writing.current = false;
    else if (text !== last.current.text) writing.current = true;
    last.current = { text, tools, at: Date.now() };
  }
  const quiet = Math.floor((now - last.current.at) / 1000);
  const step = writing.current ? "writing" : (message.tools?.at(-1) ?? "thinking");
  return (
    <span className={`message-meta live ${quiet >= 60 ? "quiet" : ""}`}>
      {quiet >= 60 ? `no update for ${clock(quiet)}` : step} ·{" "}
      {clock(Math.floor((now - Date.parse(message.createdAt)) / 1000))}
    </span>
  );
}

export function clock(seconds: number) {
  const value = Math.max(0, seconds);
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const ChatMessage = memo(function ChatMessage({ message }: { message: Message }) {
  const colors = useContext(DuckColors);
  if (!message.duckId)
    return (
      <article data-scroll-anchor className="chat-message human-message">
        <MessageText message={message} />
      </article>
    );
  if (message.status === "passed") return <PassedLine message={message} />;
  return (
    <article
      data-scroll-anchor
      className={`chat-message duck-message ${message.phase === "guide" ? "host-message" : ""}`}
    >
      <MessageHeading message={message} color={speakerColor(colors, message.duckId)} />
      <MessageText message={message} />
      {message.phase === "guide" && message.status === "complete" && !!message.text && (
        <AddToNotes text={message.text} />
      )}
    </article>
  );
});

/** Copies a Mediator report into the shared notes, so later turns keep its decisions. */
function AddToNotes({ text }: { text: string }) {
  const { notes, add } = useContext(Notes);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!add) return null;
  if (notes.includes(text.trim()))
    return (
      <p className="message-action done">
        <Check size={14} /> In notes
      </p>
    );
  return (
    <p className="message-action">
      <button
        type="button"
        className="text-button"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setFailed(false);
          add(text.trim())
            .catch(() => setFailed(true))
            .finally(() => setSaving(false));
        }}
      >
        <Plus size={14} /> {saving ? "Adding…" : "Add to notes"}
      </button>
      {failed && <span className="message-meta error">Couldn't save. Try again.</span>}
    </p>
  );
}

function MessageText({ message }: { message: Message }) {
  const names = useContext(DuckNames);
  const text = message.text.replace(/@([\w-]+)/g, (match, id: string) =>
    names[id] ? `@${names[id].replace(/[\\`*_[\]]/g, "\\$&")}` : match,
  );
  const assignment = message.duckId === "mediator" && text.includes("\nAction ID:");
  const complete = message.status === "complete";
  return (
    <div className={`message-text ${message.status === "error" ? "message-error" : ""}`}>
      {message.text ? (
        assignment ? (
          <>
            <MessageMarkdown complete={complete}>{text.split(/\.\s|\n/)[0]}</MessageMarkdown>
            <details className="assignment">
              <summary>Full assignment</summary>
              <MessageMarkdown complete={complete}>{text}</MessageMarkdown>
            </details>
          </>
        ) : (
          <MessageMarkdown complete={complete}>{text}</MessageMarkdown>
        )
      ) : (
        <span className="thinking-text">
          {message.status === "thinking"
            ? message.written
              ? "Writing the reply. It appears here when it's done."
              : "Working on it. The reply appears here when it's ready."
            : "No reply."}
        </span>
      )}
    </div>
  );
}
