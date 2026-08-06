import { describe, expect, it } from 'vitest';
import {
  buildManualHttpFormData,
  buildManualHttpRequestBody,
  buildManualHttpRequestPayload,
  getByPath,
  normalizeManualHttpResult,
  renderTemplate,
  type ManualHttpTemplateMetadata,
} from '../provider-routing/manual-http-template';

describe('manual-http-template', () => {
  it('renders scalar and JSON placeholders without flattening pure object slots', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const variables = {
      model: 'gpt-test',
      prompt: 'draw',
      messages,
      images: ['img-a'],
      params: {
        size: '1024x1024',
      },
    };

    expect(renderTemplate('{{messages}}', variables)).toBe(messages);
    expect(renderTemplate('model={{model}} size={{params.size}}', variables)).toBe(
      'model=gpt-test size=1024x1024'
    );
    expect(
      renderTemplate(
        { model: '{{model}}', messages: '{{messages}}', label: 'x {{images}}' },
        variables
      )
    ).toEqual({
      model: 'gpt-test',
      messages,
      label: 'x ["img-a"]',
    });
  });

  it('builds request bodies from empty, JSON, pure placeholder and text templates', () => {
    const variables = {
      model: 'gpt-test',
      prompt: 'say "hi"',
      messages: [{ role: 'user', content: 'hello' }],
    };

    expect(buildManualHttpRequestBody('', variables)).toBeUndefined();
    expect(buildManualHttpRequestBody('{{messages}}', variables)).toEqual([
      { role: 'user', content: 'hello' },
    ]);
    expect(
      buildManualHttpRequestBody(
        '{"model":"{{model}}","prompt":"{{prompt}}","messages":"{{messages}}"}',
        variables
      )
    ).toEqual({
      model: 'gpt-test',
      prompt: 'say "hi"',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(buildManualHttpRequestBody('prompt={{prompt}}', variables)).toBe(
      'prompt=say "hi"'
    );
  });

  it('builds form-data payloads from text and file-list fields', async () => {
    const variables = {
      model: 'gpt-image-2',
      prompt: 'draw',
      images: ['data:image/png;base64,aW1hZ2U='],
      params: {
        quality: 'high',
      },
    };

    const formData = await buildManualHttpFormData(
      [
        { name: 'model', value: '{{model}}' },
        { name: 'prompt', value: '{{prompt}}' },
        { name: 'quality', value: '{{params.quality}}' },
        { name: 'image', value: '{{images}}', kind: 'file-list' },
      ],
      variables
    );

    expect(formData.get('model')).toBe('gpt-image-2');
    expect(formData.get('prompt')).toBe('draw');
    expect(formData.get('quality')).toBe('high');
    expect(formData.getAll('image')[0]).toBeInstanceOf(Blob);
  });

  it('builds typed request payloads for json, raw, form-data and none bodies', async () => {
    const variables = {
      model: 'gpt-test',
      prompt: 'hello',
      images: ['data:image/png;base64,aW1hZ2U='],
    };

    await expect(
      buildManualHttpRequestPayload(
        {
          bodyType: 'json',
          bodyTemplate: '{"model":"{{model}}"}',
        },
        variables
      )
    ).resolves.toEqual({
      body: JSON.stringify({ model: 'gpt-test' }),
      contentType: 'application/json',
    });

    await expect(
      buildManualHttpRequestPayload(
        {
          bodyType: 'raw',
          bodyTemplate: 'prompt={{prompt}}',
        },
        variables
      )
    ).resolves.toEqual({
      body: 'prompt=hello',
      contentType: 'text/plain;charset=UTF-8',
    });

    const formPayload = await buildManualHttpRequestPayload(
      {
        bodyType: 'form-data',
        formFields: [{ name: 'image', value: '{{images}}', kind: 'file-list' }],
      },
      variables
    );
    expect(formPayload.body).toBeInstanceOf(FormData);
    expect(formPayload.contentType).toBeUndefined();

    await expect(
      buildManualHttpRequestPayload({ bodyType: 'none' }, variables)
    ).resolves.toEqual({ body: undefined });
  });

  it('reads dotted, bracket and wildcard paths with bounded expansion', () => {
    const payload = {
      data: [
        { url: 'https://a.example/image.png' },
        { url: 'https://b.example/image.png' },
      ],
      choices: [{ message: { content: 'done' } }],
      byKey: {
        first: { url: 'https://c.example/image.png' },
        second: { url: 'https://d.example/image.png' },
      },
    };

    expect(getByPath(payload, 'data[0].url')).toBe(
      'https://a.example/image.png'
    );
    expect(getByPath(payload, 'choices.0.message.content')).toBe('done');
    expect(getByPath(payload, 'data.*.url')).toEqual([
      'https://a.example/image.png',
      'https://b.example/image.png',
    ]);
    expect(getByPath(payload, 'byKey.*.url')).toEqual([
      'https://c.example/image.png',
      'https://d.example/image.png',
    ]);
  });

  it('normalizes text responses into Gemini choices', () => {
    expect(normalizeManualHttpResult('plain text', undefined, 'text')).toEqual({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'plain text',
          },
        },
      ],
    });

    expect(
      normalizeManualHttpResult(
        { result: { text: 'path text' } },
        { text: 'result.text' }
      )
    ).toEqual({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'path text',
          },
        },
      ],
    });
  });

  it('normalizes image responses from url and b64_json paths', () => {
    expect(
      normalizeManualHttpResult(
        {
          output: [
            { url: 'https://a.example/image.png' },
            { b64_json: 'base64-image' },
          ],
        },
        {
          url: 'output.*.url',
          b64_json: 'output.*.b64_json',
        }
      )
    ).toEqual({
      data: [
        { url: 'https://a.example/image.png' },
        { b64_json: 'base64-image' },
      ],
    });
  });

  it('normalizes task responses from explicit paths', () => {
    const metadata: ManualHttpTemplateMetadata = {
      method: 'POST',
      responsePaths: {
        taskId: 'data.id',
      },
      pollPaths: {
        status: 'task.state',
        progress: 'task.percent',
        resultUrl: 'task.output.url',
        error: 'task.error.message',
      },
    };

    expect(
      normalizeManualHttpResult(
        {
          task: {
            state: 'completed',
            percent: '85%',
            output: { url: 'https://example.com/result.png' },
            error: { message: 'none' },
          },
        },
        metadata.pollPaths
      )
    ).toEqual({
      status: 'completed',
      progress: 85,
      resultUrl: 'https://example.com/result.png',
      error: 'none',
    });

    expect(
      normalizeManualHttpResult(
        {
          data: {
            id: 'task-1',
          },
        },
        metadata.responsePaths
      )
    ).toEqual({
      taskId: 'task-1',
      status: undefined,
      progress: undefined,
      resultUrl: undefined,
      error: undefined,
    });
  });
});
