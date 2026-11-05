import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { guide, type Duck, type Room } from "../lib/room";
import type { Pond } from "../lib/pond";
import { modelLabel, type ModelCatalog } from "../lib/models";
import { rosterColors, hostColor } from "../lib/duck-colors";
import { loadModels } from "../server/rooms.functions";
import { AddDucks } from "./add-ducks";
import { AgentContext } from "./agent-context";
import { Dialog } from "./dialog";
import { DuckAvatar } from "./duck-avatar";
import { DuckEditor } from "./duck-editor";

/**
 * Edits a roster: one conversation's ducks, or a pond's name and the ducks new conversations
 * start with. Changes apply on Save; closing with unsaved changes asks first. While replies run,
 * a conversation's ducks are view-only.
 */
export function DuckSettings({
  scope,
  ducks,
  readOnly = false,
  saving,
  error,
  onSave,
  onClose,
}: {
  scope:
    | { kind: "conversation"; roomId?: string; pond?: Pond; room?: Room }
    | { kind: "pond"; pond: Pond };
  ducks: Duck[];
  readOnly?: boolean;
  saving: boolean;
  error: string;
  /** `pondDefaults` also saves the roster as the pond's starting ducks. */
  onSave: (value: { ducks: Duck[]; pondName?: string; pondDefaults?: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(ducks));
  const [open, setOpen] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pondName, setPondName] = useState(scope.pond?.name ?? "");
  const [removed, setRemoved] = useState<{ duck: Duck; index: number }>();
  const [pondDefaults, setPondDefaults] = useState(false);
  const { catalogs, loading, refresh } = useModelCatalogs();
  const colors = useMemo(() => rosterColors(draft), [draft]);
  const roomId = scope.kind === "conversation" ? scope.roomId : undefined;
  const room = scope.kind === "conversation" ? scope.room : undefined;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(ducks) ||
    (scope.kind === "pond" && pondName !== scope.pond.name);
  function close() {
    if (dirty && !saving) setConfirming(true);
    else onClose();
  }
  return (
    <Dialog
      title={scope.kind === "pond" ? `${scope.pond.name} settings` : "Ducks in this conversation"}
      description={
        scope.kind === "pond" ? (
          <>
            <span className="tag">Defaults for {scope.pond.name}</span> New conversations in this
            pond start with these ducks. Existing conversations keep their own.
          </>
        ) : (
          <>
            <span className="tag">This conversation only</span> New conversations keep starting with
            the {scope.pond ? `${scope.pond.name} ` : ""}defaults.
          </>
        )
      }
      busy={saving}
      wide
      onClose={close}
      footer={
        confirming ? (
          <>
            <span className="footer-note">Discard your unsaved changes?</span>
            <span className="spacer" />
            <button type="button" className="text-button" onClick={() => setConfirming(false)}>
              Keep editing
            </button>
            <button type="button" className="primary-button danger" onClick={onClose}>
              Discard
            </button>
          </>
        ) : (
          <>
            {readOnly ? (
              <span className="footer-note">Stop the replies to change ducks.</span>
            ) : (
              scope.kind === "conversation" &&
              scope.pond && (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={pondDefaults}
                    onChange={(event) => setPondDefaults(event.target.checked)}
                  />
                  Also make these the {scope.pond.name} defaults
                </label>
              )
            )}
            {dirty && !readOnly && <span className="footer-note">Unsaved changes</span>}
            <span className="spacer" />
            <button type="button" className="text-button" disabled={saving} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              form="duck-settings"
              className="primary-button"
              disabled={saving || readOnly || !(dirty || pondDefaults)}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <form
        id="duck-settings"
        className="duck-settings"
        onSubmit={(event) => {
          event.preventDefault();
          if (readOnly) return;
          void onSave({
            ducks: draft,
            ...(scope.kind === "pond" ? { pondName } : { pondDefaults }),
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
              Folder: {scope.pond.workspace}. Settings are saved in its .duckpond/ folder, so you
              can commit them.
            </small>
          </label>
        )}
        <div className="section-heading">
          <h3>
            {draft.length} {draft.length === 1 ? "duck" : "ducks"}
          </h3>
          <button
            type="button"
            className="secondary-button compact"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            {adding ? <X size={15} /> : <Plus size={15} />} {adding ? "Close" : "Add a duck"}
          </button>
        </div>
        {adding && (
          <AddDucks
            ducks={draft}
            roomId={roomId}
            pondId={scope.pond?.id}
            notes={room?.notes ?? `Pond: ${pondName}`}
            workspace={scope.kind === "pond"}
            hasContext={scope.kind === "pond" || !!room?.messages.length || !!room?.notes.trim()}
            onAdd={(added) => {
              if (!added.length) return;
              setDraft((current) => [...current, ...added]);
              setOpen(added[0].id);
              setAdding(false);
            }}
          />
        )}
        {Object.values(catalogs)
          .filter((catalog) => catalog.error)
          .map((catalog) => (
            <p key={catalog.provider} className="banner error" role="status">
              {catalog.error}
            </p>
          ))}
        {removed && (
          <p className="banner" role="status">
            <span>{removed.duck.name} removed.</span>
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
          <div className="host-row">
            <DuckAvatar avatar="wizard" />
            <span>
              <strong style={{ color: hostColor }}>Mediator</strong>
              <small>
                Hosts every conversation and picks who answers ·{" "}
                {modelLabel(guide.model, guide.reasoning)}
              </small>
            </span>
            <span className="tag">Always here</span>
          </div>
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
        <button
          type="button"
          className="text-button quiet-action"
          disabled={loading}
          onClick={() => void refresh(true)}
        >
          <RefreshCw size={13} />{" "}
          {loading ? "Loading models…" : "Missing a model? Refresh the list"}
        </button>
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
