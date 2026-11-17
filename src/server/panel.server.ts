import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  briefSchema,
  directPrompt,
  duckSystem,
  firstRoundPrompt,
  historyFor,
  isPass,
  maxReactionRounds,
  mediatorPrompt,
  mediatorSystem,
  reactionPrompt,
  researchSystem,
  stanceOf,
  type Panel,
  type PanelDuck,
  type Reply,
} from "../lib/panel";
import { chat, claudeEnv } from "./gateway.server";
import { getPanel, listDucks, mutatePanel } from "./panel-store.server";
import { claudeExecutable } from "./providers.server";
import { dataDirectory } from "./store.server";

/** Running turns by panel ID, and running research jobs by research ID. */
export const activeTurns = new Map<string, AbortController>();
const activeResearch = new Map<string, AbortController>();
const mediatorModel = "claude-sonnet-5-5";
const researchTimeout = 15 * 60 * 1000;

type Ask = typeof chat;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function turnOf(panel: Panel, turnId: string) {
  const turn = panel.turns.find((item) => item.id === turnId);
  if (!turn) throw new Error("Turn not found");
  return turn;
}

/**
 * Runs one turn. A direct question gets one reply from one duck. A panel question gets a blind
 * round; if two or more ducks answer, they react to each other until a round where nobody changes
 * their mind (at most `maxReactionRounds`), then Mediator writes the brief, and its research
 * question, if any, starts a research job. Every reply is saved as it lands, so the page can poll.
 */
export async function runTurn(
  panelId: string,
  turnId: string,
  {
    ask = chat,
    research = startResearch,
  }: { ask?: Ask; research?: (panelId: string, turnId: string, question: string) => void } = {},
) {
  const controller = new AbortController();
  activeTurns.set(panelId, controller);
  const { signal } = controller;
  const update = (change: (turn: Panel["turns"][number]) => void) =>
    mutatePanel(panelId, (panel) => change(turnOf(panel, turnId)));
  try {
    const panel = getPanel(panelId);
    const index = panel.turns.findIndex((item) => item.id === turnId);
    const turn = panel.turns[index];
    const library = new Map(listDucks().map((duck) => [duck.id, duck]));
    const names = new Map(
      [...new Set([...panel.duckIds, turn.to])]
        .filter((id) => library.has(id))
        .map((id) => [id, library.get(id)!.name]),
    );
    const speakers = (turn.to === "panel" ? panel.duckIds : [turn.to]).flatMap(
      (id) => library.get(id) ?? [],
    );
    if (!speakers.length) throw new Error("None of these ducks are in the library anymore.");
    const history = (duck: PanelDuck) => historyFor(panel, duck.id, names, index);

    async function round(ducks: PanelDuck[], prompt: (duck: PanelDuck) => string) {
      let at = 0;
      update((turn) => {
        at = turn.rounds.length;
        turn.rounds.push(
          ducks.map((duck) => ({
            duckId: duck.id,
            status: "thinking",
            text: "",
            model: duck.model,
            cost: 0,
          })),
        );
      });
      return Promise.all(
        ducks.map(async (duck) => {
          let reply: Reply;
          try {
            const { text, cost } = await ask({
              model: duck.model,
              system: duckSystem(duck),
              prompt: prompt(duck),
              session: panelId,
              signal,
            });
            const passed = isPass(text);
            reply = {
              duckId: duck.id,
              model: duck.model,
              cost,
              text: passed ? "" : text,
              status: passed ? "passed" : "done",
            };
          } catch (error) {
            reply = {
              duckId: duck.id,
              model: duck.model,
              cost: 0,
              text: signal.aborted ? "" : message(error),
              status: signal.aborted ? "stopped" : "error",
            };
          }
          update((turn) => {
            const replies = turn.rounds[at];
            replies[replies.findIndex((item) => item.duckId === duck.id)] = reply;
          });
          return reply;
        }),
      );
    }

    if (turn.to !== "panel") {
      await round(speakers, (duck) => directPrompt(history(duck), turn.text));
    } else {
      const rounds = [await round(speakers, (duck) => firstRoundPrompt(history(duck), turn.text))];
      const answering = speakers.filter((_, i) => rounds[0][i].status === "done");
      let stopReason =
        answering.length === 0
          ? "Nobody had anything to add."
          : answering.length === 1
            ? "Only one duck had something to add."
            : `Stopped at the limit of ${maxReactionRounds} reaction rounds.`;
      if (answering.length > 1) {
        for (let n = 0; n < maxReactionRounds && !signal.aborted; n++) {
          const reactions = await round(answering, (duck) =>
            reactionPrompt(history(duck), turn.text, rounds, names),
          );
          rounds.push(reactions);
          // More talk won't help once a round passes with nobody changing their mind.
          if (
            !reactions.some(
              (reply) => reply.status === "done" && stanceOf(reply.text) === "changed",
            )
          ) {
            stopReason = `Stopped after round ${rounds.length}: nobody changed their mind.`;
            break;
          }
        }
        if (!signal.aborted) {
          try {
            const summary = await ask({
              model: mediatorModel,
              system: mediatorSystem,
              prompt: mediatorPrompt(panel, turn.text, rounds, names),
              session: panelId,
              signal,
              json: { name: "brief", schema: briefSchema },
            });
            const brief = briefSchema.parse(JSON.parse(summary.text));
            // Mediator may name a duck that isn't on the panel; drop those instead of showing a stranger.
            const known = (ids: string[]) => ids.filter((id) => names.has(id));
            for (const option of brief.options) option.duckIds = known(option.duckIds);
            for (const item of [...brief.facts, ...brief.values])
              for (const side of item.sides) side.duckIds = known(side.duckIds);
            update((turn) => {
              turn.brief = brief;
              turn.briefCost = summary.cost;
            });
            if (brief.research) research(panelId, turnId, brief.research);
          } catch (error) {
            if (!signal.aborted)
              update((turn) => {
                turn.error = `Mediator's summary failed: ${message(error)}`;
              });
          }
        }
      }
      update((turn) => {
        turn.stopReason = stopReason;
      });
    }
    update((turn) => {
      turn.status = signal.aborted ? "stopped" : "done";
    });
  } catch (error) {
    update((turn) => {
      turn.status = signal.aborted ? "stopped" : "error";
      if (!signal.aborted) turn.error = message(error);
    });
  } finally {
    activeTurns.delete(panelId);
  }
}

