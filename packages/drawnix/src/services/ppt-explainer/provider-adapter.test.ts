import { describe, expect, it, vi } from 'vitest';
import type { InvocationPlan, ProviderModelBinding } from '../provider-routing';
import {
  PPT_EXPLAINER_PROVIDER_PROTOCOL,
  PPT_EXPLAINER_REQUEST_SCHEMA,
  PPT_EXPLAINER_RESPONSE_SCHEMA,
  preflightPptExplainerProvider,
  type PptExplainerProviderPreflightResult,
} from './provider-contract';
import {
  PptExplainerProviderError,
  cancelPptExplainerProviderJob,
  pollPptExplainerProviderJob,
  submitPptExplainerProviderJob,
} from './provider-adapter';

function createRoute(
  options: {
    input?: 'pptx' | 'slide_images';
    cancel?: boolean;
    referenceAudio?: boolean;
  } = {}
): PptExplainerProviderPreflightResult {
  const binding: ProviderModelBinding = {
    id: 'provider-a:ppt-explainer',
    profileId: 'provider-a',
    modelId: 'ppt-agent',
    operation: 'video',
    protocol: PPT_EXPLAINER_PROVIDER_PROTOCOL,
    requestSchema: PPT_EXPLAINER_REQUEST_SCHEMA,
    responseSchema: PPT_EXPLAINER_RESPONSE_SCHEMA,
    submitPath: '/ppt/jobs',
    pollPathTemplate: '/ppt/jobs/{remoteId}',
    priority: 100,
    confidence: 'high',
    source: 'manual',
    metadata: {
      pptExplainer: {
        capabilities: {
          sources: ['current_ppt', 'pptx'],
          presentationInputs: ['pptx', 'slide_images'],
          presenterModes: ['dual_voice'],
          finalComposition: true,
          ...(options.referenceAudio
            ? { referenceAudioVoiceCloning: true }
            : {}),
        },
        ...(options.referenceAudio
          ? {
              referenceAudio: {
                fieldName: 'voice_references[]',
                acceptedMimeTypes: ['audio/mpeg', 'audio/wav'],
              },
            }
          : {}),
        responsePaths: {
          submit: {
            remoteId: 'job.id',
            status: 'job.status',
            error: 'error.message',
          },
          poll: {
            status: 'job.status',
            progress: 'job.progress',
            finalVideoUrl: 'job.video.url',
            error: 'error.message',
          },
          cancel: {
            status: 'job.status',
            error: 'error.message',
          },
        },
        statusMapping: {
          queued: ['queued'],
          processing: ['processing'],
          completed: ['completed'],
          failed: ['failed'],
          cancelled: ['cancelled'],
        },
        progressScale: 'ratio',
        ...(options.cancel
          ? {
              cancel: {
                pathTemplate: '/ppt/jobs/{remoteId}/cancel',
                method: 'POST' as const,
              },
            }
          : {}),
      },
    },
  };
  const plan: InvocationPlan = {
    provider: {
      profileId: 'provider-a',
      profileName: 'Provider A',
      providerType: 'custom',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'provider-secret-key',
      authType: 'bearer',
    },
    modelRef: { profileId: 'provider-a', modelId: 'ppt-agent' },
    binding,
  };
  return preflightPptExplainerProvider(plan, {
    source: options.input === 'pptx' ? 'pptx' : 'current_ppt',
    presentationInput: options.input || 'slide_images',
    presenterMode: 'dual_voice',
    requiresReferenceAudio: options.referenceAudio,
  });
}

