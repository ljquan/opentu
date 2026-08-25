import {
  PPTX_IMPORT_RENDERER,
  PPTX_IMPORT_RENDERER_VERSION,
  PPTX_IMPORT_SCHEMA_VERSION,
  PPTX_MIME_TYPE,
  PptxImportError,
  createPptxImportCancelledError,
  type PptxCachedSource,
  type PptxImportCache,
  type PptxImportCheckpoint,
  type PptxImportMode,
  type PptxImportOptions,
  type PptxImportedSlide,
  type PptxImportPackageMetadata,
  type PptxImportProgress,
  type PptxImportWorkerCommand,
  type PptxImportWorkerEvent,
} from './pptx-import.types';

const INTERNAL_MEDIA_CACHE_NAME = 'drawnix-images';
const INTERNAL_CACHE_PREFIX = '/__aitu_cache__/pptx-import/';
const DEFAULT_IMPORT_MODE: PptxImportMode = 'slide-images';

let queueTail: Promise<void> = Promise.resolve();
let queuedImports = 0;
let activeImports = 0;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createPptxImportCancelledError(signal.reason);
  }
}

function resolveCacheKey(url: string): string {
  if (typeof globalThis.location !== 'undefined') {
    return new URL(url, globalThis.location.origin).toString();
  }
  return url;
}

export const browserPptxImportCache: PptxImportCache = {
  async put(url, blob) {
    if (typeof caches === 'undefined') {
      throw new PptxImportError(
        'cache-unavailable',
        'environment',
        '当前浏览器环境不支持 Cache Storage，无法持久化 PPTX 导入结果'
      );
    }
    const cache = await caches.open(INTERNAL_MEDIA_CACHE_NAME);
    await cache.put(
      resolveCacheKey(url),
      new Response(blob, {
        headers: {
          'Content-Type': blob.type || 'application/octet-stream',
          'Content-Length': String(blob.size),
          'sw-cache-date': String(Date.now()),
          'sw-image-size': String(blob.size),
          'x-aitu-internal-result': 'pptx-import',
        },
      })
    );
  },

  async get(url) {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(INTERNAL_MEDIA_CACHE_NAME);
    const response = await cache.match(resolveCacheKey(url));
    return response ? response.blob() : null;
  },

  async delete(url) {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(INTERNAL_MEDIA_CACHE_NAME);
    await cache.delete(resolveCacheKey(url));
  },
};

function defaultWorkerFactory(): Worker {
  if (typeof Worker === 'undefined') {
    throw new PptxImportError(
      'worker-unavailable',
      'environment',
      '当前浏览器环境不支持 PPTX 导入 Worker'
    );
  }
  return new Worker(new URL('./pptx-import.worker.ts', import.meta.url), {
    type: 'module',
    name: 'opentu-pptx-import',
  });
}

function validateJobId(jobId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(jobId)) {
    throw new PptxImportError(
      'invalid-file',
      'input',
      'PPTX 导入任务 ID 格式无效'
    );
  }
  return jobId;
}

function resolveImportMode(value: unknown): PptxImportMode {
  if (value === undefined) return DEFAULT_IMPORT_MODE;
  if (value === 'cache-only' || value === 'slide-images') return value;
  throw new PptxImportError(
    'invalid-file',
    'input',
    'PPTX 导入模式无效，请重新开始导入'
  );
}

function buildSourceCacheUrl(jobId: string, fingerprint: string): string {
  return `${INTERNAL_CACHE_PREFIX}${jobId}/${fingerprint}/source.pptx`;
}

function buildSlideCacheUrl(
  jobId: string,
  fingerprint: string,
  pageIndex: number
): string {
  return `${INTERNAL_CACHE_PREFIX}${jobId}/${fingerprint}/slide-${pageIndex}.svg`;
}

function cloneCheckpoint(
  checkpoint: PptxImportCheckpoint
): PptxImportCheckpoint {
  return {
    ...checkpoint,
    source: { ...checkpoint.source },
    slideSize: { ...checkpoint.slideSize },
    slides: checkpoint.slides.map((slide) => ({
      ...slide,
      diagnostics: slide.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    })),
    diagnostics: checkpoint.diagnostics.map((diagnostic) => ({
      ...diagnostic,
    })),
    renderer: { ...checkpoint.renderer },
  };
}