/** A short label for one research step, shown while the job runs. */
function stepLabel(tool: string, input: Record<string, unknown>, cwd: string) {
  const value = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  if (tool === "WebSearch") return `Searched: ${value("query")}`;
  if (tool === "WebFetch")
    return `Read ${value("url")
      .replace(/^https?:\/\//, "")
      .slice(0, 80)}`;
  if (tool === "Read") return `Read ${relative(cwd, value("file_path")) || value("file_path")}`;
  if (tool === "Grep" || tool === "Glob") return `Searched files for ${value("pattern")}`;
  return tool;
}

/**
 * Starts a read-only Claude Code job that answers one factual question from the web. It loads
 * project settings but not the person's own, and isn't saved to Claude Code's session history.
 */
export function startResearch(panelId: string, turnId: string, question: string) {
  const id = crypto.randomUUID();
  mutatePanel(panelId, (panel) =>
    turnOf(panel, turnId).research.push({
      id,
      question,
      status: "running",
      text: "",
      steps: [],
      startedAt: new Date().toISOString(),
    }),
  );
  const update = (change: (note: Panel["turns"][number]["research"][number]) => void) =>
    mutatePanel(panelId, (panel) => {
      const note = turnOf(panel, turnId).research.find((item) => item.id === id);
      if (note) change(note);
    });
  const controller = new AbortController();
  activeResearch.set(id, controller);
  const timer = setTimeout(() => controller.abort(), researchTimeout);
  void (async () => {
    const cwd = join(dataDirectory, "research");
    try {
      mkdirSync(cwd, { recursive: true });
      const tools = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"];
      let answer: string | undefined;
      for await (const event of query({
        prompt: question,
        options: {
          model: "opus",
          effort: "high",
          systemPrompt: researchSystem,
          settingSources: ["project", "local"],
          tools,
          allowedTools: tools,
          mcpServers: {},
          strictMcpConfig: true,
          maxTurns: 60,
          persistSession: false,
          cwd,
          abortController: controller,
          env: claudeEnv(panelId),
          pathToClaudeCodeExecutable: await claudeExecutable(),
        },
      })) {
        if (event.type === "assistant")
          for (const block of event.message.content)
            if (block.type === "tool_use") {
              const label = stepLabel(block.name, block.input as Record<string, unknown>, cwd);
              update((note) => note.steps.push(label));
            }
        if (event.type === "result")
          answer = event.subtype === "success" ? event.result.trim() : undefined;
      }
      update((note) => {
        note.status = answer ? "done" : "error";
        note.text = answer ?? "Research ended without an answer.";
        note.finishedAt = new Date().toISOString();
      });
    } catch (error) {
      update((note) => {
        note.status = "error";
        note.text = controller.signal.aborted
          ? "Research was stopped."
          : `Research failed: ${message(error)}`;
        note.finishedAt = new Date().toISOString();
      });
    } finally {
      clearTimeout(timer);
      activeResearch.delete(id);
    }
  })();
  return id;
}

/** Stops the panel's running turn and any research it started. */
export function stopPanel(panel: Panel) {
  activeTurns.get(panel.id)?.abort();
  for (const turn of panel.turns)
    for (const note of turn.research) activeResearch.get(note.id)?.abort();
}

/**
 * Work cut off by a server restart stays saved as running. When nothing is running here, mark it
 * stopped so the page doesn't wait on it forever.
 */
export function recoverPanel(panel: Panel) {
  let changed = false;
  for (const turn of panel.turns) {
    if (turn.status === "running" && !activeTurns.has(panel.id)) {
      turn.status = "stopped";
      for (const reply of turn.rounds.flat())
        if (reply.status === "thinking") reply.status = "stopped";
      changed = true;
    }
    for (const note of turn.research)
      if (note.status === "running" && !activeResearch.has(note.id)) {
        note.status = "error";
        note.text = "The server restarted before this research finished.";
        changed = true;
      }
  }
  return changed;
}
