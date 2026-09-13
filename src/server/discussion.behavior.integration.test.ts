import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { defaults, type Room } from "../lib/room";

// One bounded conversation with real personas, without prescribed positions or a scripted chair.
it.skipIf(process.env.DUCKPOND_BEHAVIOR_INTEGRATION !== "1")(
  "discusses an open design tradeoff without polling every perspective",
  async () => {
    if (!process.env.DUCKPOND_DATA_DIR || !process.env.DUCKPOND_AGENT_CWD)
      throw new Error("Set isolated DUCKPOND_DATA_DIR and DUCKPOND_AGENT_CWD directories.");
    const { runConversation } = await import("./conversation.server");
    const { reply } = await import("./providers.server");
    const { dataDirectory, listProviderUsage } = await import("./store.server");
    const { usageRecordSchema } = await import("./sessions.server");
    const room: Room = {
      id: crypto.randomUUID(),
      title: "Delivery discussion check",
      messages: [],
      notes:
        "Discuss only. No research, file access, external tools, or implementation. Use only room coordination tools. Keep each contribution to one short paragraph.",
      observe: false,
      updatedAt: "",
      ducks: defaults.map((duck) => ({
        ...duck,
        provider: "codex",
        model: "gpt-6-astra",
        reasoning: "medium",
      })),
    };
    const calls: string[] = [];
    const schedules: string[] = [];
    await runConversation(
      room,
      "I'm designing a first-person datacenter game. Orders take time to arrive, and the player physically unpacks the equipment. Should a visible truck pull up with the shipment, or should the delivery appear in Receiving? I care about the place feeling alive, but I also want to finish building the game. Shopping is outside this discussion. I'm exploring the tradeoff, not asking you to implement or lock a plan.",
      "discussion",
      "explorer",
      AbortSignal.timeout(180000),
      (event) => {
        if (event.type === "approval")
          throw new Error("Unexpected tool approval in a discussion-only test.");
      },
      {
        persist: () => {},
        streamText: false,
        run: async (...args) => {
          calls.push(args[0].id);
          if (calls.length > 7)
            throw new Error("Behavior check exceeded seven provider invocations.");
          const tools = args[6];
          if (args[0].id === "mediator" && tools)
            args[6] = {
              ...tools,
              call(name, input) {
                const result = tools.call(name, input);
                schedules.push(name);
                return result;
              },
            };
          await reply(...args);
        },
      },
    );
    const usage = listProviderUsage()
      .map((row) => usageRecordSchema.parse(row))
      .filter((row) => row.roomId === room.id);
    const result = {
      room,
      calls,
      schedules,
      usage: {
        invocations: usage.length,
        input: usage.reduce((sum, row) => sum + (row.tokens?.input ?? 0), 0),
        cached: usage.reduce((sum, row) => sum + (row.tokens?.cacheRead ?? 0), 0),
        output: usage.reduce((sum, row) => sum + (row.tokens?.output ?? 0), 0),
      },
    };
    writeFileSync(join(dataDirectory, "discussion-behavior.json"), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({ calls, schedules, usage: result.usage, final: room.messages.at(-1)?.text }),
    );
    expect(room.discussions?.[0].status).toBe("complete");
    expect(schedules[0]).toBe("give_floor");
    expect(calls.filter((id) => id !== "mediator").length).toBeLessThanOrEqual(3);
    expect(new Set(calls.filter((id) => id !== "mediator")).size).toBeGreaterThanOrEqual(2);
    expect(room.messages.at(-1)).toMatchObject({
      speaker: "Mediator",
      phase: "guide",
      status: "complete",
    });
  },
  190000,
);
