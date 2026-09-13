import { OutfitGenerator } from "./outfit-generator";
import type { DuckSuggestion } from "../lib/suggestions";
import { SavedPermissions } from "./saved-permissions";
import { mentionHandle } from "../lib/mentions";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Lightbulb, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { loadModels, suggestDuck } from "../server/rooms.functions";
import { avatarSchema, duckAvatar, duckSchema, type Duck } from "../lib/room";
import { findModel, type ModelCatalog } from "../lib/models";
import { DuckAvatar } from "./duck-avatar";
import type { Pond } from "../lib/pond";

export function Settings({
  roomId,
  pondId,
  pond,
  ducks,
  notes: initialNotes,
  observe: initialObserve,
  saving,
  error,
  onSave,
  onClose,
}: {
  roomId?: string;
  pondId?: string;
  pond?: Pond;
  ducks: Duck[];
  notes: string;
  observe: boolean;
  saving: boolean;
  error: string;
  onSave: (settings: {
    ducks: Duck[];
    notes: string;
    observe: boolean;
    pondName?: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(structuredClone(ducks));
  const [pondName, setPondName] = useState(pond?.name ?? "");
  const [notes, setNotes] = useState(initialNotes);
  const [observe, setObserve] = useState(initialObserve);
  const [expanded, setExpanded] = useState<string | undefined>(ducks[0]?.id);
  const [catalogs, setCatalogs] = useState<Partial<Record<Duck["provider"], ModelCatalog>>>({});
  const [loading, setLoading] = useState(false);
  const [removed, setRemoved] = useState<{ duck: Duck; index: number }>();
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<DuckSuggestion>();
  const [creationMode, setCreationMode] = useState<"suggest" | "describe">("suggest");
  const [duckIdea, setDuckIdea] = useState("");
  const [persona, setPersona] = useState<Pick<Duck, "name" | "instructions">>();
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const previouslySuggestedNames = useRef<string[]>([]);
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
        data: {
          roomId,
          pondId: pond?.id ?? pondId,
          ducks: draft,
          notes: pond ? `Pond: ${pondName}` : notes,
          inspectWorkspace: !!pond && creationMode === "suggest",
          previouslySuggestedNames:
            creationMode === "suggest" ? previouslySuggestedNames.current : [],
          ...(creationMode === "describe" ? { idea: duckIdea.trim() } : {}),
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (creationMode === "describe") setPersona(result.suggestions[0]);
      else setSuggestion(result);
      setSelectedSuggestions([]);
      if (creationMode === "suggest")
        previouslySuggestedNames.current = [
          ...new Set([
            ...previouslySuggestedNames.current,
            ...result.suggestions.map((duck) => duck.name),
          ]),
        ].slice(-25);
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
  function addPersonas(chosen: Pick<Duck, "name" | "instructions">[]) {
    if (!chosen.length) return;
    const additions: Duck[] = chosen.map(({ name, instructions }) => ({
      id: `duck-${crypto.randomUUID().slice(0, 8)}`,
      name,
      instructions,
      provider: draft[0].provider,
      model: draft[0].model,
      reasoning: draft[0].reasoning,
      avatar: "base",
    }));
    setDraft((current) => [...current, ...additions]);
    setExpanded(additions[0].id);
  }
  function addSelectedSuggestions() {
    addPersonas(
      suggestion?.suggestions.filter((duck) => selectedSuggestions.includes(duck.name)) ?? [],
    );
    setSuggestion((current) =>
      current
        ? {
            ...current,
            suggestions: current.suggestions.filter(
              (duck) => !selectedSuggestions.includes(duck.name),
            ),
          }
        : current,
    );
    setSelectedSuggestions([]);
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
          void onSave({ ducks: draft, notes, observe, ...(pond ? { pondName } : {}) });
        }}
      >
        <div className="settings-heading">
          <div>
            <span className="eyebrow">{pond ? "POND DEFAULTS" : "MAKE THIS ROOM YOURS"}</span>
            <h2>{pond ? "Ducks for every new conversation." : "Your ducks, your mix."}</h2>
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
        {pond ? (
          <>
            <label>
              Pond name
              <input
                value={pondName}
                required
                maxLength={80}
                disabled={saving}
                onChange={(event) => setPondName(event.target.value)}
              />
            </label>
            <p className="settings-intro pond-workspace">{pond.workspace}</p>
            <p className="settings-intro">
              Defaults are saved in .duckpond/pond.json and .duckpond/ducks/*.md. Existing
              conversations keep their ducks. To use another workspace, create or open a pond there.
            </p>
          </>
        ) : (
          <p className="settings-intro">Give each duck a perspective, a model, and an outfit.</p>
        )}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="suggest-duck-controls">
          <div className="persona-mode" aria-label="Persona creation method">
            <button
              type="button"
              className="text-button"
              aria-pressed={creationMode === "suggest"}
              disabled={saving || suggesting}
              onClick={() => {
                setCreationMode("suggest");
                setSuggestionError("");
              }}
            >
              {pond ? "Workspace suggestions" : "Suggest a duck"}
            </button>
            <button
              type="button"
              className="text-button"
              aria-pressed={creationMode === "describe"}
              disabled={saving || suggesting}
              onClick={() => {
                setCreationMode("describe");
                setSuggestionError("");
              }}
            >
              Describe a duck
            </button>
          </div>
          {creationMode === "describe" && (
            <label>
              What kind of duck do you have in mind?
              <textarea
                rows={3}
                maxLength={2000}
                value={duckIdea}
                disabled={saving || suggesting}
                placeholder="A game designer who challenges realism when it makes the game boring..."
                onChange={(event) => setDuckIdea(event.target.value)}
              />
            </label>
          )}
          <button
            className="suggest-duck-button"
            type="button"
            disabled={saving || suggesting || (creationMode === "describe" && !duckIdea.trim())}
            onClick={() => void suggest()}
          >
            <Lightbulb size={16} />{" "}
            {suggesting
              ? pond && creationMode === "suggest"
                ? "Reading workspace and suggesting ducks..."
                : "Writing personas..."
              : creationMode === "describe"
                ? "Create persona"
                : pond
                  ? "Suggest ducks for this workspace"
                  : "Find suggestions"}
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
            {creationMode === "describe"
              ? "Describe an idea to get a name and full persona. Review it below before adding it."
              : pond
                ? "Reads this workspace's docs and code to suggest up to five useful ducks. Pick the ones you want, edit them below, then save the pond."
                : "GPT-5.6-Sol with Medium reasoning finds up to five different perspectives in one call. Pick the ducks you want, then save your changes."}
          </small>
        </div>
        {suggestionError && (
          <p className="error-banner" role="alert">
            {suggestionError}
          </p>
        )}
        {creationMode === "describe" && persona && (
          <section className="suggestion-options" aria-label="Generated persona">
            <label>
              Duck name
              <input
                value={persona.name}
                maxLength={32}
                disabled={saving || suggesting}
                onChange={(event) => setPersona({ ...persona, name: event.target.value })}
              />
            </label>
            <label>
              Persona instructions
              <textarea
                value={persona.instructions}
                rows={9}
                maxLength={4000}
                disabled={saving || suggesting}
                onChange={(event) => setPersona({ ...persona, instructions: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={
                saving || suggesting || !persona.name.trim() || !persona.instructions.trim()
              }
              onClick={() => {
                addPersonas([persona]);
                setPersona(undefined);
                setDuckIdea("");
              }}
            >
              {pond ? "Add to pond" : "Add to room"}
            </button>
            <small>Choose its model and outfit below. Save your changes to keep it.</small>
          </section>
        )}
        {creationMode === "suggest" && suggestion && (
          <section className="suggestion-options" aria-label="Suggested ducks">
            <p>{suggestion.reason}</p>
            {suggestion.suggestions.map((duck) => (
              <div className="suggestion-option" key={duck.name}>
                <label>
                  <input
                    type="checkbox"
                    disabled={saving || suggesting}
                    checked={selectedSuggestions.includes(duck.name)}
                    onChange={(event) =>
                      setSelectedSuggestions((current) =>
                        event.target.checked
                          ? [...current, duck.name]
                          : current.filter((name) => name !== duck.name),
                      )
                    }
                  />
                  <strong>{duck.name}</strong>
                </label>
                <p>{duck.reason}</p>
                <details>
                  <summary>Perspective</summary>
                  <p>{duck.instructions}</p>
                </details>
              </div>
            ))}
            {!!suggestion.suggestions.length && (
              <button
                type="button"
                className="primary-button"
                disabled={saving || suggesting || !selectedSuggestions.length}
                onClick={addSelectedSuggestions}
              >
                Add selected ({selectedSuggestions.length})
              </button>
            )}
            <small>Added ducks appear below. Save your changes to keep them.</small>
          </section>
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
                      if (open) setExpanded(draft.find((item) => item.id !== duck.id)?.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="duck-editor-fields" id={`edit-${duck.id}`} hidden={!open}>
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
                  {open &&
                    !pond &&
                    (roomId ? (
                      <OutfitGenerator
                        roomId={roomId}
                        duck={duck}
                        onUse={(avatar) => change(duck.id, { avatar })}
                      />
                    ) : (
                      <p className="mention-handle">Save the room before generating an outfit.</p>
                    ))}
                  <p className="mention-handle">
                    Mention with @{mentionHandle(duck, draft)}, or select {duck.name} from the @
                    picker.
                  </p>
                </div>
              </section>
            );
          })}
          {!pond && (
            <>
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
            </>
          )}
        </fieldset>
        {!pond && <SavedPermissions />}
        <div className="settings-actions">
          <button className="text-button" type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving || suggesting} type="submit">
            <Check size={15} /> {saving ? "Saving..." : pond ? "Save pond" : "Save room"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
