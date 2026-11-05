import { useEffect, useRef, useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { combineDucks, duckAvatar, type Duck, type DuckGroup } from "../lib/room";
import type { DuckSuggestion } from "../lib/suggestions";
import { reusableDucks, suggestDuck } from "../server/rooms.functions";
import { DuckAvatar } from "./duck-avatar";

type Method = "suggest" | "describe" | "reuse" | "blank";
type Persona = Pick<Duck, "name" | "instructions">;

/**
 * Ways to add ducks to a roster draft: AI suggestions from the conversation or workspace, a
 * persona written from a description, copies of ducks from other conversations, or a blank duck.
 */
export function AddDucks({
  ducks,
  roomId,
  pondId,
  notes,
  workspace,
  hasContext,
  onAdd,
}: {
  ducks: Duck[];
  roomId?: string;
  pondId?: string;
  notes: string;
  /** Suggest from the pond's files instead of the conversation. */
  workspace: boolean;
  /** Suggestions read the conversation or notes, so they need one of them first. */
  hasContext: boolean;
  onAdd: (ducks: Duck[]) => void;
}) {
  const [method, setMethod] = useState<Method>(hasContext ? "suggest" : "describe");
  return (
    <section className="add-ducks" aria-label="Add a duck">
      <div className="add-ducks-heading">
        <div className="segmented" role="tablist" aria-label="How to add a duck">
          {(
            [
              ["suggest", "Suggest"],
              ["describe", "Describe"],
              ["reuse", "Reuse"],
              ["blank", "Blank"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={method === value}
              onClick={() => setMethod(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {method === "suggest" && (
        <Suggest
          ducks={ducks}
          roomId={roomId}
          pondId={pondId}
          notes={notes}
          workspace={workspace}
          hasContext={hasContext}
          onAdd={(personas) => onAdd(personas.map((persona) => fromPersona(persona, ducks)))}
        />
      )}
      {method === "describe" && (
        <Describe
          ducks={ducks}
          roomId={roomId}
          pondId={pondId}
          notes={notes}
          onAdd={(persona) => onAdd([fromPersona(persona, ducks)])}
        />
      )}
      {method === "reuse" && <Reuse ducks={ducks} onAdd={onAdd} />}
      {method === "blank" && (
        <div className="add-ducks-body">
          <p className="field-hint">Start from an empty persona and write it yourself.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              onAdd([
                fromPersona(
                  {
                    name: `Duck ${ducks.length + 1}`,
                    instructions:
                      "Offer a useful perspective. Ask helpful questions and challenge assumptions when there is a concrete reason.",
                  },
                  ducks,
                ),
              ])
            }
          >
            <Plus size={15} /> Add a blank duck
          </button>
        </div>
      )}
    </section>
  );
}

/** New personas start with the first duck's model so they work without extra setup. */
function fromPersona({ name, instructions }: Persona, ducks: Duck[]): Duck {
  return {
    id: `duck-${crypto.randomUUID().slice(0, 8)}`,
    name,
    instructions,
    provider: ducks[0]?.provider ?? "claude",
    model: ducks[0]?.model ?? "",
    reasoning: ducks[0]?.reasoning ?? "",
    avatar: "base",
  };
}

/** Runs one suggestion request at a time and cancels it when the panel unmounts. */
function useSuggestion() {
  const request = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  async function run(data: Parameters<typeof suggestDuck>[0]["data"]) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setError("");
    try {
      return await suggestDuck({ data, signal: controller.signal });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Couldn't reach the suggestion model.");
    } finally {
      request.current = null;
      setRunning(false);
    }
  }
  return { run, running, error, cancel: () => request.current?.abort() };
}

function Suggest({
  ducks,
  roomId,
  pondId,
  notes,
  workspace,
  hasContext,
  onAdd,
}: {
  ducks: Duck[];
  roomId?: string;
  pondId?: string;
  notes: string;
  workspace: boolean;
  hasContext: boolean;
  onAdd: (personas: Persona[]) => void;
}) {
  const suggestion = useSuggestion();
  const [result, setResult] = useState<DuckSuggestion>();
  const [chosen, setChosen] = useState<string[]>([]);
  const seen = useRef<string[]>([]);
  async function suggest() {
    const value = await suggestion.run({
      roomId: workspace ? undefined : roomId,
      pondId,
      ducks,
      notes,
      inspectWorkspace: workspace,
      previouslySuggestedNames: seen.current,
    });
    if (!value) return;
    seen.current = [...new Set([...seen.current, ...value.suggestions.map((d) => d.name)])].slice(
      -25,
    );
    setResult(value);
    setChosen([]);
  }
  return (
    <div className="add-ducks-body">
      <p className="field-hint">
        {workspace
          ? "Reads this pond's docs and code and proposes up to five ducks that would help here."
          : hasContext
            ? "Reads this conversation and its notes and proposes up to five perspectives it's missing."
            : "Suggestions read the conversation, so there's nothing to go on yet. Send a message or add notes first, or use Describe."}
      </p>
      <div className="row">
        <button
          type="button"
          className="secondary-button"
          disabled={suggestion.running || !hasContext}
          onClick={() => void suggest()}
        >
          <Lightbulb size={15} />
          {suggestion.running
            ? workspace
              ? "Reading the workspace…"
              : "Thinking of ducks…"
            : result
              ? "Suggest more"
              : "Suggest ducks"}
        </button>
        {suggestion.running && (
          <button type="button" className="text-button" onClick={suggestion.cancel}>
            Cancel
          </button>
        )}
      </div>
      {suggestion.error && <p className="field-error">{suggestion.error}</p>}
      {result && (
        <div className="choice-list">
          <p className="field-hint">{result.reason}</p>
          {result.suggestions.map((duck) => (
            <label className="choice" key={duck.name}>
              <input
                type="checkbox"
                checked={chosen.includes(duck.name)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked
                      ? [...current, duck.name]
                      : current.filter((name) => name !== duck.name),
                  )
                }
              />
              <span>
                <strong>{duck.name}</strong>
                <small>{duck.reason}</small>
              </span>
            </label>
          ))}
          {!!result.suggestions.length && (
            <button
              type="button"
              className="secondary-button"
              disabled={!chosen.length}
              onClick={() => {
                onAdd(result.suggestions.filter((duck) => chosen.includes(duck.name)));
                setResult({
                  ...result,
                  suggestions: result.suggestions.filter((duck) => !chosen.includes(duck.name)),
                });
                setChosen([]);
              }}
            >
              <Plus size={15} /> Add {chosen.length || ""} selected
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Describe({
  ducks,
  roomId,
  pondId,
  notes,
  onAdd,
}: {
  ducks: Duck[];
  roomId?: string;
  pondId?: string;
  notes: string;
  onAdd: (persona: Persona) => void;
}) {
  const suggestion = useSuggestion();
  const [idea, setIdea] = useState("");
  const [persona, setPersona] = useState<Persona>();
  async function write() {
    const value = await suggestion.run({ roomId, pondId, ducks, notes, idea: idea.trim() });
    if (value?.suggestions[0]) setPersona(value.suggestions[0]);
  }
  return (
    <div className="add-ducks-body">
      <label className="field">
        <span>Describe the duck you want</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={idea}
          placeholder="A game designer who pushes back when realism makes the game boring"
          onChange={(event) => setIdea(event.target.value)}
        />
      </label>
      <div className="row">
        <button
          type="button"
          className="secondary-button"
          disabled={suggestion.running || !idea.trim()}
          onClick={() => void write()}
        >
          <Lightbulb size={15} /> {suggestion.running ? "Writing the persona…" : "Write persona"}
        </button>
        {suggestion.running && (
          <button type="button" className="text-button" onClick={suggestion.cancel}>
            Cancel
          </button>
        )}
      </div>
      {suggestion.error && <p className="field-error">{suggestion.error}</p>}
      {persona && (
        <div className="choice-list">
          <label className="field">
            <span>Name</span>
            <input
              value={persona.name}
              maxLength={32}
              onChange={(event) => setPersona({ ...persona, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Perspective</span>
            <textarea
              rows={6}
              maxLength={4000}
              value={persona.instructions}
              onChange={(event) => setPersona({ ...persona, instructions: event.target.value })}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={!persona.name.trim() || !persona.instructions.trim()}
            onClick={() => {
              onAdd(persona);
              setPersona(undefined);
              setIdea("");
            }}
          >
            <Plus size={15} /> Add {persona.name}
          </button>
        </div>
      )}
    </div>
  );
}

function Reuse({ ducks, onAdd }: { ducks: Duck[]; onAdd: (ducks: Duck[]) => void }) {
  const [groups, setGroups] = useState<DuckGroup[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    reusableDucks()
      .then((value) => !disposed && setGroups(value))
      .catch(() => !disposed && setError("Couldn't load ducks from other conversations."));
    return () => {
      disposed = true;
    };
  }, []);
  const query = search.trim().toLowerCase();
  const matching = (groups ?? [])
    .map((group) => ({
      ...group,
      ducks: group.title.toLowerCase().includes(query)
        ? group.ducks
        : group.ducks.filter((duck) => duck.name.toLowerCase().includes(query)),
    }))
    .filter((group) => group.ducks.length);
  const picked = matching.flatMap((group) =>
    group.ducks.filter((duck) => selected.includes(`${group.id}/${duck.id}`)),
  );
  return (
    <div className="add-ducks-body">
      <input
        className="search"
        value={search}
        placeholder="Search ducks or conversations"
        onChange={(event) => setSearch(event.target.value)}
      />
      {error && <p className="field-error">{error}</p>}
      {!groups ? (
        <p className="field-hint">Loading…</p>
      ) : !matching.length ? (
        <p className="field-hint">
          {groups.length ? "No matching ducks." : "Ducks from other conversations appear here."}
        </p>
      ) : (
        <div className="choice-list">
          {matching.map((group) => {
            const keys = group.ducks.map((duck) => `${group.id}/${duck.id}`);
            const all = keys.every((key) => selected.includes(key));
            return (
              <div className="choice-group" key={group.id}>
                <div className="choice-group-heading">
                  <span>{group.title}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setSelected((current) =>
                        all
                          ? current.filter((key) => !keys.includes(key))
                          : [...new Set([...current, ...keys])],
                      )
                    }
                  >
                    {all ? "Clear" : "Select all"}
                  </button>
                </div>
                {group.ducks.map((duck) => {
                  const key = `${group.id}/${duck.id}`;
                  return (
                    <label className="choice" key={key}>
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, key]
                              : current.filter((item) => item !== key),
                          )
                        }
                      />
                      <DuckAvatar avatar={duckAvatar(duck)} small />
                      <span>
                        <strong>{duck.name}</strong>
                        <small>
                          {duck.provider === "claude" ? "Claude" : "Codex"} ·{" "}
                          {duck.model || "default model"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={!picked.length}
        onClick={() => {
          onAdd(combineDucks([...ducks, ...picked]).slice(ducks.length));
          setSelected([]);
        }}
      >
        <Plus size={15} /> Add {picked.length || ""} selected
      </button>
    </div>
  );
}
