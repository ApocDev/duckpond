import { createContext, useContext, useEffect, useMemo, useRef, memo, useState } from "react";
import { MessageMarkdown } from "./message-markdown";
import { ArrowDown, Check, ChevronDown, FileText, ListChecks, Plus, RotateCcw } from "lucide-react";
import { duckAvatar, summaryRequest, type Duck, type Message } from "../lib/room";
import { groupMessages } from "../lib/message-groups";
import { mentionHandle } from "../lib/mentions";
import { hostColor, rosterColors, speakerColor } from "../lib/duck-colors";
import { modelLabel } from "../lib/models";
import { DuckAvatar } from "./duck-avatar";

const DuckNames = createContext<Record<string, string>>({});
const DuckColors = createContext(new Map<string, string>());
/** Puts back the message a failed or stopped reply answered, ready to edit and send again. */
const Retry = createContext<((messageId: string) => void) | undefined>(undefined);
/** Runs Summarize, offered when a Mediator turn stopped before its report. */
const SumUp = createContext<(() => void) | undefined>(undefined);
/** The pond's folder, so changed files show as paths inside it. */
const Workspace = createContext<string | undefined>(undefined);
type NotesTarget = { notes: string; add: (text: string) => Promise<void> };
/** The conversation's notes, and the pond's when it has one, so reports can be added to them. */
const Notes = createContext<{ conversation?: NotesTarget; pond?: NotesTarget }>({});

/** The transcript: your messages, single replies, and grouped reply rounds. */
export const ConversationMessages = memo(function ConversationMessages({
  messages,
  ducks,
  notes,
  onRetry,
  onSumUp,
  onAddToNotes,
  pondNotes,
  workspace,
}: {
  messages: Message[];
  ducks: Duck[];
  notes: string;
  workspace?: string;
  onRetry?: (messageId: string) => void;
  onSumUp?: () => void;
  onAddToNotes: (text: string) => Promise<void>;
  pondNotes?: NotesTarget;
}) {
  const entries = messages
    .filter((message) => message.duckId)
    .map((message) => [message.duckId!, message.speaker]);
  for (const duck of ducks)
    entries.push([duck.id, duck.name], [mentionHandle(duck, ducks), duck.name]);
  const signature = JSON.stringify(Object.fromEntries(entries));
  const names = useMemo<Record<string, string>>(() => JSON.parse(signature), [signature]);
  const colors = useMemo(() => rosterColors(ducks), [ducks]);
  const pondText = pondNotes?.notes;
  const addToPond = pondNotes?.add;
  const notesValue = useMemo(
    () => ({
      conversation: { notes, add: onAddToNotes },
      pond: addToPond && { notes: pondText ?? "", add: addToPond },
    }),
    [notes, onAddToNotes, pondText, addToPond],
  );
  const groups = groupMessages(messages);
  // A stopped Summarize is retried as it is; only other stopped Mediator turns offer Summarize.
  const asked = groups.map(
    (_, index) =>
      groups.slice(0, index).findLast((group) => group.kind === "message" && !group.message.duckId)
        ?.id,
  );
  const summaries = new Set(
    messages.filter((message) => message.text === summaryRequest).map((message) => message.id),
  );
  return (
    <Workspace.Provider value={workspace}>
      <Notes.Provider value={notesValue}>
        <Retry.Provider value={onRetry}>
          <SumUp.Provider value={onSumUp}>
            <DuckColors.Provider value={colors}>
              <DuckNames.Provider value={names}>
                {groups.map((group, index) =>
                  group.kind === "message" ? (
                    <ChatMessage
                      key={group.id}
                      message={group.message}
                      canSumUp={!summaries.has(asked[index] ?? "")}
                      roundChanges={isReport(group) ? roundChanges(groups[index - 1]) : undefined}
                    />
                  ) : (
                    <ReplyRound
                      key={group.id}
                      messages={group.messages}
                      reported={isReport(groups[index + 1])}
                    />
                  ),
                )}
              </DuckNames.Provider>
            </DuckColors.Provider>
          </SumUp.Provider>
        </Retry.Provider>
      </Notes.Provider>
    </Workspace.Provider>
  );
});

/** Every file the replies in a round changed, for Mediator's report on that round. */
function roundChanges(group?: ReturnType<typeof groupMessages>[number]) {
  const changes = group?.kind === "round" ? group.messages.flatMap((m) => m.changes ?? []) : [];
  return changes.length ? changes : undefined;
}

const pastVerbs: Record<string, string> = {
  running: "ran",
  reading: "read",
  editing: "edited",
  searching: "searched",
  using: "used",
  delegating: "delegated",
  planning: "planned",
  drawing: "drew",
  coordinating: "coordinated",
  working: "worked",
};
/** Finished steps read as done: "running wc -l" becomes "ran wc -l". */
function pastTense(label: string) {
  const [verb, ...rest] = label.split(" ");
  return [pastVerbs[verb] ?? verb, ...rest].join(" ");
}

/** Whether a group is Mediator's finished report, which sums up the round before it. */
function isReport(group?: ReturnType<typeof groupMessages>[number]) {
  return (
    group?.kind === "message" &&
    group.message.phase === "guide" &&
    group.message.status === "complete"
  );
}

