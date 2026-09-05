import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Lightbulb, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { loadModels, suggestDuck } from "../server/rooms.functions";
import { avatarSchema, duckAvatar, duckSchema, type Duck } from "../lib/room";
import { findModel, type ModelCatalog } from "../lib/models";
import { DuckAvatar } from "./duck-avatar";

export function Settings({
  roomId,
  ducks,
  notes: initialNotes,
  observe: initialObserve,
  saving,
  error,
  onSave,
  onClose,
}: {
  roomId?: string;
  ducks: Duck[];
  notes: string;
  observe: boolean;
  saving: boolean;
  error: string;
  onSave: (settings: { ducks: Duck[]; notes: string; observe: boolean }) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(ducks));
  const [notes, setNotes] = useState(initialNotes);
  const [observe, setObserve] = useState(initialObserve);
  const [expanded, setExpanded] = useState<string | undefined>(ducks[0]?.id);
  const [catalogs, setCatalogs] = useState<Partial<Record<Duck["provider"], ModelCatalog>>>({});
  const [loading, setLoading] = useState(false);
  const [removed, setRemoved] = useState<{ duck: Duck; index: number }>();
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ reason: string; duckId?: string }>();
  const [suggestionError, setSuggestionError] = useState("");
  const suggestionRequest = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => suggestionRequest.current?.abort();
  }, []);
  async function suggest() {
    if (suggestionRequest.current) return;
    const controller = new AbortController();
    suggestionRequest.current = controller;
    setSuggesting(true);
    setSuggestionError("");
    try {
      const result = await suggestDuck({
        data: { roomId, ducks: draft, notes },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.duck) {
        const id = `duck-${crypto.randomUUID().slice(0, 8)}`;
        const proposed: Duck = {
          ...result.duck,
          id,
          provider: "claude",
          model: "sonnet",
          reasoning: "",
          avatar: "base",
        };
        setDraft((current) => [...current, proposed]);
        setExpanded(id);
        setSuggestion({ reason: result.reason, duckId: id });
        requestAnimationFrame(() =>
          document.getElementById(`edit-${id}`)?.scrollIntoView({ block: "center" }),
        );
      } else setSuggestion({ reason: result.reason });
    } catch (cause) {
      if (!controller.signal.aborted)
        setSuggestionError(
          cause instanceof Error ? cause.message : "Couldn't suggest a duck. Try again.",
        );
    } finally {
      suggestionRequest.current = null;
      setSuggesting(false);
    }
  }
  async function refreshModels(refresh = false) {
    setLoading(true);
    await Promise.all(
      (["claude", "codex"] as const).map(async (provider) => {
        let catalog: ModelCatalog;
        try {
          catalog = await loadModels({ data: { provider, refresh } });
        } catch {
          catalog = {
            provider,
            models: [],
            error: `Couldn't reach ${provider}. Try refreshing models.`,
          };
        }
        setCatalogs((current) => ({ ...current, [provider]: catalog }));
      }),
    );
    setLoading(false);
  }
  useEffect(() => {
    void refreshModels();
  }, []);
  function change(id: string, update: Partial<Duck>) {
    setDraft((current) => current.map((duck) => (duck.id === id ? { ...duck, ...update } : duck)));
  }
  function addDuck() {
    const id = `duck-${crypto.randomUUID().slice(0, 8)}`;
    setDraft((current) => [
      ...current,
      {
        id,
        name: `Duck ${current.length + 1}`,
        provider: "claude",
        model: "",
        reasoning: "",
        avatar: "base",
        instructions:
          "Offer a useful perspective. Ask helpful questions and challenge assumptions when there is a concrete reason.",
      },
    ]);
    setExpanded(id);
  }
  return (
    <dialog
      className="settings-dialog"
      ref={dialog}
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (suggesting) return;
          void onSave({ ducks: draft, notes, observe });
        }}
      >
        <div className="settings-heading">
          <div>
            <span className="eyebrow">MAKE THIS ROOM YOURS</span>
            <h2>Your ducks, your mix.</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close settings"
          >
            <X size={20} />
          </button>
        </div>
        <p className="settings-intro">Give each duck a perspective, a model, and an outfit.</p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="suggest-duck-controls">
          <button
            className="suggest-duck-button"
            type="button"
            disabled={saving || suggesting}
            onClick={() => void suggest()}
          >
            <Lightbulb size={16} />{" "}
            {suggesting ? "Considering the conversation..." : "Suggest a duck"}
          </button>
          {suggesting && (
            <button
              type="button"
              className="text-button"
              onClick={() => suggestionRequest.current?.abort()}
            >
              Cancel suggestion
            </button>
          )}
          <small>
            GPT-5.6-Sol with Medium reasoning looks for a missing perspective. Review the suggestion
            before saving.
          </small>
        </div>
        {suggestionError && (
          <p className="error-banner" role="alert">
            {suggestionError}
          </p>
        )}
        {suggestion && !suggestion.duckId && (
          <p className="suggestion-reason" role="status">
            {suggestion.reason}
          </p>
        )}
        <fieldset className="settings-content" disabled={saving || suggesting}>
          <div className="roster-heading">
            <strong>
              {draft.length} {draft.length === 1 ? "duck" : "ducks"}
            </strong>
            <button type="button" className="primary-button" onClick={addDuck}>
              <Plus size={16} /> Add duck
            </button>
          </div>
          <div className="catalog-status">
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => void refreshModels(true)}
            >
              <RefreshCw size={13} /> {loading ? "Loading models..." : "Refresh models"}
            </button>
          </div>
          {Object.values(catalogs)
            .filter((catalog) => catalog.error)
            .map((catalog) => (
              <p key={catalog.provider} className="error-banner" role="status">
                {catalog.error}
              </p>
            ))}
          {removed && (
            <div className="removed-notice" role="status">
              <span>{removed.duck.name} removed. Earlier messages stay.</span>
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
            </div>
          )}
          {draft.map((duck, index) => {
            const catalog = catalogs[duck.provider];
            const model = findModel(catalog?.models ?? [], duck.model);
            const open = expanded === duck.id;
            return (
              <section
                className="duck-editor"
                key={duck.id}
                onInvalid={(event) => {
                  setExpanded(duck.id);
                  const field = event.target;
                  if (field instanceof HTMLElement) requestAnimationFrame(() => field.focus());
                }}
              >
                <div className="duck-editor-heading">
                  <button
                    className="duck-editor-toggle"
                    type="button"
                    aria-expanded={open}
                    aria-controls={`edit-${duck.id}`}
                    onClick={() => setExpanded(open ? undefined : duck.id)}
                  >
                    <DuckAvatar avatar={duckAvatar(duck)} />
                    <span>
                      <strong>{duck.name}</strong>
                      <small>
                        {model?.name ?? (duck.model || "Account default")}
                        {duck.reasoning ? ` · ${duck.reasoning}` : ""}
                      </small>
                    </span>
                    <ChevronDown size={16} />
                  </button>
                  <button
                    className="remove-duck"
                    type="button"
                    disabled={draft.length === 1}
                    title={draft.length === 1 ? "Keep at least one duck" : `Remove ${duck.name}`}
                    aria-label={`Remove ${duck.name}`}
                    onClick={() => {
                      setRemoved({ duck, index });
                      setDraft((current) => current.filter((item) => item.id !== duck.id));
                      if (suggestion?.duckId === duck.id) setSuggestion(undefined);
                      if (open) setExpanded(draft.find((item) => item.id !== duck.id)?.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="duck-editor-fields" id={`edit-${duck.id}`} hidden={!open}>
                  {suggestion?.duckId === duck.id && (
                    <div className="suggestion-reason" role="status">
                      <strong>Suggested duck</strong>
                      <p>{suggestion.reason}</p>
                      <small>
                        Edit any field below, then save the room to add this duck. Use Remove to
                        dismiss it.
                      </small>
                    </div>
                  )}
                  <div className="settings-row">
                    <label>
                      Name
                      <input
                        aria-label={`${duck.id} name`}
                        required
                        maxLength={32}
                        value={duck.name}
                        onChange={(event) => change(duck.id, { name: event.target.value })}
                      />
                    </label>
                    <label>
                      Provider
                      <select
                        aria-label={`${duck.name} provider`}
                        value={duck.provider}
                        onChange={(event) =>
                          change(duck.id, {
                            provider: duckSchema.shape.provider.parse(event.target.value),
                            model: "",
                            reasoning: "",
                          })
                        }
                      >
                        <option value="claude">Claude</option>
                        <option value="codex">Codex</option>
                      </select>
                    </label>
                    <label>
                      Model
                      <select
                        aria-label={`${duck.name} model`}
                        disabled={!catalog || !!catalog.error}
                        value={model?.id ?? duck.model}
                        onChange={(event) =>
                          change(duck.id, { model: event.target.value, reasoning: "" })
                        }
                      >
                        <option value="">Account default</option>
                        {duck.model && !model && (
                          <option value={duck.model}>{duck.model} · saved selection</option>
                        )}
                        {catalog?.models.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reasoning
                      <select
                        aria-label={`${duck.name} reasoning`}
                        value={duck.reasoning ?? ""}
                        disabled={!model?.reasoning.length}
                        onChange={(event) => change(duck.id, { reasoning: event.target.value })}
                      >
                        <option value="">
                          {model?.defaultReasoning
                            ? `Default · ${model.defaultReasoning}`
                            : "Default"}
                        </option>
                        {duck.reasoning && !model?.reasoning.includes(duck.reasoning) && (
                          <option value={duck.reasoning}>{duck.reasoning} · saved selection</option>
                        )}
                        {model?.reasoning.map((level) => (
                          <option key={level} value={level}>
                            {level.charAt(0).toUpperCase() + level.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {model?.description && <p className="model-description">{model.description}</p>}
                  {model && !model.reasoning.length && (
                    <p className="model-description">
                      This model does not offer reasoning settings.
                    </p>
                  )}
                  {!duck.model && (
                    <p className="model-description">Choose a model to set its reasoning level.</p>
                  )}
                  <label>
                    Perspective
                    <textarea
                      aria-label={`${duck.name} perspective`}
                      required
                      maxLength={4000}
                      rows={3}
                      value={duck.instructions}
                      onChange={(event) => change(duck.id, { instructions: event.target.value })}
                    />
                  </label>
                  <div className="outfit-heading">Outfit</div>
                  <div className="outfit-options" role="group" aria-label={`${duck.name} outfit`}>
                    {avatarSchema.options.map((avatar) => (
                      <button
                        key={avatar}
                        type="button"
                        aria-label={`${duck.name}: ${avatar} outfit`}
                        aria-pressed={duckAvatar(duck) === avatar}
                        onClick={() => change(duck.id, { avatar })}
                      >
                        <DuckAvatar avatar={avatar} />
                        <span>{avatar}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mention-handle">
                    Mention with @{duck.id}, or select {duck.name} from the @ picker.
                  </p>
                </div>
              </section>
            );
          })}
          <label className="observer-setting">
            <input
              type="checkbox"
              checked={observe}
              onChange={(event) => setObserve(event.target.checked)}
            />
            <span>
              <strong>Let observers join in</strong>
              <small>
                Other ducks may add a useful point after a reply. These checks use your
                subscriptions.
              </small>
            </span>
          </label>
          <label>
            Shared notes
            <textarea
              rows={4}
              value={notes}
              maxLength={20000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What should everyone keep in mind?"
            />
          </label>
        </fieldset>
        <div className="settings-actions">
          <button className="text-button" type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || suggesting} type="submit">
            <Check size={15} /> {saving ? "Saving..." : "Save room"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
