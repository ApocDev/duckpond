import { useEffect, useState } from "react";
import { savedPermissions, revokePermission } from "../server/rooms.functions";

/** Commands a duck may run without asking again, with a way to revoke each one. */
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
    <section className="settings-section">
      <h3>Always-allowed commands</h3>
      <p className="field-hint">
        Saved when you choose "Always allow in this project" on an approval. They apply to every
        duck on that provider in that folder. Revoking affects future requests only.
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!permissions.length && <p className="muted">None yet.</p>}
      {permissions.map((permission) => (
        <div className="saved-permission" key={permission.id}>
          <div>
            <code>{permission.command}</code>
            <small>
              {permission.provider === "codex" ? "Codex" : "Claude"} · {permission.cwd}
            </small>
          </div>
          <button
            type="button"
            className="text-button"
            disabled={!!busy}
            onClick={() => revoke(permission.id)}
          >
            {busy === permission.id ? "Revoking…" : "Revoke"}
          </button>
        </div>
      ))}
    </section>
  );
}
