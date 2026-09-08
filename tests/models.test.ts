import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODELS,
  FALLBACK_MODELS,
  modelName,
  modelLabels,
  parseCachedModels,
  parseModelCatalog,
  parseModelSettings,
} from '../lib/models.ts';

void test('saved model names display without waiting for the network and defaults never flash', () => {
  const selected = {
    improver: 'example/improver',
    answerer: 'example/answerer',
  };
  const cached = parseCachedModels(
    JSON.parse(
      JSON.stringify([
        {
          id: selected.improver,
          name: 'Example: Custom Improver',
          ignored: 'metadata',
        },
        { id: selected.answerer, name: 'Example: Custom Answerer' },
      ]),
    ),
  );
  assert.equal(modelLabels(DEFAULT_MODELS, FALLBACK_MODELS, false), null);
  assert.equal(modelLabels(selected, FALLBACK_MODELS, true), null);
  assert.equal(modelLabels(selected, cached, false), null);
  assert.deepEqual(modelLabels(selected, cached, true), {
    improver: 'Custom Improver',
    answerer: 'Custom Answerer',
  });
  assert.deepEqual(Object.keys(cached[0]).sort(), ['id', 'name']);
  assert.deepEqual(
    parseCachedModels([
      null,
      {},
      { id: 'bad', name: 'Bad' },
      { id: 'example/model', name: '' },
    ]),
    [],
  );
});

void test('older settings keep defaults and saved model choices survive a round trip', () => {
  assert.deepEqual(parseModelSettings(undefined), DEFAULT_MODELS);
  const saved = {
    improver: 'openai/gpt-5.6-sol',
    answerer: 'anthropic/claude-opus-5',
  };
  assert.deepEqual(
    parseModelSettings(JSON.parse(JSON.stringify(saved))),
    saved,
  );
  assert.deepEqual(parseModelSettings({ answerer: saved.answerer }), {
    improver: DEFAULT_MODELS.improver,
    answerer: saved.answerer,
  });
});

void test('model names reflect each selection and preserve readable provider names', () => {
  assert.equal(modelName(DEFAULT_MODELS.improver, FALLBACK_MODELS), 'Opus 5');
  assert.equal(modelName(DEFAULT_MODELS.answerer, FALLBACK_MODELS), 'Sonnet 5');
  assert.equal(modelName('openai/gpt-5.6-sol', FALLBACK_MODELS), 'GPT-5.6 Sol');
  assert.equal(
    modelName('example/choice', [
      { id: 'example/choice', name: 'Example: Choice' },
    ]),
    'Choice',
  );
  assert.equal(modelName('example/saved-model', []), 'saved-model');
});

void test('the catalog excludes batch, non-text, and models missing tools or reasoning', () => {
  const model = {
    id: 'example/chat',
    name: 'Example: Chat',
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    supported_parameters: ['tools', 'reasoning'],
  };
  const options = parseModelCatalog({
    data: [
      model,
      { ...model, id: `${model.id}:batch` },
      { ...model, id: 'example/no-tools', supported_parameters: ['reasoning'] },
      { ...model, id: 'example/no-reasoning', supported_parameters: ['tools'] },
      {
        ...model,
        id: 'example/image',
        architecture: {
          input_modalities: ['text'],
          output_modalities: ['image'],
        },
      },
      {
        ...model,
        id: 'example/speech',
        architecture: {
          input_modalities: ['audio'],
          output_modalities: ['text'],
        },
      },
      {
        ...model,
        id: 'anthropic/claude-sonnet-5',
        name: 'Anthropic: Claude Sonnet 5',
      },
      { ...model, id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
      null,
      {},
      model,
    ],
  });
  assert.deepEqual(
    options.map(({ id }) => id),
    ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5', 'example/chat'],
  );
  assert.deepEqual(Object.keys(options[0]).sort(), ['id', 'name']);
  assert.throws(() => parseModelCatalog({ data: [] }));
  assert.throws(() => parseModelCatalog(null));
});
