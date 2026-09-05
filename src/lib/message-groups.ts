import type { Message } from "./room";

type MessageGroup =
  | { kind: "message"; id: string; message: Message }
  | { kind: "round"; id: string; messages: Message[] };

/** Existing transcripts group by user turns too; no stored messages need rewriting. */
export function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let replies: Message[] = [];
  function flush() {
    if (!replies.length) return;
    const first = replies[0];
    groups.push(
      replies.length === 1 && first.phase === "conversation"
        ? { kind: "message", id: first.id, message: first }
        : { kind: "round", id: first.id, messages: replies },
    );
    replies = [];
  }
  for (const message of messages) {
    if (!message.duckId || message.phase === "guide") {
      flush();
      groups.push({ kind: "message", id: message.id, message });
    } else replies.push(message);
  }
  flush();
  return groups;
}
