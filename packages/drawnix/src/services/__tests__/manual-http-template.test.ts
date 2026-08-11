import { describe, expect, it, vi } from 'vitest';
import * as aituUtils from '@aitu/utils';
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
    expect(
      renderTemplate('model={{model}} size={{params.size}}', variables)
    ).toBe('model=gpt-test size=1024x1024');
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

  it('downloads public image fields without credentials and forwards cancellation', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': '4',
        },
      })
    );

    const formData = await buildManualHttpFormData(
      [{ name: 'image', value: '{{image}}', kind: 'file' }],
      { image: 'https://cdn.example.com/reference.png' },
      fetcher,
      controller.signal
    );

    expect(fetcher).toHaveBeenCalledWith(
      'https://cdn.example.com/reference.png',
      {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal,
      }
    );
    expect((formData.get('image') as Blob).size).toBe(4);
  });

  it('allows relative and absolute same-origin images on a local deployment', async () => {
    vi.stubGlobal('location', new URL('http://192.168.1.10:7200/app'));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      Promise.resolve(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      )
    );

    try {
      await buildManualHttpFormData(
        [
          { name: 'relative', value: '{{relative}}', kind: 'file' },
          { name: 'absolute', value: '{{absolute}}', kind: 'file' },
        ],
        {
          relative: '/__aitu_cache__/reference.png',
          absolute: 'http://192.168.1.10:7200/reference.png',
        },
        fetcher
      );

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        '/__aitu_cache__/reference.png',
        'http://192.168.1.10:7200/reference.png',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    'ftp://cdn.example.com/reference.png',
    'https://user:secret@cdn.example.com/reference.png',
    'http://localhost/reference.png',
    'http://127.0.0.1/reference.png',
    'http://192.168.1.10/reference.png',
    'http://169.254.1.10/reference.png',
    'blob:https://untrusted.example/reference-id',
  ])('rejects unsafe image field source %s before fetching', async (source) => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      buildManualHttpFormData(
        [{ name: 'image', value: '{{image}}', kind: 'file' }],
        { image: source },
        fetcher
      )
    ).rejects.toThrow(/自定义接口文件地址/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-image and oversized remote file responses', async () => {
    const nonImageFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const oversizedFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(20 * 1024 * 1024 + 1),
        },
      })
    );
    const fields = [
      { name: 'image', value: '{{image}}', kind: 'file' as const },
    ];
    const variables = { image: 'https://cdn.example.com/reference.png' };

    await expect(
      buildManualHttpFormData(fields, variables, nonImageFetcher)
    ).rejects.toThrow('自定义接口文件不是图片');
    await expect(
      buildManualHttpFormData(fields, variables, oversizedFetcher)
    ).rejects.toThrow('自定义接口文件超过 20 MiB');
  });

  it('rejects redirected remote file responses even with a custom fetcher', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      redirected: true,
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      bodyUsed: false,
      body: { cancel },
    } as unknown as Response);

    await expect(
      buildManualHttpFormData(
        [{ name: 'image', value: '{{image}}', kind: 'file' }],
        { image: 'https://cdn.example.com/reference.png' },
        fetcher
      )
    ).rejects.toThrow('自定义接口文件不允许重定向');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds total form file items and text bytes', async () => {
    const image = 'data:image/png;base64,aW1hZ2U=';
    const fileFields = Array.from({ length: 17 }, (_, index) => ({
      name: `image-${index}`,
      value: '{{image}}',
      kind: 'file' as const,
    }));

    await expect(
      buildManualHttpFormData(fileFields, { image })
    ).rejects.toThrow('自定义接口表单文件数量超过 16 个');
    await expect(
      buildManualHttpFormData([{ name: 'prompt', value: '{{prompt}}' }], {
        prompt: 'a'.repeat(1024 * 1024 + 1),
      })
    ).rejects.toThrow('自定义接口表单文本总大小超过 1 MiB');
  });

  it('applies the remaining aggregate budget before appending the next file', async () => {
    const base64ToBlob = vi
      .spyOn(aituUtils, 'base64ToBlob')
      .mockImplementation(() => {
        const blob = new Blob(['x'], { type: 'image/png' });
        Object.defineProperty(blob, 'size', { value: 20 * 1024 * 1024 });
        return blob;
      });

    try {
      await expect(
        buildManualHttpFormData(
          [
            {
              name: 'images',
              value: '{{images}}',
              kind: 'file-list',
            },
          ],
          {
            images: Array.from(
              { length: 4 },
              () => 'data:image/png;base64,aW1hZ2U='
            ),
          }
        )
      ).rejects.toThrow('自定义接口表单文件总大小超过 64 MiB');
      expect(base64ToBlob).toHaveBeenCalledTimes(4);
    } finally {
      base64ToBlob.mockRestore();
    }
  });

  it('stops streaming a remote image after the actual byte limit', async () => {
    const tooLargeChunk = { byteLength: 20 * 1024 * 1024 + 1 } as Uint8Array;
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      redirected: false,
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      bodyUsed: false,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValue({ done: false, value: tooLargeChunk }),
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response);

    await expect(
      buildManualHttpFormData(
        [{ name: 'image', value: '{{image}}', kind: 'file' }],
        { image: 'https://cdn.example.com/reference.png' },
        fetcher
      )
    ).rejects.toThrow('自定义接口文件超过 20 MiB');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight remote image stream with the request signal', async () => {
    const controller = new AbortController();
    const abortReason = new Error('cancel custom form file');
    let finishRead:
      | ((result: { done: true; value?: never }) => void)
      | undefined;
    const read = vi.fn(
      () =>
        new Promise<{ done: true; value?: never }>((resolve) => {
          finishRead = resolve;
        })
    );
    const cancel = vi.fn().mockImplementation(async () => {
      finishRead?.({ done: true });
    });
    const releaseLock = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue({
      redirected: false,
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      bodyUsed: false,
      body: {
        getReader: () => ({ read, cancel, releaseLock }),
      },
    } as unknown as Response);

    const pending = buildManualHttpFormData(
      [{ name: 'image', value: '{{image}}', kind: 'file' }],
      { image: 'https://cdn.example.com/reference.png' },
      fetcher,
      controller.signal
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    controller.abort(abortReason);

    await expect(pending).rejects.toBe(abortReason);
    expect(cancel).toHaveBeenCalledWith(abortReason);
    expect(releaseLock).toHaveBeenCalledTimes(1);
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
