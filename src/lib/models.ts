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
