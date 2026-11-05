import { createContext, useContext, useMemo, memo, useState } from "react";
import { MessageMarkdown } from "./message-markdown";
import { ChevronDown } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { groupMessages } from "../lib/message-groups";
import { mentionHandle } from "../lib/mentions";
import { duckColor } from "../lib/duck-colors";
import { DuckAvatar } from "./duck-avatar";

const DuckNames = createContext<Record<string, string>>({});
const RoomDucks = createContext<Duck[]>([]);

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
  return (
    <RoomDucks.Provider value={ducks}>
      <DuckNames.Provider value={names}>
        {groupMessages(messages).map((group) =>
          group.kind === "message" ? (
            <ChatMessage key={group.id} message={group.message} />
          ) : (
            <ReplyRound key={group.id} messages={group.messages} />
          ),
        )}
      </DuckNames.Provider>
    </RoomDucks.Provider>
  );
});

/** One line once every reply completed; running, failed, or stopped rounds stay expanded. */
function ReplyRound({ messages }: { messages: Message[] }) {
  const [expanded, setExpanded] = useState(false);
  const thinking = messages.filter((message) => message.status === "thinking").length;
  const complete = messages.filter((message) => message.status === "complete").length;
  const incomplete = messages.length - thinking - complete;
  const settled = complete === messages.length;
  const speakers = [...new Map(messages.map((message) => [message.duckId, message])).values()];
  return (
    <section className={`reply-round ${settled ? "settled" : ""}`} aria-label="Duck replies">
      <button
        type="button"
        className="round-heading"
        aria-expanded={!settled || expanded}
        disabled={!settled}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="round-avatars">
          {speakers.slice(0, 4).map((message) => (
            <DuckAvatar
              key={message.duckId}
              avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })}
            />
          ))}
        </span>
        <span>
          {settled
            ? roundSummary(
                messages[0].phase,
                speakers.map((message) => message.speaker),
              )
            : `${complete} of ${messages.length} replied${incomplete ? ` · ${incomplete} incomplete` : ""}`}
        </span>
        {settled && <span className="round-toggle">{expanded ? "Hide" : "Show"}</span>}
      </button>
      {(!settled || expanded) &&
        messages.map((message) => <ReplyDetails key={message.id} message={message} />)}
    </section>
  );
}

function roundSummary(phase: Message["phase"], names: string[]) {
  if (phase === "review")
    return `${names.length} independent ${names.length === 1 ? "reply" : "replies"}`;
  const who =
    names.length <= 2
      ? names.join(" and ")
      : names.length === 3
        ? `${names[0]}, ${names[1]} and ${names[2]}`
        : `${names[0]}, ${names[1]} and ${names.length - 2} others`;
  if (phase === "discussion") return `${who} discussed this`;
  return phase === "observer" ? `${who} added to this` : `${who} replied`;
}

const ReplyDetails = memo(function ReplyDetails({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const ducks = useContext(RoomDucks);
  return (
    <details className="duck-reply" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary data-scroll-anchor>
        <DuckAvatar avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })} />
        <span className="reply-author">
          <strong style={{ color: duckColor(ducks, message.duckId!) }}>{message.speaker}</strong>
          {message.phase !== "conversation" && <span className="reply-phase">{message.phase}</span>}
        </span>
        <span className={`reply-status ${message.status}`}>
          {message.status === "thinking"
            ? "Thinking"
            : message.status === "complete"
              ? "Read reply"
              : message.status === "error"
                ? "Failed"
                : "Stopped"}
        </span>
        <ChevronDown size={14} />
      </summary>
      {open && (
        <div data-scroll-anchor className="reply-content">
          <MessageText message={message} />
        </div>
      )}
    </details>
  );
});

const ChatMessage = memo(function ChatMessage({ message }: { message: Message }) {
  const human = !message.duckId;
  const ducks = useContext(RoomDucks);
  return (
    <article
      data-scroll-anchor
      className={`chat-message ${human ? "human-message" : ""} ${message.phase === "guide" ? "guide-message" : ""}`}
    >
      {human ? (
        <span className="avatar human">J</span>
      ) : (
        <DuckAvatar avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })} />
      )}
      <div className="message-body">
        <div className="message-heading">
          <strong style={human ? undefined : { color: duckColor(ducks, message.duckId!) }}>
            {message.speaker}
          </strong>
          {message.phase === "guide" && message.model ? (
            <span>{[message.model, message.reasoning].filter(Boolean).join(" · ")}</span>
          ) : (
            message.provider && <span>{message.provider === "claude" ? "Claude" : "Codex"}</span>
          )}
          {message.phase !== "conversation" && message.phase !== "guide" && (
            <span className="phase-label">{message.phase}</span>
          )}
          {message.status === "stopped" && <span>Stopped</span>}
        </div>
        <MessageText message={message} />
      </div>
    </article>
  );
});

function MessageText({ message }: { message: Message }) {
  const names = useContext(DuckNames);
  const text = message.text.replace(/@([\w-]+)/g, (match, id: string) =>
    names[id] ? `@${names[id].replace(/[\\`*_[\]]/g, "\\$&")}` : match,
  );
  const assignment = message.duckId === "mediator" && text.includes("\nAction ID:");
  return (
    <div className={`message-text ${message.status === "error" ? "message-error" : ""}`}>
      {message.text ? (
        assignment ? (
          <>
            <MessageMarkdown complete={message.status === "complete"}>
              {text.split(/\.\s|\n/)[0]}
            </MessageMarkdown>
            <details>
              <summary>Full assignment</summary>
              <MessageMarkdown complete={message.status === "complete"}>{text}</MessageMarkdown>
            </details>
          </>
        ) : (
          <MessageMarkdown complete={message.status === "complete"}>{text}</MessageMarkdown>
        )
      ) : (
        <span className="thinking-text">
          {message.status === "thinking" ? "Thinking..." : "Reply stopped."}
        </span>
      )}
    </div>
  );
}
