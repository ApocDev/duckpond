import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { loadModels, type connections } from "../server/rooms.functions";
import { Dialog } from "./dialog";
import { SavedPermissions } from "./saved-permissions";

type Connection = Awaited<ReturnType<typeof connections>>[number];

/** Machine-wide settings: provider sign-in status and saved command permissions. */
export function AppSettings({ status, onClose }: { status: Connection[]; onClose: () => void }) {
  const [models, setModels] = useState<"idle" | "loading" | "done" | "failed">("idle");
  async function refreshModels() {
    setModels("loading");
    const results = await Promise.allSettled(
      (["claude", "codex"] as const).map((provider) =>
        loadModels({ data: { provider, refresh: true } }),
      ),
    );
    setModels(
      results.every((result) => result.status === "fulfilled" && !result.value.error)
        ? "done"
        : "failed",
    );
  }
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
        <div className="row">
          <button
            type="button"
            className="secondary-button compact"
            disabled={models === "loading"}
            onClick={() => void refreshModels()}
          >
            <RefreshCw size={14} /> {models === "loading" ? "Refreshing…" : "Refresh model lists"}
          </button>
          <span className="field-hint" role="status">
            {models === "done"
              ? "Model lists are up to date."
              : models === "failed"
                ? "A provider didn't answer. Check its sign-in and try again."
                : "Lists refresh on their own every five minutes."}
          </span>
        </div>
      </section>
      <SavedPermissions />
    </Dialog>
  );
}
