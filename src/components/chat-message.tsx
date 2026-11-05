import { createContext, useContext, useMemo, memo, useState } from "react";
import { MessageMarkdown } from "./message-markdown";
import { ChevronDown } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { groupMessages } from "../lib/message-groups";
import { mentionHandle } from "../lib/mentions";
import { rosterColors, speakerColor } from "../lib/duck-colors";
import { DuckAvatar } from "./duck-avatar";

const DuckNames = createContext<Record<string, string>>({});
const DuckColors = createContext(new Map<string, string>());

/** The transcript: your messages, single replies, and grouped reply rounds. */
export const ConversationMessages = memo(function ConversationMessages({
  messages,
  ducks,
}: {
  messages: Message[];
  ducks: Duck[];
}) {
  const entries = messages
    .filter((message) => message.duckId)
    .map((message) => [message.duckId!, message.speaker]);
  for (const duck of ducks)
    entries.push([duck.id, duck.name], [mentionHandle(duck, ducks), duck.name]);
  const signature = JSON.stringify(Object.fromEntries(entries));
  const names = useMemo<Record<string, string>>(() => JSON.parse(signature), [signature]);
  const colors = useMemo(() => rosterColors(ducks), [ducks]);
  return (
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
  );
});

/** One line once every reply finished; a running or interrupted round stays open. */
function ReplyRound({ messages }: { messages: Message[] }) {
  const [expanded, setExpanded] = useState(false);
  const thinking = messages.filter((message) => message.status === "thinking").length;
  const spoke = messages.filter((message) => message.status === "complete");
  const passed = messages.filter((message) => message.status === "passed");
  const settled = spoke.length + passed.length === messages.length;
  const open = !settled || expanded;
  const speakers = unique(spoke);
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
          {unique(messages)
            .slice(0, 4)
            .map((message) => (
              <DuckAvatar
                key={message.duckId}
                avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })}
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
            : `${messages.length - thinking} of ${messages.length} done`}
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

function unique(messages: Message[]) {
  return [...new Map(messages.map((message) => [message.duckId, message])).values()];
}

function roundSummary(phase: Message["phase"], names: string[], passes: number) {
  const passNote = passes ? ` · ${passes} passed` : "";
  if (!names.length) return `Nobody had anything to add${passNote}`;
  if (phase === "review")
    return `${names.length} independent ${names.length === 1 ? "reply" : "replies"}${passNote}`;
  const who =
    names.length <= 2
      ? names.join(" and ")
      : names.length === 3
        ? `${names[0]}, ${names[1]} and ${names[2]}`
        : `${names[0]}, ${names[1]} and ${names.length - 2} others`;
  return `${who} ${phase === "discussion" ? "discussed this" : "replied"}${passNote}`;
}

const RoundReply = memo(function RoundReply({ message }: { message: Message }) {
  const color = speakerColor(useContext(DuckColors), message.duckId!);
  if (message.status === "passed") return <PassedLine message={message} />;
  return (
    <article data-scroll-anchor className="round-reply" style={{ borderColor: color }}>
      <MessageHeading message={message} color={color} />
      <MessageText message={message} />
    </article>
  );
});

function PassedLine({ message }: { message: Message }) {
  return (
    <p data-scroll-anchor className="passed-line">
      <DuckAvatar avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })} small />
      {message.speaker} had nothing to add
    </p>
  );
}

function MessageHeading({ message, color }: { message: Message; color: string }) {
  return (
    <div className="message-heading">
      <DuckAvatar avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })} small />
      <strong style={{ color }}>{message.speaker}</strong>
      {message.phase === "review" && <span className="message-meta">independent</span>}
      {message.phase === "guide" && message.model && (
        <span className="message-meta">
          {[message.model, message.reasoning].filter(Boolean).join(" · ")}
        </span>
      )}
      {message.status === "thinking" && <span className="message-meta live">thinking</span>}
      {message.status === "stopped" && <span className="message-meta">stopped</span>}
      {message.status === "error" && <span className="message-meta error">failed</span>}
    </div>
  );
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
    </article>
  );
});

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
          {message.status === "thinking" ? "Thinking…" : "No reply."}
        </span>
      )}
    </div>
  );
}