/**
 * Folds to one line once every duck finished and Mediator reported on the round. Direct replies,
 * and rounds that are running, failed, or stopped, stay open.
 */
function ReplyRound({ messages, reported }: { messages: Message[]; reported: boolean }) {
  // Rounds Mediator reported on start folded; direct replies and Each separately's answers, which
  // are what you asked for, start open. Show or Hide flips that once the round has finished.
  const [flipped, setFlipped] = useState(false);
  // Mediator's handoffs sit in the round but aren't replies, so the counts leave them out.
  const replies = messages.filter((message) => !isHost(message));
  const working = unique(replies.filter((message) => message.status === "thinking"));
  const unfinished = replies.filter(
    (message) => message.status === "error" || message.status === "stopped",
  ).length;
  const hostWorking = messages.some((message) => isHost(message) && message.status === "thinking");
  const replied = `${replies.length - working.length - unfinished} of ${replies.length} replied`;
  const spoke = messages.filter((message) => message.status === "complete");
  const passed = messages.filter((message) => message.status === "passed");
  const settled = spoke.length + passed.length === messages.length;
  const startsOpen = !reported || messages[0].phase === "review";
  const open = !settled || startsOpen !== flipped;
  const speakers = unique(spoke).filter((message) => !isHost(message));
  const colors = useContext(DuckColors);
  const section = useRef<HTMLElement>(null);
  return (
    <section
      ref={section}
      className={`reply-round ${open ? "open" : ""}`}
      aria-label="Duck replies"
    >
      <button
        type="button"
        className="round-heading"
        aria-expanded={open}
        disabled={!settled}
        onClick={() => setFlipped(!flipped)}
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
                reported,
              )
            : working.length
              ? `${listNames(working.map((message) => message.speaker))} ${working.length === 1 ? "is" : "are"} still working · ${replied}`
              : hostWorking
                ? replies.length
                  ? `Mediator is weighing the replies · ${replied}`
                  : "Mediator is choosing who answers"
                : unfinished
                  ? `${unfinished} ${unfinished === 1 ? "reply" : "replies"} didn't finish`
                  : "Mediator didn't finish"}
        </span>
        {settled && (
          <span className="round-toggle">
            {open ? "Hide" : "Show"} <ChevronDown size={14} />
          </span>
        )}
      </button>
      {open && (
        <div className="round-replies">
          {reported && messages[0].phase === "review" && (
            <button
              type="button"
              className="text-button round-jump"
              onClick={() =>
                section.current?.nextElementSibling?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
            >
              <ArrowDown size={13} /> Jump to Mediator's summary
            </button>
          )}
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

function roundSummary(phase: Message["phase"], names: string[], passes: number, reported: boolean) {
  const passNote = passes ? ` · ${passes} passed` : "";
  if (!names.length)
    return passes
      ? `Nobody had anything to add${passNote}`
      : reported
        ? "Mediator answered directly"
        : "No replies";
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
      {message.phase === "review" && message.status === "complete" ? (
        <FoldedText message={message} />
      ) : (
        <MessageText message={message} />
      )}
      {!!message.changes?.length && <ChangedFiles changes={message.changes} />}
    </article>
  );
});

/**
 * An independent answer shows its opening, which leads with the duck's answer, so several can be
 * compared side by side. "Show all" opens the rest of that one answer.
 */
function FoldedText({ message }: { message: Message }) {
  const [full, setFull] = useState(false);
  const blocks = message.text.trim().split(/\n\s*\n/);
  let shown = 1;
  while (shown < blocks.length && blocks.slice(0, shown).join("\n\n").length < 160) shown++;
  const hidden = blocks.length - shown;
  if (!hidden) return <MessageText message={message} />;
  return (
    <>
      <MessageText
        message={full ? message : { ...message, text: blocks.slice(0, shown).join("\n\n") }}
      />
      <button type="button" className="text-button show-more" onClick={() => setFull(!full)}>
        {full
          ? "Show less"
          : `Show all, ${hidden} more ${hidden === 1 ? "paragraph" : "paragraphs"}`}
      </button>
    </>
  );
}

/**
 * Mediator's instructions to a duck, folded to one line: they explain the process, not the
 * answer, so they stay out of the way until asked for.
 */
function HandoffLine({ message }: { message: Message }) {
  const names = useContext(DuckNames);
  const [open, setOpen] = useState(false);
  const [, handle, rest] = message.text.match(/^@([\w-]+):?\s*([\s\S]*)$/) ?? [];
  const who = handle ? (names[handle] ?? handle) : undefined;
  const summary = (rest ?? message.text)
    .split(/(?<=[.!?])\s|\n/)[0]
    .replace(/@([\w-]+)/g, (mention, id: string) => names[id] ?? mention);
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

function MessageHeading({
  message,
  color,
  canSumUp = false,
}: {
  message: Message;
  color: string;
  canSumUp?: boolean;
}) {
  const retry = useContext(Retry);
  const sumUp = useContext(SumUp);
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
      {message.phase === "review" && (
        <span className="message-meta">
          {message.status === "thinking" ? "answering independently" : "answered independently"}
        </span>
      )}
      {message.status === "thinking" && <LiveStatus message={message} />}
      {message.status === "stopped" && <span className="message-meta">stopped</span>}
      {message.status === "error" && <span className="message-meta error">failed</span>}
      {(message.status === "error" || message.status === "stopped") && retry && (
        <button type="button" className="text-button retry" onClick={() => retry(message.id)}>
          <RotateCcw size={13} />{" "}
          {isHost(message) ? "Edit and ask again" : `Edit and ask ${message.speaker} again`}
        </button>
      )}
      {(message.status === "error" || message.status === "stopped") &&
        // Mediator's own stopped turn, or a duck stopped mid-discussion before Mediator reported.
        (isHost(message) ? canSumUp : message.phase === "discussion") &&
        sumUp && (
          <button type="button" className="text-button retry" onClick={sumUp}>
            <ListChecks size={13} /> Summarize
          </button>
        )}
      {message.status !== "thinking" && !!message.tools?.length && (
        <details className="tool-log">
          <summary>
            {message.tools.length} {message.tools.length === 1 ? "step" : "steps"}
          </summary>
          <ul>
            {message.tools.map((tool) => (
              <li key={tool}>{pastTense(tool)}</li>
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

/** "To Mediator", "To each duck", or "To Skeptic and Simplifier" above a sent message. */
function Recipients({ to }: { to: string[] }) {
  const names = useContext(DuckNames);
  const label =
    to[0] === "everyone"
      ? "each duck"
      : listNames(to.map((id) => (id === "mediator" ? "Mediator" : (names[id] ?? id))));
  return <p className="recipients">To {label}</p>;
}

const ChatMessage = memo(function ChatMessage({
  message,
  canSumUp,
  roundChanges,
}: {
  message: Message;
  canSumUp: boolean;
  /** For Mediator's report: files the round it reports on changed. */
  roundChanges?: Message["changes"];
}) {
  const colors = useContext(DuckColors);
  if (!message.duckId && message.text === summaryRequest)
    return (
      <p data-scroll-anchor className="passed-line">
        You asked Mediator to summarize the conversation
      </p>
    );
  if (!message.duckId)
    return (
      <article data-scroll-anchor className="chat-message human-message">
        {message.to && <Recipients to={message.to} />}
        <MessageText message={message} />
      </article>
    );
  if (message.status === "passed") return <PassedLine message={message} />;
  return (
    <article
      data-scroll-anchor
      className={`chat-message duck-message ${message.phase === "guide" ? "host-message" : ""}`}
    >
      <MessageHeading
        message={message}
        color={speakerColor(colors, message.duckId)}
        canSumUp={canSumUp}
      />
      <MessageText message={message} />
      {!!(message.changes ?? roundChanges)?.length && (
        <ChangedFiles changes={(message.changes ?? roundChanges)!} />
      )}
      {message.phase === "guide" && message.status === "complete" && !!message.text && (
        <AddToNotes text={message.text} />
      )}
    </article>
  );
});

/** Files a reply changed. Each opens to the lines it removed and added. */
function ChangedFiles({ changes }: { changes: NonNullable<Message["changes"]> }) {
  const workspace = useContext(Workspace);
  return (
    <div className="changed-files">
      {changes.map((change) => (
        <details key={change.path}>
          <summary>
            <FileText size={13} aria-hidden /> Changed{" "}
            <code>
              {workspace && change.path.startsWith(`${workspace}/`)
                ? change.path.slice(workspace.length + 1)
                : change.path}
            </code>
          </summary>
          {change.diff && (
            <pre className="diff">
              <code>
                {change.diff.split("\n").map((line, index) => (
                  <span
                    key={index}
                    className={
                      /^\+(?!\+\+)/.test(line)
                        ? "added"
                        : /^-(?!--)/.test(line)
                          ? "removed"
                          : undefined
                    }
                  >
                    {line}
                    {"\n"}
                  </span>
                ))}
              </code>
            </pre>
          )}
        </details>
      ))}
    </div>
  );
}

/** Copies a Mediator report into this conversation's notes, or into the pond's. */
function AddToNotes({ text }: { text: string }) {
  const { conversation, pond } = useContext(Notes);
  if (!conversation) return null;
  return (
    <p className="message-action">
      <NoteButton target={conversation} text={text.trim()} label="notes" />
      {pond && <NoteButton target={pond} text={text.trim()} label="pond notes" />}
    </p>
  );
}

function NoteButton({ target, text, label }: { target: NotesTarget; text: string; label: string }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  if (target.notes.includes(text))
    return (
      <span className="done">
        <Check size={14} /> Saved to {label}
      </span>
    );
  return (
    <>
      <button
        type="button"
        className="text-button"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setFailed(false);
          target
            .add(text)
            .catch(() => setFailed(true))
            .finally(() => setSaving(false));
        }}
      >
        <Plus size={14} /> {saving ? "Adding…" : `Add to ${label}`}
      </button>
      {failed && <span className="message-meta error">Couldn't save. Try again.</span>}
    </>
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
