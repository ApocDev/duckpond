import { createContext, useContext, useMemo, memo, useState } from "react";
import { MessageMarkdown } from "./message-markdown";
import { ChevronDown } from "lucide-react";
import { duckAvatar, type Duck, type Message } from "../lib/room";
import { groupMessages } from "../lib/message-groups";
import { mentionHandle } from "../lib/mentions";
import { DuckAvatar } from "./duck-avatar";

const DuckNames = createContext<Record<string, string>>({});

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
    <DuckNames.Provider value={names}>
      {groupMessages(messages).map((group) =>
        group.kind === "message" ? (
          <ChatMessage key={group.id} message={group.message} />
        ) : (
          <ReplyRound key={group.id} messages={group.messages} />
        ),
      )}
    </DuckNames.Provider>
  );
});

function ReplyRound({ messages }: { messages: Message[] }) {
  const thinking = messages.filter((message) => message.status === "thinking").length;
  const complete = messages.filter((message) => message.status === "complete").length;
  const incomplete = messages.length - thinking - complete;
  return (
    <section className="reply-round" aria-label="Duck replies">
      <div className="round-heading">
        Duck replies · {complete} complete{thinking > 0 && ` · ${thinking} thinking`}
        {incomplete > 0 && ` · ${incomplete} incomplete`}
      </div>
      {messages.map((message) => (
        <ReplyDetails key={message.id} message={message} />
      ))}
    </section>
  );
}

const ReplyDetails = memo(function ReplyDetails({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="duck-reply" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary data-scroll-anchor>
        <DuckAvatar avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })} />
        <span className="reply-author">
          <strong>{message.speaker}</strong>
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
          <strong>{message.speaker}</strong>
          {message.phase === "guide" ? (
            <span>Sol 5.6 · Medium</span>
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
