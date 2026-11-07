import type { Duck } from "./room";

export type ProviderModel = {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  reasoning: string[];
  defaultReasoning?: string;
};
export type ModelCatalog = {
  provider: Duck["provider"];
  models: ProviderModel[];
  error?: string;
};

export function findModel(models: ProviderModel[], id: string) {
  return models.find((model) => model.id === id || model.aliases.includes(id));
}

export function validateModelSelection(duck: Duck, catalog: ModelCatalog) {
  if (!duck.model && !duck.reasoning) return;
  if (catalog.error) throw new Error(catalog.error);
  const model = findModel(catalog.models, duck.model);
  if (!model) throw new Error(`Choose an available ${duck.provider} model for ${duck.name}.`);
  if (duck.reasoning && !model.reasoning.includes(duck.reasoning))
    throw new Error(`${model.name} does not support ${duck.reasoning} reasoning.`);
}

/** "gpt-6-astra" → "GPT-6-Astra", "sonnet" → "Sonnet"; matches how the catalogs name models. */
function displayModel(id: string) {
  return id
    .split("-")
    .map((part) => (part === "gpt" ? "GPT" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("-");
}

/**
 * One label format for a model choice everywhere it appears: "GPT-6-Astra · High".
 * Pass the catalog name when it's loaded; otherwise the id is prettified the same way.
 */
export function modelLabel(model: string, reasoning?: string, name?: string) {
  const base = name ?? (model ? displayModel(model) : "Default model");
  return reasoning ? `${base} · ${reasoning.charAt(0).toUpperCase()}${reasoning.slice(1)}` : base;
}
