import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Duck } from "../lib/room";
import type { Pond } from "../lib/pond";
import type { ModelCatalog } from "../lib/models";
import { rosterColors } from "../lib/duck-colors";
import { loadModels } from "../server/rooms.functions";
import { AddDucks } from "./add-ducks";
import { AgentContext } from "./agent-context";
import { Dialog } from "./dialog";
import { DuckEditor } from "./duck-editor";

export type DuckSettingsSave = { ducks: Duck[]; pondName?: string; asPondDefaults?: boolean };

/**
 * Edits a roster: either one conversation's ducks, or a pond's default ducks for new
 * conversations. Changes apply on Save.
 */
export function DuckSettings({
  scope,
  ducks,
  saving,
  error,
  onSave,
  onClose,
}: {
  scope:
    | { kind: "conversation"; roomId?: string; pond?: Pond; notes: string }
    | { kind: "pond"; pond: Pond };
  ducks: Duck[];
  saving: boolean;
  error: string;
  onSave: (value: DuckSettingsSave) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(ducks));
  const [open, setOpen] = useState<string>();
  const [pondName, setPondName] = useState(scope.pond?.name ?? "");
  const [asPondDefaults, setAsPondDefaults] = useState(false);
  const [removed, setRemoved] = useState<{ duck: Duck; index: number }>();
  const { catalogs, loading, refresh } = useModelCatalogs();
  const colors = useMemo(() => rosterColors(draft), [draft]);
  const roomId = scope.kind === "conversation" ? scope.roomId : undefined;
  const title =
    scope.kind === "pond" ? `${scope.pond.name} defaults` : "Ducks in this conversation";
  const description =
    scope.kind === "pond"
      ? "New conversations in this pond start with these ducks. Existing conversations keep their own."
      : "Changes affect only this conversation. Earlier messages stay as they are.";
  return (
    <Dialog
      title={title}
      description={description}
      busy={saving}
      wide
      onClose={onClose}
      footer={
        <>
          {scope.kind === "conversation" && scope.pond && (
            <label className="check">
              <input
                type="checkbox"
                checked={asPondDefaults}
                onChange={(event) => setAsPondDefaults(event.target.checked)}
              />
              Also use as {scope.pond.name} defaults
            </label>
          )}
          <span className="spacer" />
          <button type="button" className="text-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="duck-settings" className="primary-button" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form
        id="duck-settings"
        className="duck-settings"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({
            ducks: draft,
            ...(scope.kind === "pond" ? { pondName } : {}),
            asPondDefaults,
          });
        }}
      >
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        {scope.kind === "pond" && (
          <label className="field">
            <span>Pond name</span>
            <input
              value={pondName}
              required
              maxLength={80}
              onChange={(event) => setPondName(event.target.value)}
            />
            <small>
              {scope.pond.workspace}. Saved in .duckpond/ in that folder, so you can commit it.
            </small>
          </label>
        )}
        <div className="section-heading">
          <strong>
            {draft.length} {draft.length === 1 ? "duck" : "ducks"}
          </strong>
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => void refresh(true)}
          >
            <RefreshCw size={13} /> {loading ? "Loading models…" : "Refresh models"}
          </button>
        </div>
        {Object.values(catalogs)
          .filter((catalog) => catalog.error)
          .map((catalog) => (
            <p key={catalog.provider} className="banner error" role="status">
              {catalog.error}
            </p>
          ))}
        {removed && (
          <p className="banner" role="status">
            {removed.duck.name} removed.
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setDraft((current) => current.toSpliced(removed.index, 0, removed.duck));
                setRemoved(undefined);
              }}
            >
              Undo
            </button>
          </p>
        )}
        <div className="duck-list">
          {draft.map((duck, index) => (
            <DuckEditor
              key={duck.id}
              duck={duck}
              ducks={draft}
              color={colors.get(duck.id)!}
              catalog={catalogs[duck.provider]}
              open={open === duck.id}
              roomId={roomId}
              canRemove={draft.length > 1}
              onToggle={() => setOpen(open === duck.id ? undefined : duck.id)}
              onChange={(update) =>
                setDraft((current) =>
                  current.map((item) => (item.id === duck.id ? { ...item, ...update } : item)),
                )
              }
              onRemove={() => {
                setRemoved({ duck, index });
                setDraft((current) => current.filter((item) => item.id !== duck.id));
              }}
            />
          ))}
        </div>
        <AddDucks
          ducks={draft}
          roomId={roomId}
          pondId={scope.pond?.id}
          notes={scope.kind === "conversation" ? scope.notes : `Pond: ${pondName}`}
          workspace={scope.kind === "pond"}
          onAdd={(added) => {
            if (!added.length) return;
            setDraft((current) => [...current, ...added]);
            setOpen(added[0].id);
          }}
        />
        {roomId && <AgentContext roomId={roomId} />}
      </form>
    </Dialog>
  );
}

/** Model lists for both providers, loaded once per dialog. */
function useModelCatalogs() {
  const [catalogs, setCatalogs] = useState<Partial<Record<Duck["provider"], ModelCatalog>>>({});
  const [loading, setLoading] = useState(false);
  async function refresh(force = false) {
    setLoading(true);
    await Promise.all(
      (["claude", "codex"] as const).map(async (provider) => {
        const catalog = await loadModels({ data: { provider, refresh: force } }).catch(
          (): ModelCatalog => ({
            provider,
            models: [],
            error: `Couldn't reach ${provider === "claude" ? "Claude" : "Codex"}. Try refreshing models.`,
          }),
        );
        setCatalogs((current) => ({ ...current, [provider]: catalog }));
      }),
    );
    setLoading(false);
  }
  useEffect(() => {
    void refresh();
  }, []);
  return { catalogs, loading, refresh };
}
