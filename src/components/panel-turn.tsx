import { useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { DuckAvatar } from "./duck-avatar";
import { MessageMarkdown } from "./message-markdown";
import { clock, useNow } from "./chat-message";
import {
  bodyOf,
  positionOf,
  stanceOf,
  type Brief,
  type Decision,
  type PanelDuck,
  type Reply,
  type Research,
  type Turn,
} from "../lib/panel";

export type Ducks = Map<string, PanelDuck>;
const nameOf = (ducks: Ducks, id: string) => ducks.get(id)?.name ?? id;

function Avatar({ ducks, id, small = false }: { ducks: Ducks; id: string; small?: boolean }) {
  return <DuckAvatar avatar={ducks.get(id)?.avatar ?? "base"} small={small} />;
}

function Stack({ ducks, ids }: { ducks: Ducks; ids: string[] }) {
  return (
    <span className="pn-stack" title={ids.map((id) => nameOf(ducks, id)).join(", ")}>
      {ids.map((id) => (
        <Avatar key={id} ducks={ducks} id={id} small />
      ))}
    </span>
  );
}

const stanceLabel = { changed: "Changed", disagree: "Disagrees", nothing: "Nothing to add" };
const totalCost = (turn: Turn) =>
  turn.rounds.flat().reduce((sum, reply) => sum + reply.cost, 0) + turn.briefCost;

/** One turn: your message, then a direct reply, plain panel replies, or a brief with its board. */
export function TurnView({
  turn,
  ducks,
  decision,
  latest,
  onDecide,
  onLookUp,
}: {
  turn: Turn;
  ducks: Ducks;
  decision: Decision | undefined;
  latest: boolean;
  onDecide: (text: string) => Promise<void>;
  onLookUp: (question: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(!decision);
  const answers = turn.rounds[0]?.filter((reply) => reply.status === "done") ?? [];
  const passes = turn.rounds[0]?.filter((reply) => reply.status === "passed") ?? [];
  const debated = turn.to === "panel" && turn.rounds.length > 1;

  if (decision && !open)
    return (
      <div className="pn-turn">
        <div className="pn-folded">
          <Stack ducks={ducks} ids={turn.rounds[0]?.map((reply) => reply.duckId) ?? []} />
          <div className="pn-folded-text">
            <strong>{turn.text.split("\n")[0]}</strong>
            <span>{turn.brief?.headline ?? `${answers.length} replied`}</span>
          </div>
          <button type="button" className="secondary-button compact" onClick={() => setOpen(true)}>
            Open
          </button>
        </div>
        <Decided text={decision.text} />
      </div>
    );

  return (
    <div className="pn-turn">
      <div className="pn-you">
        <div className="pn-meta">
          You · to {turn.to === "panel" ? "the panel" : nameOf(ducks, turn.to)}
          {decision && (
            <button type="button" className="text-button" onClick={() => setOpen(false)}>
              Fold
            </button>
          )}
        </div>
        <div className="pn-you-text">{turn.text}</div>
      </div>

      {!debated &&
        turn.rounds[0]?.map((reply) =>
          reply.status === "passed" ? null : (
            <DuckReply
              key={reply.duckId}
              reply={reply}
              ducks={ducks}
              decided={!!decision}
              onDecide={onDecide}
            />
          ),
        )}
      {!debated && passes.length > 0 && (
        <div className="pn-passes">
          <Stack ducks={ducks} ids={passes.map((reply) => reply.duckId)} />
          {passes.length === 1 ? "1 duck had" : `${passes.length} ducks had`} nothing to add
        </div>
      )}

      {debated && turn.brief && (
        <BriefView
          turn={turn}
          brief={turn.brief}
          ducks={ducks}
          decision={decision}
          onDecide={onDecide}
          onLookUp={onLookUp}
        />
      )}
      {debated && !turn.brief && (
        <div className="pn-progress">
          {turn.status === "running"
            ? turn.rounds.length > 1 &&
              turn.rounds.at(-1)!.every((reply) => reply.status !== "thinking")
              ? "Mediator is writing the brief…"
              : `Round ${turn.rounds.length} · ${turn.rounds.at(-1)!.filter((reply) => reply.status !== "thinking").length} of ${turn.rounds.at(-1)!.length} replied`
            : "No brief for this question."}
        </div>
      )}
      {debated && <Board turn={turn} ducks={ducks} startOpen={latest || !turn.brief} />}
      {turn.status === "running" && turn.rounds.length <= 1 && turn.to === "panel" && (
        <div className="pn-progress">
          {turn.rounds[0]
            ? `Round 1, answering blind · ${turn.rounds[0].filter((reply) => reply.status !== "thinking").length} of ${turn.rounds[0].length} replied`
            : "Starting…"}
        </div>
      )}
      {turn.error && <p className="field-error">{turn.error}</p>}
      {turn.status === "stopped" && <p className="pn-note">Stopped.</p>}
      {decision && <Decided text={decision.text} />}
    </div>
  );
}

function Decided({ text }: { text: string }) {
  return (
    <div className="pn-decided">
      <b>Decided</b>
      <span>{text}</span>
    </div>
  );
}

function DuckReply({
  reply,
  ducks,
  decided,
  onDecide,
}: {
  reply: Reply;
  ducks: Ducks;
  decided: boolean;
  onDecide: (text: string) => Promise<void>;
}) {
  const [deciding, setDeciding] = useState(false);
  return (
    <div className="pn-reply">
      <Avatar ducks={ducks} id={reply.duckId} />
      <div className="pn-bubble">
        <div className="pn-meta">
          <strong>{nameOf(ducks, reply.duckId)}</strong>
          <span>{reply.model}</span>
        </div>
        {reply.status === "thinking" ? (
          <p className="pn-note">Thinking…</p>
        ) : reply.status === "error" ? (
          <p className="field-error">{reply.text}</p>
        ) : reply.status === "stopped" ? (
          <p className="pn-note">Stopped.</p>
        ) : (
          <div className="pn-body">
            <MessageMarkdown>{reply.text}</MessageMarkdown>
          </div>
        )}
        {reply.status === "done" &&
          !decided &&
          (deciding ? (
            <DecideBox onDecide={onDecide} onCancel={() => setDeciding(false)} />
          ) : (
            <button type="button" className="text-button" onClick={() => setDeciding(true)}>
              Save a decision
            </button>
          ))}
      </div>
    </div>
  );
}

function DecideBox({
  onDecide,
  onCancel,
}: {
  onDecide: (text: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="pn-decide">
      <label htmlFor="decision">Your decision</label>
      <textarea
        id="decision"
        rows={2}
        value={text}
        placeholder="Write it in your own words…"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="row">
        <button
          type="button"
          className="primary-button compact"
          disabled={!text.trim() || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onDecide(text.trim());
            } finally {
              setSaving(false);
            }
          }}
        >
          Save decision
        </button>
        {onCancel && (
          <button type="button" className="text-button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <span className="pn-note">Every duck reads your decisions from now on.</span>
      </div>
    </div>
  );
}

function Sides({ ducks, sides }: { ducks: Ducks; sides: Brief["facts"][number]["sides"] }) {
  return (
    <div className="pn-sides">
      {sides.map((side, index) => (
        <div key={index} className="pn-side">
          <Stack ducks={ducks} ids={side.duckIds} />
          <span>
            <strong>{side.duckIds.map((id) => nameOf(ducks, id)).join(", ") || "Someone"}:</strong>{" "}
            {side.position}
          </span>
        </div>
      ))}
    </div>
  );
}

function BriefView({
  turn,
  brief,
  ducks,
  decision,
  onDecide,
  onLookUp,
}: {
  turn: Turn;
  brief: Brief;
  ducks: Ducks;
  decision: Decision | undefined;
  onDecide: (text: string) => Promise<void>;
  onLookUp: (question: string) => Promise<void>;
}) {
  const asked = new Set(turn.research.map((note) => note.question));
  return (
    <div className="pn-brief">
      <p className="pn-meta">
        The panel's brief · {turn.rounds[0].length} ducks · {turn.rounds.length} rounds · $
        {totalCost(turn).toFixed(3)}
      </p>
      <h3>{brief.headline}</h3>
      {brief.options.length > 0 && (
        <div className="pn-options">
          {brief.options.map((option, index) => (
            <div key={index} className={`pn-option ${index === 0 ? "lead" : ""}`}>
              <strong>{option.label}</strong>
              <div className="pn-option-who">
                <Stack ducks={ducks} ids={option.duckIds} />
                {option.duckIds.length === 1
                  ? nameOf(ducks, option.duckIds[0])
                  : `${option.duckIds.length} ducks`}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="pn-blocks">
        {brief.agreed.length > 0 && (
          <div className="pn-block">
            <h4>Everyone agrees</h4>
            <ul>
              {brief.agreed.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </div>
        )}
        {brief.facts.map((fact, index) => (
          <div key={index} className="pn-block">
            <h4>Fact in dispute</h4>
            <p>{fact.question}</p>
            <Sides ducks={ducks} sides={fact.sides} />
            {!asked.has(fact.question) && (
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => void onLookUp(fact.question)}
              >
                <Search size={14} /> Look this up
              </button>
            )}
          </div>
        ))}
      </div>
      {turn.research.map((note) => (
        <ResearchCard key={note.id} note={note} />
      ))}
      {(brief.values.length > 0 || brief.question) && (
        <div className="pn-block call">
          <h4>Your call</h4>
          {brief.values.map((value, index) => (
            <div key={index}>
              <p>{value.tradeoff}</p>
              <Sides ducks={ducks} sides={value.sides} />
            </div>
          ))}
          {brief.question && <div className="pn-ask">{brief.question}</div>}
        </div>
      )}
      {!decision && <DecideBox onDecide={onDecide} />}
    </div>
  );
}

function ResearchCard({ note }: { note: Research }) {
  const now = useNow();
  const end = note.finishedAt ? Date.parse(note.finishedAt) : now;
  const seconds = Math.round((end - Date.parse(note.startedAt)) / 1000);
  return (
    <div className={`pn-research ${note.status}`}>
      <div className="pn-meta">
        <Search size={14} />
        <strong>
          {note.status === "running"
            ? "Researching"
            : note.status === "done"
              ? "Research"
              : "Research failed"}
        </strong>
        <span>
          {clock(seconds)} · {note.steps.length} steps
        </span>
      </div>
      <p className="pn-research-q">{note.question}</p>
      {note.status === "running" ? (
        <p className="pn-note">{note.steps.at(-1) ?? "Starting…"}</p>
      ) : (
        <div className="pn-body">
          <MessageMarkdown>{note.text}</MessageMarkdown>
        </div>
      )}
    </div>
  );
}

/** Ducks by rounds, one line per reply. Click a cell to read the whole reply. */
function Board({ turn, ducks, startOpen }: { turn: Turn; ducks: Ducks; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [selected, setSelected] = useState<{ round: number; duckId: string }>();
  const rows = turn.rounds[0]
    .filter((reply) => reply.status !== "passed")
    .map((reply) => reply.duckId);
  const reply = selected
    ? turn.rounds[selected.round]?.find((item) => item.duckId === selected.duckId)
    : undefined;
  return (
    <div className="pn-how">
      <button type="button" className="pn-how-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        How they got there · {turn.rounds.length} {turn.rounds.length === 1 ? "round" : "rounds"}
        {turn.stopReason && <span className="pn-note">{turn.stopReason}</span>}
      </button>
      {open && (
        <>
          <div
            className="pn-board"
            style={{ "--rounds": turn.rounds.length } as React.CSSProperties}
          >
            <div className="pn-board-h">Duck</div>
            {turn.rounds.map((_, index) => (
              <div key={index} className="pn-board-h">
                Round {index + 1}
                {index === 0 ? " · blind" : ""}
              </div>
            ))}
            {rows.map((duckId) => (
              <BoardRow
                key={duckId}
                duckId={duckId}
                turn={turn}
                ducks={ducks}
                selected={selected}
                onSelect={setSelected}
              />
            ))}
          </div>
          {reply && selected && (
            <div className="pn-reader">
              <div className="pn-meta">
                <Avatar ducks={ducks} id={reply.duckId} small />
                <strong>{nameOf(ducks, reply.duckId)}</strong>
                <span>
                  Round {selected.round + 1} · {reply.model}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSelected(undefined)}
                >
                  Close
                </button>
              </div>
              <div className="pn-body">
                <MessageMarkdown>{reply.text || "No reply."}</MessageMarkdown>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BoardRow({
  duckId,
  turn,
  ducks,
  selected,
  onSelect,
}: {
  duckId: string;
  turn: Turn;
  ducks: Ducks;
  selected: { round: number; duckId: string } | undefined;
  onSelect: (cell: { round: number; duckId: string }) => void;
}) {
  return (
    <>
      <div className="pn-board-duck">
        <Avatar ducks={ducks} id={duckId} small />
        <span>{nameOf(ducks, duckId)}</span>
      </div>
      {turn.rounds.map((round, index) => {
        const reply = round.find((item) => item.duckId === duckId);
        const stance = reply && index > 0 ? stanceOf(reply.text) : undefined;
        const isSelected = selected?.round === index && selected.duckId === duckId;
        return (
          <button
            type="button"
            key={index}
            data-round={`Round ${index + 1}`}
            className={`pn-cell ${stance === "changed" ? "moved" : ""} ${isSelected ? "selected" : ""}`}
            disabled={!reply || reply.status === "thinking"}
            onClick={() => onSelect({ round: index, duckId })}
          >
            {!reply ? (
              <span className="pn-note">Not needed</span>
            ) : reply.status === "thinking" ? (
              <span className="pn-note">Thinking…</span>
            ) : reply.status !== "done" ? (
              <span className="pn-note">{reply.status === "error" ? "Error" : reply.status}</span>
            ) : (
              <>
                {stance && <span className={`pn-tag ${stance}`}>{stanceLabel[stance]}</span>}
                <span className="pn-cell-text">
                  {positionOf(reply.text) ?? bodyOf(reply.text).slice(0, 140)}
                </span>
              </>
            )}
          </button>
        );
      })}
    </>
  );
}
