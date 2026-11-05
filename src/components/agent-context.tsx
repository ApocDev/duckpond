import { useEffect, useState } from "react";
import { loadContext } from "../server/rooms.functions";

/** Per-duck context window usage for one conversation, refreshed while open. */
export function AgentContext({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadContext>>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    async function refresh() {
      if (document.hidden) return;
      try {
        const value = await loadContext({ data: roomId });
        if (!disposed) {
          setRows(value);
          setError("");
        }
      } catch {
        if (!disposed) setError("Couldn't load context usage.");
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [roomId, open]);
  return (
    <details className="agent-context" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Context usage</summary>
      <p className="field-hint">
        How much of each duck's context window its last turn used. Compaction resets the estimate
        until the next turn.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {rows.map(({ id, name, context }) => (
        <p key={id}>
          <strong>{name}</strong>:{" "}
          {context?.inputTokens != null
            ? `${context.inputTokens.toLocaleString()} tokens${context.windowTokens ? ` / ${context.windowTokens.toLocaleString()} (${Math.round((context.inputTokens / context.windowTokens) * 100)}%)` : ""}`
            : "Not reported"}
          {!!context?.compactions && (
            <>
              <br />
              {context.compactions} compaction{context.compactions === 1 ? "" : "s"} recorded
            </>
          )}
          {context?.handoffAt && (
            <>
              <br />
              Archived history available to this session
            </>
          )}
        </p>
      ))}
    </details>
  );
}
