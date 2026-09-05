import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Duck } from "../lib/room";
import type { ModelCatalog, ProviderModel } from "../lib/models";
import { connectCodex } from "./codex-client.server";
import { getAgentDirectory, claudeExecutable } from "./providers.server";

const codexPage = z.object({
  data: z.array(
    z.object({
      model: z.string(),
      displayName: z.string(),
      description: z.string().optional(),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })),
      defaultReasoningEffort: z.string().optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

async function codexModels(): Promise<ProviderModel[]> {
  const client = connectCodex(await getAgentDirectory(), AbortSignal.timeout(20000));
  try {
    await client.initialize();
    const models: ProviderModel[] = [];
    let cursor: string | null | undefined;
    do {
      const page = codexPage.parse(await client.request("model/list", { cursor, limit: 100 }));
      models.push(
        ...page.data.map((model) => ({
          id: model.model,
          name: model.displayName,
          description: model.description ?? "",
          aliases: [],
          reasoning: model.supportedReasoningEfforts.map((item) => item.reasoningEffort),
          defaultReasoning: model.defaultReasoningEffort,
        })),
      );
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  } finally {
    client.close();
  }
}

async function claudeModels(): Promise<ProviderModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  // Keep stdin open for initialization without sending a user prompt or spending a model turn.
  // eslint-disable-next-line require-yield
  async function* noPrompt() {
    await new Promise<void>((resolve) => {
      if (controller.signal.aborted) resolve();
      else controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }
  let session: ReturnType<typeof query> | undefined;
  try {
    session = query({
      prompt: noPrompt(),
      options: {
        cwd: await getAgentDirectory(),
        pathToClaudeCodeExecutable: await claudeExecutable(),
        settingSources: ["user", "project", "local"],
        abortController: controller,
        env: { ...process.env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined },
      },
    });
    return (await session.supportedModels()).map((model) => ({
      id: model.value,
      name: model.displayName,
      description: model.description,
      aliases: model.resolvedModel ? [model.resolvedModel] : [],
      reasoning: model.supportedEffortLevels ?? [],
    }));
  } finally {
    clearTimeout(timer);
    controller.abort();
    session?.close();
  }
}

const cache = new Map<Duck["provider"], { expires: number; value: Promise<ModelCatalog> }>();

export function providerModels(provider: Duck["provider"], refresh = false): Promise<ModelCatalog> {
  const cached = cache.get(provider);
  if (!refresh && cached && cached.expires > Date.now()) return cached.value;
  const value = (provider === "codex" ? codexModels() : claudeModels())
    .then((models): ModelCatalog => ({ provider, models }))
    .catch((error: unknown): ModelCatalog => {
      cache.delete(provider);
      return {
        provider,
        models: [],
        error: `Couldn't load ${provider} models: ${error instanceof Error ? error.message : "provider unavailable"}`,
      };
    });
  cache.set(provider, { expires: Date.now() + 300000, value });
  return value;
}
