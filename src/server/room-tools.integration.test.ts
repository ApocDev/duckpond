import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { defaults, type Room } from "../lib/room";
import type { RoomTools } from "./room-tools.server";

// Opt in with an isolated DUCKPOND_DATA_DIR; these calls use the local subscriptions.
it.skipIf(process.env.DUCKPOND_PROVIDER_INTEGRATION !== "1").each(["claude", "codex"] as const)(
  "%s invokes a real room tool and reads its result",
  async (provider) => {
    if (!process.env.DUCKPOND_DATA_DIR || !process.env.DUCKPOND_AGENT_CWD)
      throw new Error(
        "Set DUCKPOND_DATA_DIR and DUCKPOND_AGENT_CWD to an isolated test directory.",
      );
    const { reply } = await import("./providers.server");
    const calls: unknown[] = [];
    const tools: RoomTools = {
      definitions: [
        {
          name: "ask_duck",
          description: "Queue a question for another duck.",
          inputSchema: z.object({ duckId: z.string(), question: z.string() }),
        },
      ],
      call(name, input) {
        calls.push({ name, input });
        return { queued: true, receipt: "pond-8241" };
      },
    };
    let text = "";
    await reply(
      {
        ...defaults[0],
        provider,
        model: provider === "codex" ? "gpt-5.6-sol" : "sonnet",
        reasoning: "medium",
      },
      "You are testing a room tool integration. Use only the supplied ask_duck tool. Do not access files, network, or other tools.",
      "Call ask_duck once with duckId skeptic and question Would one authored puzzle stay interesting? Then reply with only the receipt returned by the tool.",
      AbortSignal.timeout(120000),
      (delta) => {
        text += delta;
      },
      (event) => {
        if (event.type === "approval")
          throw new Error("Room tools must not require user approval.");
      },
      tools,
    );
    expect(calls).toEqual([
      {
        name: "ask_duck",
        input: { duckId: "skeptic", question: "Would one authored puzzle stay interesting?" },
      },
    ]);
    expect(text).toContain("pond-8241");
  },
  130000,
);

it.skipIf(process.env.DUCKPOND_DISCUSSION_INTEGRATION !== "1")(
  "Mediator runs a real discussion across Claude and Codex",
  async () => {
    if (!process.env.DUCKPOND_DATA_DIR || !process.env.DUCKPOND_AGENT_CWD)
      throw new Error(
        "Set DUCKPOND_DATA_DIR and DUCKPOND_AGENT_CWD to an isolated test directory.",
      );
    const { runConversation } = await import("./conversation.server");
    const room: Room = {
      id: crypto.randomUUID(),
      title: "Mediator integration",
      messages: [],
      notes:
        "Keep this discussion to the first prototype. Answer the peer question before finishing. Do not research or access files; use only room tools.",
      observe: false,
      updatedAt: "",
      ducks: [
        {
          ...defaults[0],
          instructions:
            "Argue for one hand-authored repair puzzle in the first prototype. In your initial assessment, call ask_duck to ask skeptic whether one fixed fault is enough to test whether diagnosis is fun. In later responses, address the assigned question briefly. Do not ask more questions once the objection is answered.",
        },
        {
          ...defaults[1],
          model: "gpt-5.6-sol",
          reasoning: "medium",
          instructions:
            "Challenge whether a single fixed fault proves replayability. Distinguish testing the diagnosis interaction from testing long-term replayability. When asked by a peer, answer directly and revise your view if the prototype only aims to test the interaction. Do not add unrelated concerns.",
        },
      ],
    };
    await runConversation(
      room,
      "Should my first repair-game prototype have one fixed fault or random faults? Work through that one disagreement and stop after answering the peer question. Keep replies to two sentences. No research or file access.",
      "discussion",
      "explorer",
      AbortSignal.timeout(240000),
      (event) => {
        if (event.type === "approval")
          throw new Error("This discussion should only use room tools.");
      },
      { persist: () => {}, streamText: false },
    );
    const discussion = room.discussions![0];
    console.log(
      "Real discussion result",
      JSON.stringify({
        status: discussion.status,
        turns: discussion.turns,
        speakers: room.messages.map((message) => message.speaker),
        requests: discussion.requests.map((request) => ({
          from: request.from,
          to: request.to,
          status: request.status,
        })),
        final: room.messages.at(-1)?.text,
      }),
    );
    expect(discussion.status).toBe("complete");
    expect(discussion.turns).toBeGreaterThan(0);
    expect(
      discussion.requests.some(
        (request) => request.kind === "question" && request.status === "addressed",
      ),
    ).toBe(true);
    expect(room.messages.at(-1)).toMatchObject({
      speaker: "Mediator",
      phase: "guide",
      status: "complete",
    });
  },
  250000,
);

it.skipIf(process.env.DUCKPOND_ACTION_INTEGRATION !== "1")(
  "Mediator assigns approved file inspection to Claude and reviews its result",
  async () => {
    if (!process.env.DUCKPOND_DATA_DIR || !process.env.DUCKPOND_AGENT_CWD)
      throw new Error("Set isolated data and agent directories.");
    const { writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    await writeFile(
      path.join(process.env.DUCKPOND_AGENT_CWD, "audit.txt"),
      "Cable test receipt: pond-9327\n",
    );
    const { runConversation } = await import("./conversation.server");
    const room: Room = {
      id: crypto.randomUUID(),
      title: "Action integration",
      messages: [],
      notes:
        "Use Explorer to inspect the file. No opinion panel is needed. Do not change files or use the network.",
      observe: false,
      updatedAt: "",
      ducks: [
        {
          ...defaults[0],
          instructions:
            "Read the requested file using your native tools. Report the exact receipt with report_action and in your reply. Do not ask for permission that the user already granted.",
        },
      ],
    };
    await runConversation(
      room,
      "Have Explorer read audit.txt and return the cable test receipt. I authorize this read-only inspection. Complete it now and review the evidence.",
      "discussion",
      "explorer",
      AbortSignal.timeout(180000),
      (event) => {
        if (event.type === "approval")
          throw new Error("An isolated file read should not need approval.");
      },
      { persist: () => {}, streamText: false },
    );
    console.log(
      "Action integration",
      JSON.stringify({ actions: room.actions, final: room.messages.at(-1)?.text }),
    );
    expect(room.discussions![0].status).toBe("complete");
    expect(room.actions).toHaveLength(1);
    expect(room.actions![0]).toMatchObject({ status: "complete", owner: "explorer" });
    expect(room.actions![0].result).toContain("pond-9327");
    expect(
      room.messages.find((message) => message.id === room.actions![0].responseId)?.tools,
    ).toContain("Read");
  },
  190000,
);
