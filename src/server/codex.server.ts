import { connectCodex, type CodexPacket } from "./codex-client.server";
import { z } from "zod";
import { questionFields, mcpFields } from "../lib/approval";
import { askApproval } from "./approvals.server";
import { callRoomTool, type RoomTools } from "./room-tools.server";
import type { Duck, RoomEvent } from "../lib/room";

/** App Server preserves native tool access and lets the UI answer permission requests. */
export async function codexReply(
  duck: Duck,
  cwd: string,
  system: string,
  prompt: string,
  signal: AbortSignal,
  emit: (event: RoomEvent) => void,
  onText: (text: string) => void,
  roomTools?: RoomTools,
) {
  const completion = Promise.withResolvers<void>();
  void completion.promise.catch(() => {});
  const client = connectCodex(cwd, signal, handle);
  const { request, send } = client;
  const receivedText = new Set<string>();
  let lastTextItem: string | undefined;
  async function handle(packet: CodexPacket) {
    const params = packet.params ?? {};
    if (packet.id !== undefined && packet.method) {
      const method = packet.method;
      if (method === "item/tool/call") {
        const result = callRoomTool(roomTools, String(params.tool), params.arguments);
        send({
          id: packet.id,
          result: {
            contentItems: [{ type: "inputText", text: result.text }],
            success: result.success,
          },
        });
        return;
      }
      const needsInput =
        method === "item/tool/requestUserInput" || method === "mcpServer/elicitation/request";
      if (!needsInput && !method.endsWith("requestApproval")) {
        send({ id: packet.id, error: { code: -32601, message: "Unsupported client request" } });
        return;
      }
      const response = await askApproval(
        {
          duck: duck.name,
          title: method,
          detail: JSON.stringify(params, null, 2),
          input: needsInput,
          url: typeof params.url === "string" ? params.url : undefined,
          fields:
            method === "item/tool/requestUserInput"
              ? questionFields(params.questions)
              : mcpFields(params.requestedSchema),
        },
        signal,
        emit,
      );
      let result: unknown;
      if (method === "item/permissions/requestApproval")
        result = { permissions: response.approved ? params.permissions : {}, scope: "turn" };
      else if (method === "mcpServer/elicitation/request")
        result = {
          action: response.approved ? "accept" : "decline",
          content: response.approved && response.answer ? JSON.parse(response.answer) : null,
        };
      else if (method === "item/tool/requestUserInput")
        result = {
          answers:
            response.approved && response.answer
              ? Object.fromEntries(
                  Object.entries(
                    z.record(z.string(), z.string()).parse(JSON.parse(response.answer)),
                  ).map(([key, value]) => [key, { answers: [value] }]),
                )
              : {},
        };
      else result = { decision: response.approved ? "accept" : "decline" };
      send({ id: packet.id, result });
      return;
    }
    if (packet.method === "item/agentMessage/delta" && typeof params.delta === "string") {
      if (typeof params.itemId === "string") {
        if (lastTextItem && lastTextItem !== params.itemId) onText("\n\n");
        lastTextItem = params.itemId;
        receivedText.add(params.itemId);
      }
      onText(params.delta);
    }
    if (packet.method === "item/started" || packet.method === "item/completed") {
      const item = z
        .object({
          id: z.string(),
          type: z.string(),
          text: z.string().optional(),
          tool: z.string().optional(),
          command: z.string().optional(),
        })
        .passthrough()
        .safeParse(params.item);
      if (item.success) {
        if (
          packet.method === "item/completed" &&
          item.data.type === "agentMessage" &&
          !receivedText.has(item.data.id) &&
          item.data.text
        )
          onText(item.data.text);
        if (!["agentMessage", "userMessage", "reasoning"].includes(item.data.type))
          emit({
            type: "activity",
            duckId: duck.id,
            label: item.data.tool ?? item.data.command ?? item.data.type,
          });
      }
    }
    if (packet.method === "turn/completed") {
      const turn = z
        .object({
          status: z.string(),
          error: z.object({ message: z.string() }).nullable().optional(),
        })
        .parse(params.turn);
      if (turn.status === "failed")
        completion.reject(new Error(turn.error?.message ?? "Codex turn failed"));
      else completion.resolve();
    }
  }
  try {
    signal.throwIfAborted();
    await client.initialize();
    const result = z.object({ thread: z.object({ id: z.string() }) }).parse(
      await request("thread/start", {
        cwd,
        model: duck.model || undefined,
        developerInstructions: system,
        dynamicTools: roomTools?.definitions.map((definition) => ({
          type: "function",
          name: definition.name,
          description: definition.description,
          inputSchema: z.toJSONSchema(definition.inputSchema),
        })),
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
      }),
    );
    await request("turn/start", {
      threadId: result.thread.id,
      effort: duck.reasoning || undefined,
      input: [{ type: "text", text: prompt }],
    });
    await Promise.race([completion.promise, client.disconnected]);
  } finally {
    client.close();
  }
}