describe('PPT explainer provider adapter', () => {
  it('submits ordered slide blobs with idempotency and no credential in manifest', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = init?.body as FormData;
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          'Bearer provider-secret-key'
        );
        expect(
          (init?.headers as Record<string, string>)['Idempotency-Key']
        ).toBe('job-123');
        expect(JSON.parse(String(body.get('manifest')))).toEqual({
          schemaVersion: 1,
          jobId: 'job-123',
        });
        expect(body.getAll('slides[]')).toHaveLength(2);
        return Response.json({ job: { id: 'remote-1', status: 'queued' } });
      });

    const result = await submitPptExplainerProviderJob({
      route: createRoute(),
      manifest: { schemaVersion: 1, jobId: 'job-123' },
      idempotencyKey: 'job-123',
      slides: [
        { pageIndex: 2, blob: new Blob(['two'], { type: 'image/png' }) },
        { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
      ],
      fetcher,
    });

    expect(result).toMatchObject({
      remoteId: 'remote-1',
      status: 'queued',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('consumes async slide blobs serially without changing multipart fields', async () => {
    let liveSourceBlobs = 0;
    let peakSourceBlobs = 0;
    async function* createSlides() {
      for (const pageIndex of [1, 2]) {
        liveSourceBlobs += 1;
        peakSourceBlobs = Math.max(peakSourceBlobs, liveSourceBlobs);
        try {
          yield {
            pageIndex,
            blob: new Blob([`slide-${pageIndex}`], { type: 'image/png' }),
          };
        } finally {
          liveSourceBlobs -= 1;
        }
      }
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = init?.body as FormData;
        expect(liveSourceBlobs).toBe(0);
        expect(body.getAll('slides[]')).toHaveLength(2);
        expect(body.has('manifest')).toBe(true);
        return Response.json({
          job: { id: 'remote-stream', status: 'queued' },
        });
      });

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute(),
        manifest: { schemaVersion: 1, jobId: 'job-stream' },
        idempotencyKey: 'job-stream',
        slides: createSlides(),
        fetcher,
      })
    ).resolves.toMatchObject({ remoteId: 'remote-stream' });
    expect(peakSourceBlobs).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('submits two voice samples using manifest assetName associations', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = init?.body as FormData;
        expect(body.getAll('voice_references[]')).toHaveLength(2);
        const manifest = JSON.parse(String(body.get('manifest')));
        expect(JSON.stringify(manifest)).not.toContain('/__aitu_internal__');
        expect(manifest.speakers).toEqual([
          {
            id: 'host',
            voiceReference: { assetName: 'voice-reference-01.mp3' },
          },
          {
            id: 'guest',
            voiceReference: { assetName: 'voice-reference-02.wav' },
          },
        ]);
        return Response.json({
          job: { id: 'remote-voice', status: 'queued' },
        });
      });

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute({ referenceAudio: true }),
        manifest: {
          schemaVersion: 1,
          speakers: [
            {
              id: 'host',
              voiceReference: { assetName: 'voice-reference-01.mp3' },
            },
            {
              id: 'guest',
              voiceReference: { assetName: 'voice-reference-02.wav' },
            },
          ],
        },
        idempotencyKey: 'job-voice',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        voiceReferences: [
          {
            assetName: 'voice-reference-01.mp3',
            blob: new Blob(['host'], { type: 'audio/mpeg' }),
            filename: 'voice-reference-01.mp3',
          },
          {
            assetName: 'voice-reference-02.wav',
            blob: new Blob(['guest'], { type: 'audio/wav' }),
            filename: 'voice-reference-02.wav',
          },
        ],
        fetcher,
      })
    ).resolves.toMatchObject({ remoteId: 'remote-voice' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported or mismatched voice samples before any request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const manifest = {
      schemaVersion: 1,
      speakers: [
        {
          id: 'host',
          voiceReference: { assetName: 'voice-reference-01.mp3' },
        },
      ],
    };

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute(),
        manifest,
        idempotencyKey: 'job-unsupported-voice',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        voiceReferences: [
          {
            assetName: 'voice-reference-01.mp3',
            blob: new Blob(['voice'], { type: 'audio/mpeg' }),
          },
        ],
        fetcher,
      })
    ).rejects.toThrow('未声明参考音频');

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute({ referenceAudio: true }),
        manifest,
        idempotencyKey: 'job-mismatched-voice',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        voiceReferences: [
          {
            assetName: 'different.mp3',
            blob: new Blob(['voice'], { type: 'audio/mpeg' }),
          },
        ],
        fetcher,
      })
    ).rejects.toThrow('未在 manifest 中声明');

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute({ referenceAudio: true }),
        manifest,
        idempotencyKey: 'job-fake-voice',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        voiceReferences: [
          {
            assetName: 'voice-reference-01.mp3',
            blob: new Blob(['not-audio'], { type: 'image/png' }),
            mimeType: 'audio/mpeg',
          },
        ],
        fetcher,
      })
    ).rejects.toThrow('Blob 类型无效');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects base64 audio hidden in the manifest', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      submitPptExplainerProviderJob({
        route: createRoute(),
        manifest: {
          schemaVersion: 1,
          audio: 'data:audio/mpeg;base64,QUJDRA==',
        },
        idempotencyKey: 'job-base64-audio',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        fetcher,
      })
    ).rejects.toThrow('base64');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects out-of-order async slides before making a remote request', async () => {
    async function* createSlides() {
      yield { pageIndex: 2, blob: new Blob(['two']) };
      yield { pageIndex: 1, blob: new Blob(['one']) };
    }
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute(),
        manifest: { schemaVersion: 1 },
        idempotencyKey: 'job-out-of-order',
        slides: createSlides(),
        fetcher,
      })
    ).rejects.toThrow('必须按 pageIndex 递增提供');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes poll progress and requires a final HTTP(S) URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        job: {
          status: 'completed',
          progress: 1,
          video: { url: 'https://cdn.example.com/final.mp4' },
        },
      })
    );

    await expect(
      pollPptExplainerProviderJob({
        route: createRoute(),
        remoteId: 'remote/1',
        fetcher,
      })
    ).resolves.toMatchObject({
      remoteId: 'remote/1',
      status: 'completed',
      progress: 100,
      finalVideoUrl: 'https://cdn.example.com/final.mp4',
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/remote%2F1');

    fetcher.mockResolvedValueOnce(
      Response.json({ job: { status: 'completed', progress: 1 } })
    );
    await expect(
      pollPptExplainerProviderJob({
        route: createRoute(),
        remoteId: 'remote-2',
        fetcher,
      })
    ).rejects.toThrow('未返回可用的最终视频 URL');
  });

  it.each([
    'http://localhost/final.mp4',
    'http://127.0.0.1/final.mp4',
    'http://169.254.169.254/final.mp4',
    'http://192.168.1.10/final.mp4',
    'https://user:password@cdn.example.com/final.mp4',
  ])('rejects non-public final video URL: %s', async (finalVideoUrl) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        job: {
          status: 'completed',
          video: { url: finalVideoUrl },
        },
      })
    );

    await expect(
      pollPptExplainerProviderJob({
        route: createRoute(),
        remoteId: 'remote-private-video',
        fetcher,
      })
    ).rejects.toThrow('未返回可用的最终视频 URL');
  });

  it('does not call the network when input or manifest validation fails', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      submitPptExplainerProviderJob({
        route: createRoute(),
        manifest: {
          schemaVersion: 1,
          apiKey: 'must-not-persist',
        },
        idempotencyKey: 'job-123',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        fetcher,
      })
    ).rejects.toThrow('不得包含凭据字段');
    await expect(
      submitPptExplainerProviderJob({
        route: createRoute(),
        manifest: { schemaVersion: 1 },
        idempotencyKey: 'job-123',
        slides: [],
        fetcher,
      })
    ).rejects.toThrow('没有可提交页面');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('revalidates every endpoint immediately before remote side effects', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const submitRoute = createRoute();
    submitRoute.binding.submitPath = 'https://attacker.example/ppt/jobs';
    await expect(
      submitPptExplainerProviderJob({
        route: submitRoute,
        manifest: { schemaVersion: 1 },
        idempotencyKey: 'job-unsafe-submit',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        fetcher,
      })
    ).rejects.toThrow('提交路径不得跨越供应商 Base URL');

    const pollRoute = createRoute();
    pollRoute.binding.pollPathTemplate =
      'https://attacker.example/ppt/jobs/{remoteId}';
    await expect(
      pollPptExplainerProviderJob({
        route: pollRoute,
        remoteId: 'remote-unsafe-poll',
        fetcher,
      })
    ).rejects.toThrow('查询路径不得跨越供应商 Base URL');

    const cancelRoute = createRoute({ cancel: true });
    const metadata = cancelRoute.binding.metadata.pptExplainer;
    if (!metadata.cancel) throw new Error('测试 binding 缺少取消能力');
    metadata.cancel.pathTemplate =
      'https://attacker.example/ppt/jobs/{remoteId}/cancel';
    await expect(
      cancelPptExplainerProviderJob({
        route: cancelRoute,
        remoteId: 'remote-unsafe-cancel',
        fetcher,
      })
    ).rejects.toThrow('取消路径不得跨越供应商 Base URL');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a submit route changed while consuming streamed slides', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const route = createRoute();
    async function* createSlides() {
      route.binding.submitPath = 'https://attacker.example/ppt/jobs';
      yield {
        pageIndex: 1,
        blob: new Blob(['one'], { type: 'image/png' }),
      };
    }

    await expect(
      submitPptExplainerProviderJob({
        route,
        manifest: { schemaVersion: 1 },
        idempotencyKey: 'job-mutated-during-stream',
        slides: createSlides(),
        fetcher,
      })
    ).rejects.toThrow('提交路径不得跨越供应商 Base URL');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('supports PPTX upload without reading the Blob into task metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = init?.body as FormData;
        expect(body.get('presentation')).toBeInstanceOf(Blob);
        expect(body.getAll('slides[]')).toHaveLength(0);
        return Response.json({ job: { id: 'remote-pptx', status: 'queued' } });
      });

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute({ input: 'pptx' }),
        manifest: { schemaVersion: 1, source: 'pptx' },
        idempotencyKey: 'pptx-job',
        presentation: new Blob(['pptx'], {
          type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }),
        presentationFilename: 'deck.pptx',
        fetcher,
      })
    ).resolves.toMatchObject({ remoteId: 'remote-pptx' });
  });

  it('skips remote cancel when unsupported and calls configured cancel once', async () => {
    const unsupportedFetcher = vi.fn<typeof fetch>();
    await expect(
      cancelPptExplainerProviderJob({
        route: createRoute(),
        remoteId: 'remote-1',
        fetcher: unsupportedFetcher,
      })
    ).resolves.toMatchObject({ attempted: false, status: 'cancelled' });
    expect(unsupportedFetcher).not.toHaveBeenCalled();

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ job: { status: 'cancelled' } }));
    await expect(
      cancelPptExplainerProviderJob({
        route: createRoute({ cancel: true }),
        remoteId: 'remote-1',
        idempotencyKey: 'job-123',
        fetcher,
      })
    ).resolves.toMatchObject({
      attempted: true,
      remoteId: 'remote-1',
      status: 'cancelled',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves provider HTTP status while redacting credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            message: 'Authorization: Bearer provider-secret-key quota exceeded',
          },
        },
        { status: 429 }
      )
    );

    const promise = submitPptExplainerProviderJob({
      route: createRoute(),
      manifest: { schemaVersion: 1 },
      idempotencyKey: 'job-123',
      slides: [
        { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
      ],
      fetcher,
    });
    await expect(promise).rejects.toMatchObject<
      Partial<PptExplainerProviderError>
    >({ code: 'http_error', httpStatus: 429 });
    await expect(promise).rejects.not.toThrow('provider-secret-key');
  });

  it('redacts encoded API key and sensitive extra-header values', async () => {
    const route = createRoute();
    const apiKey = 'provider/secret value';
    const headerSecret = 'header/secret value';
    route.provider.apiKey = apiKey;
    route.provider.extraHeaders = {
      'X-Provider-Secret': headerSecret,
      'X-Trace-Label': 'diagnostic-label',
    };
    const encodedApiKey = encodeURIComponent(apiKey);
    const encodedHeaderSecret = encodeURIComponent(headerSecret);
    const uriEncodedApiKey = encodeURI(apiKey);
    const uriEncodedHeaderSecret = encodeURI(headerSecret);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            message: [
              apiKey,
              encodedApiKey,
              uriEncodedApiKey,
              headerSecret,
              encodedHeaderSecret,
              uriEncodedHeaderSecret,
              'diagnostic-label',
            ].join(' | '),
          },
        },
        { status: 403 }
      )
    );

    const promise = submitPptExplainerProviderJob({
      route,
      manifest: { schemaVersion: 1 },
      idempotencyKey: 'job-secret-redaction',
      slides: [
        { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
      ],
      fetcher,
    });
    await expect(promise).rejects.toMatchObject({
      code: 'http_error',
      httpStatus: 403,
    });
    await expect(promise).rejects.not.toThrow(apiKey);
    await expect(promise).rejects.not.toThrow(encodedApiKey);
    await expect(promise).rejects.not.toThrow(uriEncodedApiKey);
    await expect(promise).rejects.not.toThrow(headerSecret);
    await expect(promise).rejects.not.toThrow(encodedHeaderSecret);
    await expect(promise).rejects.not.toThrow(uriEncodedHeaderSecret);
    await expect(promise).rejects.toThrow('diagnostic-label');
  });

  it.each([401, 403, 500, 503])(
    'preserves HTTP %s failures for actionable diagnostics',
    async (httpStatus) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { message: `provider rejected request (${httpStatus})` } },
            { status: httpStatus }
          )
        );

      await expect(
        submitPptExplainerProviderJob({
          route: createRoute(),
          manifest: { schemaVersion: 1 },
          idempotencyKey: `job-${httpStatus}`,
          slides: [
            { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
          ],
          fetcher,
        })
      ).rejects.toMatchObject<Partial<PptExplainerProviderError>>({
        code: 'http_error',
        httpStatus,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('preserves response read failures instead of misreporting an empty payload', async () => {
    const responseReadError = new Error('response stream interrupted');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(responseReadError);
          },
        }),
        { status: 200 }
      )
    );

    await expect(
      submitPptExplainerProviderJob({
        route: createRoute(),
        manifest: { schemaVersion: 1 },
        idempotencyKey: 'job-123',
        slides: [
          { pageIndex: 1, blob: new Blob(['one'], { type: 'image/png' }) },
        ],
        fetcher,
      })
    ).rejects.toBe(responseReadError);
  });
});