function reportProgress(
  callback: PptxImportOptions['onProgress'],
  progress: PptxImportProgress
): void {
  callback?.(progress);
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(createPptxImportCancelledError(signal.reason));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(createPptxImportCancelledError(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function enqueueImport<T>(
  run: () => Promise<T>,
  options: Pick<PptxImportOptions, 'signal' | 'onProgress'>
): Promise<T> {
  queuedImports += 1;
  reportProgress(options.onProgress, {
    phase: 'queued',
    queuePosition: queuedImports,
  });

  const execution = queueTail.then(async () => {
    queuedImports = Math.max(0, queuedImports - 1);
    throwIfAborted(options.signal);
    activeImports += 1;
    try {
      return await run();
    } finally {
      activeImports = Math.max(0, activeImports - 1);
    }
  });
  queueTail = execution.then(
    () => undefined,
    () => undefined
  );
  return raceWithAbort(execution, options.signal);
}

export function getPptxImportQueueState(): {
  active: number;
  queued: number;
} {
  return { active: activeImports, queued: queuedImports };
}

function newRequestId(jobId: string): string {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${jobId}:${suffix}`;
}

function wrapCacheError(error: unknown, action: string): PptxImportError {
  if (error instanceof PptxImportError) return error;
  const detail =
    error instanceof Error
      ? `${error.name}${error.message ? `: ${error.message}` : ''}`
      : String(error);
  return new PptxImportError(
    'cache-write-failed',
    'environment',
    `${action}失败（${detail}）`,
    { cause: error }
  );
}

async function notifyCheckpoint(
  checkpoint: PptxImportCheckpoint,
  callback: PptxImportOptions['onCheckpoint']
): Promise<void> {
  await callback?.(cloneCheckpoint(checkpoint));
}

function createSourceMetadata(
  metadata: PptxImportPackageMetadata,
  source: {
    cacheUrl: string;
    fileName: string;
    mimeType: string;
    size: number;
    lastModified?: number;
  }
): PptxCachedSource {
  return {
    ...source,
    fingerprint: metadata.fingerprint,
    fingerprintAlgorithm: metadata.fingerprintAlgorithm,
  };
}

function createInitialCheckpoint(
  jobId: string,
  metadata: PptxImportPackageMetadata,
  source: PptxCachedSource,
  existingSlides: PptxImportedSlide[],
  mode: PptxImportMode
): PptxImportCheckpoint {
  const packageSlideByPage = new Map(
    metadata.slides.map((slide) => [slide.pageIndex, slide])
  );
  const slides =
    mode === 'cache-only'
      ? metadata.slides.map((slide) => ({
          pageIndex: slide.pageIndex,
          ...(slide.notes ? { notes: slide.notes } : {}),
          diagnostics: metadata.diagnostics
            .filter((diagnostic) => diagnostic.pageIndex === slide.pageIndex)
            .map((diagnostic) => ({ ...diagnostic })),
        }))
      : existingSlides
          .map((slide) => {
            const packageSlide = packageSlideByPage.get(slide.pageIndex);
            return {
              ...slide,
              ...(packageSlide?.notes
                ? { notes: packageSlide.notes }
                : { notes: undefined }),
              diagnostics: slide.diagnostics.map((diagnostic) => ({
                ...diagnostic,
              })),
            };
          })
          .sort((left, right) => left.pageIndex - right.pageIndex);
  return {
    schemaVersion: PPTX_IMPORT_SCHEMA_VERSION,
    jobId,
    mode,
    status:
      mode === 'slide-images' && existingSlides.length > 0
        ? 'rendering'
        : 'validated',
    source,
    slideSize: { ...metadata.slideSize },
    slideCount: metadata.slides.length,
    slides,
    diagnostics: metadata.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    renderer: {
      name: PPTX_IMPORT_RENDERER,
      version: PPTX_IMPORT_RENDERER_VERSION,
      outputMimeType: 'image/svg+xml',
    },
  };
}

async function findCachedSlides(
  checkpoint: PptxImportCheckpoint,
  cache: PptxImportCache,
  signal?: AbortSignal
): Promise<PptxImportedSlide[]> {
  const available: PptxImportedSlide[] = [];
  const seen = new Set<number>();
  for (const slide of checkpoint.slides) {
    throwIfAborted(signal);
    if (
      !slide.cacheUrl ||
      !Number.isSafeInteger(slide.pageIndex) ||
      slide.pageIndex < 1 ||
      slide.pageIndex > checkpoint.slideCount ||
      seen.has(slide.pageIndex)
    ) {
      continue;
    }
    const blob = await cache.get(slide.cacheUrl);
    throwIfAborted(signal);
    if (blob && blob.size > 0) {
      available.push({
        ...slide,
        diagnostics: slide.diagnostics.map((diagnostic) => ({
          ...diagnostic,
        })),
      });
      seen.add(slide.pageIndex);
    }
  }
  return available;
}

interface WorkerExecutionSource {
  blob: Blob;
  fileName: string;
  mimeType: string;
  size: number;
  lastModified?: number;
  expected?: PptxImportCheckpoint;
}

async function executeWorkerImport(
  sourceInput: WorkerExecutionSource,
  options: PptxImportOptions
): Promise<PptxImportCheckpoint> {
  const jobId = validateJobId(options.jobId);
  const mode = resolveImportMode(options.mode ?? sourceInput.expected?.mode);
  const cache = options.cache || browserPptxImportCache;
  const existingSlides =
    mode === 'slide-images' && sourceInput.expected
      ? await findCachedSlides(sourceInput.expected, cache, options.signal)
      : [];
  throwIfAborted(options.signal);

  const requestId = newRequestId(jobId);
  const worker = (options.workerFactory || defaultWorkerFactory)();
  const unpublishedCacheUrls = new Set<string>();
  const pendingCacheWrites = new Set<Promise<void>>();
  let checkpointPublished = Boolean(sourceInput.expected);
  let abortListener: (() => void) | undefined;

  const putUnpublishedCache = async (
    url: string,
    blob: Blob
  ): Promise<void> => {
    unpublishedCacheUrls.add(url);
    const write = cache.put(url, blob);
    pendingCacheWrites.add(write);
    try {
      await write;
    } finally {
      pendingCacheWrites.delete(write);
    }
  };

  try {
    return await new Promise<PptxImportCheckpoint>((resolve, reject) => {
      let settled = false;
      let checkpoint: PptxImportCheckpoint | null = null;
      const packageSlideByPage = new Map<
        number,
        PptxImportPackageMetadata['slides'][number]
      >();

      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const resolveOnce = (value: PptxImportCheckpoint): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const continueWorker = (): void => {
        if (settled) return;
        const command: PptxImportWorkerCommand = {
          type: 'continue',
          requestId,
        };
        worker.postMessage(command);
      };

      const handleValidated = async (
        metadata: PptxImportPackageMetadata
      ): Promise<void> => {
        throwIfAborted(options.signal);
        if (metadata.slides.length === 0) {
          throw new PptxImportError(
            'empty-presentation',
            'input',
            'PPTX 不包含任何页面'
          );
        }
        if (sourceInput.expected) {
          const expectedSource = sourceInput.expected.source;
          if (
            expectedSource.size !== sourceInput.size ||
            expectedSource.fingerprint !== metadata.fingerprint ||
            expectedSource.fingerprintAlgorithm !==
              metadata.fingerprintAlgorithm
          ) {
            throw new PptxImportError(
              'cached-input-mismatch',
              'input',
              '缓存中的 PPTX 与原导入文件身份不一致，请重新选择原文件'
            );
          }
        }
        for (const slide of metadata.slides) {
          packageSlideByPage.set(slide.pageIndex, slide);
        }

        const sourceCacheUrl =
          sourceInput.expected?.source.cacheUrl ||
          buildSourceCacheUrl(jobId, metadata.fingerprint);
        if (!sourceInput.expected) {
          reportProgress(options.onProgress, { phase: 'caching-source' });
          try {
            await putUnpublishedCache(sourceCacheUrl, sourceInput.blob);
          } catch (error) {
            throw wrapCacheError(error, '缓存原始 PPTX');
          }
        }
        throwIfAborted(options.signal);

        checkpoint = createInitialCheckpoint(
          jobId,
          metadata,
          createSourceMetadata(metadata, {
            cacheUrl: sourceCacheUrl,
            fileName: sourceInput.fileName,
            mimeType: sourceInput.mimeType || PPTX_MIME_TYPE,
            size: sourceInput.size,
            ...(sourceInput.lastModified !== undefined
              ? { lastModified: sourceInput.lastModified }
              : {}),
          }),
          existingSlides,
          mode
        );
        await notifyCheckpoint(checkpoint, options.onCheckpoint);
        checkpointPublished = true;
        unpublishedCacheUrls.clear();
        throwIfAborted(options.signal);
        if (mode === 'slide-images') {
          reportProgress(options.onProgress, {
            phase: 'rendering',
            completedPages: checkpoint.slides.length,
            totalPages: checkpoint.slideCount,
          });
        }
        continueWorker();
      };

      const handleSlide = async (
        event: Extract<PptxImportWorkerEvent, { type: 'slide' }>
      ): Promise<void> => {
        throwIfAborted(options.signal);
        if (mode !== 'slide-images') {
          throw new PptxImportError(
            'worker-failed',
            'environment',
            'PPTX Worker 在仅校验模式下返回了页面快照'
          );
        }
        if (!checkpoint) {
          throw new PptxImportError(
            'worker-failed',
            'environment',
            'PPTX Worker 在结构校验前返回了页面'
          );
        }
        const packageSlide = packageSlideByPage.get(event.pageIndex);
        if (
          !packageSlide ||
          checkpoint.slides.some(
            (existing) => existing.pageIndex === event.pageIndex
          ) ||
          event.blob.size === 0
        ) {
          throw new PptxImportError(
            'worker-failed',
            'environment',
            `PPTX Worker 返回了无效的第 ${event.pageIndex} 页`
          );
        }
        const cacheUrl = buildSlideCacheUrl(
          jobId,
          checkpoint.source.fingerprint,
          event.pageIndex
        );
        reportProgress(options.onProgress, {
          phase: 'caching-slide',
          pageIndex: event.pageIndex,
          completedPages: checkpoint.slides.length,
          totalPages: checkpoint.slideCount,
        });
        try {
          await putUnpublishedCache(cacheUrl, event.blob);
        } catch (error) {
          throw wrapCacheError(error, `缓存第 ${event.pageIndex} 页快照`);
        }
        throwIfAborted(options.signal);

        checkpoint.status = 'rendering';
        checkpoint.slides = [
          ...checkpoint.slides,
          {
            pageIndex: event.pageIndex,
            cacheUrl,
            ...(packageSlide.notes ? { notes: packageSlide.notes } : {}),
            diagnostics: [
              ...checkpoint.diagnostics.filter(
                (diagnostic) => diagnostic.pageIndex === event.pageIndex
              ),
              ...event.diagnostics,
            ],
          },
        ].sort((left, right) => left.pageIndex - right.pageIndex);
        await notifyCheckpoint(checkpoint, options.onCheckpoint);
        unpublishedCacheUrls.delete(cacheUrl);
        throwIfAborted(options.signal);
        reportProgress(options.onProgress, {
          phase: 'rendering',
          pageIndex: event.pageIndex,
          completedPages: checkpoint.slides.length,
          totalPages: checkpoint.slideCount,
        });
        continueWorker();
      };

      const handleEvent = async (
        event: PptxImportWorkerEvent
      ): Promise<void> => {
        if (settled || event.requestId !== requestId) return;
        if (event.type === 'validated') {
          await handleValidated(event.metadata);
          return;
        }
        if (event.type === 'slide') {
          await handleSlide(event);
          return;
        }
        if (event.type === 'error') {
          throw new PptxImportError(
            event.error.code,
            event.error.kind,
            event.error.message,
            { pageIndex: event.error.pageIndex }
          );
        }
        if (!checkpoint) {
          throw new PptxImportError(
            'worker-failed',
            'environment',
            'PPTX Worker 在结构校验前结束'
          );
        }
        if (checkpoint.slides.length !== checkpoint.slideCount) {
          throw new PptxImportError(
            mode === 'cache-only' ? 'worker-failed' : 'slide-render-failed',
            mode === 'cache-only' ? 'environment' : 'render',
            mode === 'cache-only'
              ? 'PPTX Worker 返回的页面元数据不完整'
              : 'PPTX 未能生成全部页面快照'
          );
        }
        if (
          mode === 'slide-images' &&
          checkpoint.slides.some((slide) => !slide.cacheUrl)
        ) {
          throw new PptxImportError(
            'slide-render-failed',
            'render',
            'PPTX 未能生成全部页面快照'
          );
        }
        checkpoint.status = 'completed';
        await notifyCheckpoint(checkpoint, options.onCheckpoint);
        reportProgress(options.onProgress, {
          phase: 'completed',
          completedPages: checkpoint.slideCount,
          totalPages: checkpoint.slideCount,
        });
        resolveOnce(cloneCheckpoint(checkpoint));
      };

      worker.onmessage = (event: MessageEvent<PptxImportWorkerEvent>): void => {
        void handleEvent(event.data).catch(rejectOnce);
      };
      worker.onerror = (event): void => {
        rejectOnce(
          new PptxImportError(
            'worker-failed',
            'environment',
            event.message || 'PPTX Worker 运行失败'
          )
        );
      };
      worker.onmessageerror = (): void => {
        rejectOnce(
          new PptxImportError(
            'worker-failed',
            'environment',
            'PPTX Worker 返回了无法读取的数据'
          )
        );
      };

      abortListener = (): void => {
        const command: PptxImportWorkerCommand = {
          type: 'cancel',
          requestId,
        };
        try {
          worker.postMessage(command);
        } finally {
          worker.terminate();
          rejectOnce(createPptxImportCancelledError(options.signal?.reason));
        }
      };
      options.signal?.addEventListener('abort', abortListener, { once: true });

      reportProgress(options.onProgress, { phase: 'validating' });
      const startCommand: PptxImportWorkerCommand = {
        type: 'start',
        requestId,
        source: sourceInput.blob,
        mode,
        skipPages: existingSlides.map((slide) => slide.pageIndex),
      };
      worker.postMessage(startCommand);
    });
  } catch (error) {
    if (!checkpointPublished || unpublishedCacheUrls.size > 0) {
      await Promise.allSettled(pendingCacheWrites);
      for (const url of unpublishedCacheUrls) {
        await cache.delete(url).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    if (abortListener) {
      options.signal?.removeEventListener('abort', abortListener);
    }
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  }
}

export function importPptx(
  file: File,
  options: PptxImportOptions
): Promise<PptxImportCheckpoint> {
  return enqueueImport(
    () =>
      executeWorkerImport(
        {
          blob: file,
          fileName: file.name || 'presentation.pptx',
          mimeType: file.type || PPTX_MIME_TYPE,
          size: file.size,
          lastModified: file.lastModified,
        },
        options
      ),
    options
  );
}

export function importPptxBlob(
  blob: Blob,
  fileName: string,
  options: PptxImportOptions
): Promise<PptxImportCheckpoint> {
  const normalizedFileName = fileName?.trim() || 'presentation.pptx';
  return enqueueImport(
    () =>
      executeWorkerImport(
        {
          blob,
          fileName: normalizedFileName,
          mimeType: blob.type || PPTX_MIME_TYPE,
          size: blob.size,
        },
        options
      ),
    options
  );
}

export async function resumePptxImport(
  checkpoint: PptxImportCheckpoint,
  options: Omit<PptxImportOptions, 'jobId'> = {}
): Promise<PptxImportCheckpoint> {
  const resolvedOptions: PptxImportOptions = {
    ...options,
    jobId: checkpoint.jobId,
    mode: resolveImportMode(options.mode ?? checkpoint.mode),
  };
  return enqueueImport(async () => {
    const cache = resolvedOptions.cache || browserPptxImportCache;
    const blob = await cache.get(checkpoint.source.cacheUrl);
    throwIfAborted(resolvedOptions.signal);
    if (!blob || blob.size === 0) {
      throw new PptxImportError(
        'cached-input-missing',
        'input',
        '原始 PPTX 缓存已被清理，请重新选择原文件或重新开始导入'
      );
    }
    if (blob.size !== checkpoint.source.size) {
      throw new PptxImportError(
        'cached-input-mismatch',
        'input',
        '缓存中的 PPTX 大小与原文件不一致，请重新选择原文件'
      );
    }
    return executeWorkerImport(
      {
        blob,
        fileName: checkpoint.source.fileName,
        mimeType: checkpoint.source.mimeType,
        size: checkpoint.source.size,
        lastModified: checkpoint.source.lastModified,
        expected: checkpoint,
      },
      resolvedOptions
    );
  }, resolvedOptions);
}

export async function deletePptxImportCache(
  checkpoint: PptxImportCheckpoint,
  cache: PptxImportCache = browserPptxImportCache
): Promise<void> {
  const urls = new Set([
    checkpoint.source.cacheUrl,
    ...checkpoint.slides.map((slide) => slide.cacheUrl),
  ]);
  for (const url of urls) {
    if (url) await cache.delete(url);
  }
}

export async function deletePptxImportCacheByJobId(
  jobId: string
): Promise<void> {
  const normalizedJobId = validateJobId(jobId);
  if (typeof caches === 'undefined') return;

  const cache = await caches.open(INTERNAL_MEDIA_CACHE_NAME);
  const prefix = resolveCacheKey(`${INTERNAL_CACHE_PREFIX}${normalizedJobId}/`);
  const requests = await cache.keys();
  for (const request of requests) {
    if (request.url.startsWith(prefix)) {
      await cache.delete(request);
    }
  }
}
