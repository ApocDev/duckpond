import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
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
  const { catalogs, loading, refresh } = useModelCatalogs();
  const colors = useMemo(() => rosterColors(draft), [draft]);
  const roomId = scope.kind === "conversation" ? scope.roomId : undefined;
  const room = scope.kind === "conversation" ? scope.room : undefined;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(ducks) ||
    (scope.kind === "pond" && pondName !== scope.pond.name);
  // Whether this conversation's ducks match what its pond starts new conversations with.
  const pondDucks = scope.kind === "conversation" ? scope.pond?.ducks : undefined;
  const savedDiffers = !!pondDucks && personas(ducks) !== personas(pondDucks);
  const draftDiffers = !!pondDucks && personas(draft) !== personas(pondDucks);
  function close() {
    if (dirty && !saving) setConfirming(true);
    else onClose();
  }
  return (
    <Dialog
      title={scope.kind === "pond" ? `${scope.pond.name} settings` : "Ducks in this conversation"}
      description={
        scope.kind === "pond"
          ? "New conversations in this pond start with these ducks. Existing conversations keep their own."
          : !scope.pond
            ? "Changes here affect only this conversation."
            : savedDiffers
              ? `These ducks differ from the ${scope.pond.name} defaults. Changes here affect only this conversation.`
              : `Same as the ${scope.pond.name} defaults. Changes here affect only this conversation.`
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
              <span className="footer-note">View only until the replies finish.</span>
            ) : (
              dirty && <span className="footer-note">Unsaved changes</span>
            )}
            <span className="spacer" />
            <button type="button" className="text-button" disabled={saving} onClick={close}>
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && scope.kind === "conversation" && scope.pond && (
              <button
                type="submit"
                form="duck-settings"
                value="defaults"
                className="secondary-button"
                title={`Saves these ducks here and makes them the starting ducks for new ${scope.pond.name} conversations`}
                disabled={saving || !draftDiffers}
              >
                Save as pond defaults too
              </button>
            )}
            {!readOnly && (
              <button
                type="submit"
                form="duck-settings"
                className="primary-button"
                disabled={saving || !dirty}
              >
                {saving
                  ? "Saving…"
                  : scope.kind === "pond"
                    ? "Save pond defaults"
                    : "Save for this conversation"}
              </button>
            )}
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
          const submitter =
            event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null;
          const pondDefaults =
            submitter instanceof HTMLButtonElement && submitter.value === "defaults";
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
            disabled={readOnly}
            onClick={() => setAdding(!adding)}
          >
            <Plus size={15} /> Add a duck
            <ChevronDown size={14} className="disclosure" aria-hidden />
          </button>
        </div>
        <p className="host-line">
          <DuckAvatar avatar="wizard" small color={hostColor} />
          <span>
            Plus <strong>Mediator</strong>, the host · {modelLabel(guide.model, guide.reasoning)}
          </span>
        </p>
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
              <span>{catalog.error}</span>
              <button
                type="button"
                className="text-button"
                disabled={loading}
                onClick={() => void refresh(true)}
              >
                <RefreshCw size={13} /> {loading ? "Retrying…" : "Retry"}
              </button>
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
          {draft.map((duck, index) => (
            <DuckEditor
              key={duck.id}
              duck={duck}
              ducks={draft}
              color={colors.get(duck.id)!}
              catalog={catalogs[duck.provider]}
              open={open === duck.id}
              roomId={roomId}
              readOnly={readOnly}
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
        {roomId && <AgentContext roomId={roomId} />}
      </form>
    </Dialog>
  );
}

/** Compares rosters by what each duck is, ignoring ids. */
function personas(ducks: Duck[]) {
  return JSON.stringify(
    ducks.map(({ name, instructions, provider, model, reasoning, avatar }) => [
      name,
      instructions,
      provider,
      model,
      reasoning,
      avatar,
    ]),
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
            error: `Couldn't load ${provider === "claude" ? "Claude" : "Codex"} models.`,
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
