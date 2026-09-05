import { expect, it } from "vite-plus/test";
import { z } from "zod";
import type { Duck, Message } from "../lib/room";
import type { RoomTools } from "./room-tools.server";

// Two short turns only. No room transcript, file tools, or network research.
it.skipIf(process.env.DUCKPOND_SESSION_INTEGRATION !== "1")(
  "resumes a Codex thread across connections with history and room tools intact",
  async () => {
    if (!process.env.DUCKPOND_DATA_DIR || !process.env.DUCKPOND_AGENT_CWD)
      throw new Error("Set isolated DUCKPOND_DATA_DIR and DUCKPOND_AGENT_CWD directories.");
    const { reply } = await import("./providers.server");
    const { listProviderUsage, readProviderSession } = await import("./store.server");
    const { usageRecordSchema } = await import("./sessions.server");
    const roomId = crypto.randomUUID();
    const duck: Duck = {
      id: "probe",
      name: "Probe",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoning: "medium",
      instructions: "",
    };
    const history: Message[] = [];
    const receipts: string[] = [];
    let invocation = 0;
    const tools: RoomTools = {
      definitions: [
        {
          name: "record_marker",
          description: "Record the marker and receive a receipt.",
          inputSchema: z.object({ marker: z.string() }),
        },
      ],
      call(_name, input) {
        expect(z.object({ marker: z.string() }).parse(input).marker).toBe("duckpond-7319");
        const receipt = `receipt-${invocation}`;
        receipts.push(receipt);
        return { receipt };
      },
    };
    const system =
      "This is a short session continuity check. Use only record_marker, once per turn. Do not access files, network, skills, or other tools. Respond with only the receipt from the tool.";
    let nativeId: unknown;
    for (const text of [
      "Remember marker duckpond-7319. Record it now.",
      "Record the marker from our previous turn again.",
    ]) {
      invocation++;
      history.push({
        id: crypto.randomUUID(),
        speaker: "You",
        text,
        status: "complete",
        phase: "conversation",
        createdAt: new Date().toISOString(),
      });
      let output = "";
      await reply(
        duck,
        system,
        "",
        AbortSignal.timeout(90000),
        (delta) => {
          output += delta;
        },
        (event) => {
          if (event.type === "approval") throw new Error("Unexpected native tool request");
        },
        tools,
        {
          roomId,
          messages: history,
          makePrompt: (messages) => JSON.stringify(messages.map(({ text }) => text)),
        },
      );
      expect(output).toContain(`receipt-${invocation}`);
      const session = z
        .object({ nativeId: z.string() })
        .parse(readProviderSession(`${roomId}/${duck.id}`));
      if (nativeId) expect(session.nativeId).toBe(nativeId);
      nativeId = session.nativeId;
    }
    expect(receipts).toEqual(["receipt-1", "receipt-2"]);
    const calls = listProviderUsage()
      .map((record) => usageRecordSchema.parse(record))
      .filter((record) => record.roomId === roomId);
    expect(calls.map(({ resumed, newMessages }) => ({ resumed, newMessages }))).toEqual([
      { resumed: false, newMessages: 1 },
      { resumed: true, newMessages: 1 },
    ]);
    expect(
      calls.every(
        (call) =>
          call.tokens && call.tokens.input >= call.tokens.cacheRead && call.tokens.output > 0,
      ),
    ).toBe(true);
  },
  190000,
);
