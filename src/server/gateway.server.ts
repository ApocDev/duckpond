import { z } from "zod";

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ cost: z.number().optional() }).optional(),
});

/** Tags every call so the gateway's archive can group usage by app and conversation. */
const provenance = (session: string) => ({ "x-ai-app": "duckpond", "x-ai-session": session });

export const hasGateway = () =>
  !!process.env.DUCKPOND_AI_GATEWAY_URL && !!process.env.DUCKPOND_AI_GATEWAY_KEY;

function gateway() {
  const url = process.env.DUCKPOND_AI_GATEWAY_URL;
  const key = process.env.DUCKPOND_AI_GATEWAY_KEY;
  if (!url || !key)
    throw new Error("Set DUCKPOND_AI_GATEWAY_URL and DUCKPOND_AI_GATEWAY_KEY to use the panel.");
  return { url, key };
}

/**
 * One chat completion through the AI gateway. Bare model names such as `claude-sonnet-5-5` run on
 * a subscription through CLIProxyAPI. `provider/model` names run through LiteLLM and are paid.
 * With a schema, the model must answer with JSON that matches it. Returns the text and what the
 * call cost in dollars, which is 0 for subscription models.
 */
export async function chat({
  model,
  system,
  prompt,
  session,
  signal,
  json,
}: {
  model: string;
  system: string;
  prompt: string;
  /** Groups the call with the rest of its conversation in the gateway's archive. */
  session: string;
  signal: AbortSignal;
  json?: { name: string; schema: z.ZodType };
}) {
  const { url, key } = gateway();
  const route = model.includes("/") ? "/v1" : "/subscriptions/v1";
  const schema = json ? z.toJSONSchema(json.schema, { io: "output" }) : undefined;
  if (schema) delete schema.$schema;
  let failure = "";
  // Upstream providers fail now and then; one retry keeps a single flaky call from sinking a
  // whole round.
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(`${url}${route}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...provenance(session),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        reasoning_effort: "medium",
        max_tokens: 8000,
        usage: { include: true },
        ...(json && {
          response_format: {
            type: "json_schema",
            json_schema: { name: json.name, strict: true, schema },
          },
        }),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
    });
    const body: unknown = await response.json().catch(() => ({}));
    const parsed = responseSchema.safeParse(body);
    const text = parsed.data?.choices[0].message.content?.trim();
    if (response.ok && text) return { text, cost: parsed.data?.usage?.cost ?? 0 };
    failure = `${model} failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`;
  }
  throw new Error(failure);
}

/** Environment for a Claude Code job that runs on the Claude subscription through the gateway. */
export function claudeGatewayEnv(session: string) {
  const { url, key } = gateway();
  return {
    ...process.env,
    // Claude Code appends /v1 itself.
    ANTHROPIC_BASE_URL: `${url}/subscriptions`,
    ANTHROPIC_AUTH_TOKEN: key,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_CUSTOM_HEADERS: Object.entries(provenance(session))
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n"),
  };
}
