import Markdown from "react-markdown";
import { ChevronDown } from "lucide-react";
import { duckAvatar, type Message } from "../lib/room";
import { groupMessages } from "../lib/message-groups";
import { DuckAvatar } from "./duck-avatar";

export function ConversationMessages({ messages }: { messages: Message[] }) {
  return groupMessages(messages).map((group) =>
    group.kind === "message" ? (
      <ChatMessage key={group.id} message={group.message} />
    ) : (
      <ReplyRound key={group.id} messages={group.messages} />
    ),
  );
}

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
        <details className="duck-reply" key={message.id}>
          <summary data-scroll-anchor>
            <DuckAvatar
              avatar={duckAvatar({ id: message.duckId!, avatar: message.avatar })}
              small
            />
            <span className="reply-author">
              <strong>{message.speaker}</strong>
              {message.phase !== "conversation" && (
                <span className="reply-phase">{message.phase}</span>
              )}
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
          <div data-scroll-anchor className="reply-content">
            <MessageText message={message} />
          </div>
        </details>
      ))}
    </section>
  );
}

function ChatMessage({ message }: { message: Message }) {
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
}

function MessageText({ message }: { message: Message }) {
  return (
    <div className={`message-text ${message.status === "error" ? "message-error" : ""}`}>
      {message.text ? (
        <Markdown>{message.text}</Markdown>
      ) : (
        <span className="thinking-text">
          {message.status === "thinking" ? "Thinking..." : "Reply stopped."}
        </span>
      )}
    </div>
  );
}
