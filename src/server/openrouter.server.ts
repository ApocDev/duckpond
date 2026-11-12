import { z } from "zod";

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.object({ cost: z.number().optional() }).optional(),
});

export const hasOpenRouterKey = () => !!process.env.OPENROUTER_API_KEY;

/**
 * One chat completion through OpenRouter. With a schema, the model must answer with JSON that
 * matches it. Returns the text and what the call cost in dollars.
 */
export async function openRouter({
  model,
  system,
  prompt,
  signal,
  json,
}: {
  model: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
  json?: { name: string; schema: z.ZodType };
}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Set OPENROUTER_API_KEY to use the panel.");
  const schema = json ? z.toJSONSchema(json.schema, { io: "output" }) : undefined;
  if (schema) delete schema.$schema;
  let failure = "";
  // Providers behind OpenRouter fail now and then; one retry keeps a single flaky call from
  // sinking a whole round.
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Duckpond",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        reasoning: { effort: "medium" },
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
