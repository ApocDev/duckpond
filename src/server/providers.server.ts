import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { streamText } from "ai";
import { z } from "zod";
import type { Duck, RoomEvent } from "../lib/room";
import { dataDirectory } from "./store.server";

import { questionFields, mcpFields } from "../lib/approval";
import { askApproval } from "./approvals.server";
import { codexReply } from "./codex.server";

const exec = promisify(execFile);
const claude = createClaudeCode();
const agentDirectory = join(dataDirectory, "agent");
export async function getAgentDirectory() {
  await mkdir(agentDirectory, { recursive: true });
  return process.env.DUCKPOND_AGENT_CWD ?? agentDirectory;
}
export async function claudeExecutable() {
  return process.env.DUCKPOND_CLAUDE_BIN ?? (await exec("which", ["claude"])).stdout.trim();
}

export async function providerStatus() {
  const statuses = await Promise.all(
    (["claude", "codex"] as const).map(async (provider) => {
      try {
        const result = await exec(
          provider,
          provider === "claude" ? ["auth", "status", "--json"] : ["login", "status"],
          { timeout: 10000 },
        );
        const connected =
          provider === "claude"
            ? z
                .object({ loggedIn: z.boolean(), authMethod: z.string().optional() })
                .parse(JSON.parse(result.stdout)).authMethod === "claude.ai"
            : /logged in using chatgpt/i.test(result.stdout + result.stderr);
        return { provider, connected };
      } catch {
        return { provider, connected: false };
      }
    }),
  );
  return statuses;
}

/** Native provider tools and settings remain available; permission requests go to the UI. */
export async function reply(
  duck: Duck,
  system: string,
  prompt: string,
  signal: AbortSignal,
  onText: (text: string) => void,
  emit: (event: RoomEvent) => void,
): Promise<void> {
  const cwd = await getAgentDirectory();
  if (duck.provider === "codex") return codexReply(duck, cwd, system, prompt, signal, emit, onText);
  const result = streamText({
    model: claude(duck.model || "default", {
      cwd,
      pathToClaudeCodeExecutable: await claudeExecutable(),
      effort: duck.reasoning
        ? z.enum(["low", "medium", "high", "xhigh", "max"]).parse(duck.reasoning)
        : undefined,
      settingSources: ["user", "project", "local"],
      permissionMode: "default",
      maxTurns: 20,
      onElicitation: async (request) => {
        const response = await askApproval(
          {
            duck: duck.name,
            title: request.message,
            detail: JSON.stringify(request, null, 2),
            input: true,
            fields: mcpFields(request.requestedSchema),
            url: request.url,
          },
          signal,
          emit,
        );
        return response.approved
          ? {
              action: "accept",
              content: z
                .record(
                  z.string(),
                  z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
                )
                .parse(JSON.parse(response.answer || "{}")),
            }
          : { action: "decline" };
      },
      env: { ...process.env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined },
      canUseTool: async (name, input) => {
        const response = await askApproval(
          {
            duck: duck.name,
            title: name,
            detail: JSON.stringify(input, null, 2),
            input: name === "AskUserQuestion",
            fields: name === "AskUserQuestion" ? questionFields(input.questions) : [],
          },
          signal,
          emit,
        );
        return response.approved
          ? {
              behavior: "allow",
              updatedInput:
                name === "AskUserQuestion"
                  ? { ...input, answers: response.answer ? JSON.parse(response.answer) : {} }
                  : input,
            }
          : { behavior: "deny", message: "The user declined this request." };
      },
    }),
    system,
    prompt,
    abortSignal: signal,
    maxRetries: 0,
  });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") onText(part.text);
    if (part.type === "tool-call")
      emit({ type: "activity", duckId: duck.id, label: part.toolName });
    if (part.type === "error") throw part.error;
  }
}
