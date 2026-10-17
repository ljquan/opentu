import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRecord } from '../provider';
import type { CreateGenerationTaskRequest, GenerationRoute } from './types';

const { requestProviderJson } = vi.hoisted(() => ({
  requestProviderJson: vi.fn(),
}));

vi.mock('./outbound', () => ({ requestProviderJson }));

import { executeGeneration, resolveGenerationAdapter } from './adapters';

const provider: ProviderRecord = {
  id: 'provider-1',
  name: 'Provider',
  base_url: 'https://provider.invalid',
  auth_type: 'bearer',
  auth_header: null,
  auth_query: null,
  extra_headers: {},
  encrypted_api_key: 'encrypted',
  enabled: true,
  health_status: 'healthy',
  health_message: null,
  last_checked_at: null,
};

function route(category: GenerationRoute['category']): GenerationRoute {
  return {
    provider,
    providerModelRecordId: 'model-row-1',
    modelId: category === 'text' ? 'text-model' : 'gpt-image-2',
    category,
    billingMode: 'free',
    routingPriority: 10,
  };
}

function request(
  operation: CreateGenerationTaskRequest['operation'],
  input: Record<string, unknown>,
  parameters: Record<string, unknown> = {}
): CreateGenerationTaskRequest {
  return {
    modelId: operation === 'text' ? 'text-model' : 'gpt-image-2',
    operation,
    input,
    parameters,
    references: [],
    context: {},
  };
}

describe('generation adapter registry', () => {
  beforeEach(() => requestProviderJson.mockReset());

  it('registers B1 operations and leaves B2 operations unavailable', () => {
    expect(resolveGenerationAdapter('text')).toBeTypeOf('function');
    expect(resolveGenerationAdapter('image')).toBeTypeOf('function');
    expect(resolveGenerationAdapter('video')).toBeNull();
    expect(resolveGenerationAdapter('audio')).toBeNull();
  });

  it('maps text input and normalizes usage', async () => {
    requestProviderJson.mockResolvedValue({
      choices: [{ message: { content: 'Generated text' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    });

    const result = await executeGeneration(
      route('text'),
      request('text', { prompt: 'Write this' }, { maxTokens: 50 }),
      'task-1'
    );

    expect(result.result).toEqual({
      type: 'text',
      text: 'Generated text',
      finishReason: 'stop',
    });
    expect(result.usage?.totalTokens).toBe(17);
    const options = requestProviderJson.mock.calls[0][1];
    expect(options.path).toBe('/v1/chat/completions');
    expect(JSON.parse(options.body)).toMatchObject({
      model: 'text-model',
      stream: false,
      max_tokens: 50,
    });
  });

  it('uses image edits for references and generations without references', async () => {
    requestProviderJson.mockResolvedValue({ data: [{ b64_json: 'aGVsbG8=' }] });
    const inlineImage = `data:image/png;base64,${Buffer.from('image').toString('base64')}`;

    await executeGeneration(
      route('image'),
      request('image', { prompt: 'Edit this', images: [inlineImage] }),
      'task-edit'
    );
    expect(requestProviderJson.mock.calls[0][1].path).toBe('/v1/images/edits');
    expect(requestProviderJson.mock.calls[0][1].body).toBeInstanceOf(FormData);

    requestProviderJson.mockClear();
    const result = await executeGeneration(
      route('image'),
      request('image', { prompt: 'Create this' }, { size: '1024x1024' }),
      'task-create'
    );
    expect(requestProviderJson.mock.calls[0][1].path).toBe('/v1/images/generations');
    expect(result.result).toMatchObject({ type: 'image' });
    expect(result.usage?.generatedCount).toBe(1);
  });
});
