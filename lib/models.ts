import { MODELS } from './prompts.ts';

export type ModelSettings = { improver: string; answerer: string };
export type ModelOption = { id: string; name: string };

export const DEFAULT_MODELS: ModelSettings = {
  improver: MODELS.improver.id,
  answerer: MODELS.answerer.id,
};

export const FALLBACK_MODELS: ModelOption[] = [
  MODELS.improver,
  MODELS.answerer,
  { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol' },
];

function isModelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 200 &&
    /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:/-]*$/i.test(value)
  );
}

export function parseModelSettings(value: unknown): ModelSettings {
  const models = { ...DEFAULT_MODELS };
  if (value === undefined) return models;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid model settings');
  const input = value as Record<string, unknown>;
  for (const key of ['improver', 'answerer'] as const) {
    if (input[key] === undefined) continue;
    if (!isModelId(input[key])) throw new Error('Invalid model selection');
    models[key] = input[key];
  }
  return models;
}

export function modelName(id: string, options: ModelOption[]): string {
  const name =
    options.find((model) => model.id === id)?.name ??
    FALLBACK_MODELS.find((model) => model.id === id)?.name ??
    id.split('/').slice(1).join('/');
  return name.replace(/^[^:]+:\s*/, '').replace(/^Claude\s+/, '');
}

export function parseCachedModels(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (model) =>
        isModelId(model?.id) &&
        typeof model.name === 'string' &&
        model.name.trim() &&
        model.name.length <= 200,
    )
    .slice(0, 2000)
    .map(({ id, name }) => ({ id, name: name.trim() }));
}

export function modelLabels(
  models: ModelSettings,
  options: ModelOption[],
  hydrated: boolean,
): ModelSettings | null {
  if (!hydrated) return null;
  const known = [...options, ...FALLBACK_MODELS];
  if (
    !Object.values(models).every((id) => known.some((model) => model.id === id))
  )
    return null;
  return {
    improver: modelName(models.improver, known),
    answerer: modelName(models.answerer, known),
  };
}

/** Keep chat models that can use both reasoning and tools. */
export function parseModelCatalog(value: unknown): ModelOption[] {
  const data = (value as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error('Invalid model catalog');
  const models = new Map<string, ModelOption>();
  for (const model of data) {
    if (
      !isModelId(model?.id) ||
      model.id.endsWith(':batch') ||
      typeof model.name !== 'string' ||
      !model.name.trim() ||
      model.name.length > 200 ||
      !Array.isArray(model.architecture?.input_modalities) ||
      !model.architecture.input_modalities.includes('text') ||
      !Array.isArray(model.architecture?.output_modalities) ||
      model.architecture.output_modalities.length !== 1 ||
      model.architecture.output_modalities[0] !== 'text' ||
      !Array.isArray(model.supported_parameters) ||
      !model.supported_parameters.includes('tools') ||
      !model.supported_parameters.includes('reasoning')
    )
      continue;
    models.set(model.id, { id: model.id, name: model.name.trim() });
  }
  if (!models.size) throw new Error('No compatible models available');
  const preferred = FALLBACK_MODELS.map((model) => model.id);
  return [...models.values()].sort((a, b) => {
    const rankA = preferred.indexOf(a.id);
    const rankB = preferred.indexOf(b.id);
    return (
      (rankA < 0 ? preferred.length : rankA) -
        (rankB < 0 ? preferred.length : rankB) || a.name.localeCompare(b.name)
    );
  });
}
