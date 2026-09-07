import { useEffect, useState } from "react";
import { savedPermissions, revokePermission } from "../server/rooms.functions";

export function SavedPermissions() {
  const [permissions, setPermissions] = useState<Awaited<ReturnType<typeof savedPermissions>>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    void savedPermissions()
      .then(setPermissions)
      .catch(() => setError("Could not load saved permissions."));
  }, []);
  async function revoke(id: string) {
    setBusy(id);
    setError("");
    try {
      await revokePermission({ data: id });
      setPermissions((items) => items.filter((item) => item.id !== id));
    } catch {
      setError("Could not revoke this permission. Try again.");
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <details className="saved-permissions">
      <summary>Saved command permissions ({permissions.length})</summary>
      <p>
        Permissions apply to all ducks using that provider in the listed project. Revoking affects
        future requests, not commands already running.
      </p>
      {error && <p role="alert">{error}</p>}
      {!permissions.length && <p>No commands are always allowed.</p>}
      {permissions.map((permission) => (
        <div className="saved-permission" key={permission.id}>
          <strong>{permission.provider === "codex" ? "Codex" : "Claude"}</strong>
          <code>{permission.command}</code>
          <small>{permission.cwd}</small>
          <button
            type="button"
            className="text-button"
            disabled={!!busy}
            onClick={() => revoke(permission.id)}
          >
            {busy === permission.id ? "Revoking..." : "Revoke"}
          </button>
        </div>
      ))}
    </details>
  );
}
