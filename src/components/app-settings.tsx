import type { connections } from "../server/rooms.functions";
import { Dialog } from "./dialog";
import { SavedPermissions } from "./saved-permissions";

type Connection = Awaited<ReturnType<typeof connections>>[number];

/** Machine-wide settings: provider sign-in status and saved command permissions. */
export function AppSettings({ status, onClose }: { status: Connection[]; onClose: () => void }) {
  return (
    <Dialog title="Settings" onClose={onClose}>
      <section className="settings-section">
        <h3>Providers</h3>
        <p className="field-hint">
          Ducks run on your Claude and Codex subscriptions through their command-line tools on this
          machine. Sign in with each tool directly; Duckpond stores no API keys.
        </p>
        {(["claude", "codex"] as const).map((provider) => {
          const connection = status.find((item) => item.provider === provider);
          return (
            <div className="connection-row" key={provider}>
              <span className={`status-dot ${connection?.connected ? "connected" : ""}`} />
              <strong>{provider === "claude" ? "Claude" : "Codex"}</strong>
              <span className="muted">
                {!connection
                  ? "Checking…"
                  : connection.connected
                    ? "Signed in"
                    : `Sign-in needed: run ${provider} in a terminal`}
              </span>
            </div>
          );
        })}
      </section>
      <SavedPermissions />
    </Dialog>
  );
}
