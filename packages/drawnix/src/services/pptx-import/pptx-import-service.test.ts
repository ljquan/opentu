import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deletePptxImportCache,
  deletePptxImportCacheByJobId,
  getPptxImportQueueState,
  importPptx,
  resumePptxImport,
} from './pptx-import-service';
import type {
  PptxImportCache,
  PptxImportPackageMetadata,
  PptxImportWorkerCommand,
  PptxImportWorkerEvent,
} from './pptx-import.types';

class MemoryImportCache implements PptxImportCache {
  readonly entries = new Map<string, Blob>();

  async put(url: string, blob: Blob): Promise<void> {
    this.entries.set(url, blob);
  }

  async get(url: string): Promise<Blob | null> {
    return this.entries.get(url) || null;
  }

  async delete(url: string): Promise<void> {
    this.entries.delete(url);
  }
}

function createMetadata(): PptxImportPackageMetadata {
  return {
    fingerprint: 'a'.repeat(64),
    fingerprintAlgorithm: 'sha256',
    slideSize: {
      widthEmu: 12192000,
      heightEmu: 6858000,
      aspectRatio: 16 / 9,
    },
    slides: [
      {
        pageIndex: 1,
        sourcePartPath: 'ppt/slides/slide1.xml',
        notes: '第一页备注',
      },
      { pageIndex: 2, sourcePartPath: 'ppt/slides/slide2.xml' },
    ],
    diagnostics: [],
  };
}

interface MockWorkerController {
  worker: Worker;
  startCommands: Array<Extract<PptxImportWorkerCommand, { type: 'start' }>>;
  terminated: ReturnType<typeof vi.fn>;
}

function createWorkerController(options?: {
  stalled?: boolean;
}): MockWorkerController {
  let onmessage: ((event: MessageEvent<PptxImportWorkerEvent>) => void) | null =
    null;
  let onerror: ((event: ErrorEvent) => void) | null = null;
  let onmessageerror: ((event: MessageEvent) => void) | null = null;
  let requestId = '';
  let mode: Extract<PptxImportWorkerCommand, { type: 'start' }>['mode'] =
    'slide-images';
  let nextPage = 0;
  let skipPages = new Set<number>();
  const startCommands: Array<
    Extract<PptxImportWorkerCommand, { type: 'start' }>
  > = [];
  const terminated = vi.fn();

  const emit = (event: PptxImportWorkerEvent): void => {
    queueMicrotask(() => onmessage?.({ data: event } as MessageEvent));
  };
  const emitNext = (): void => {
    const pages = [1, 2].filter((page) => !skipPages.has(page));
    if (nextPage >= pages.length) {
      emit({ type: 'complete', requestId });
      return;
    }
    const pageIndex = pages[nextPage];
    nextPage += 1;
    emit({
      type: 'slide',
      requestId,
      pageIndex,
      blob: new Blob([`<svg data-page="${pageIndex}"/>`], {
        type: 'image/svg+xml',
      }),
      diagnostics: [],
    });
  };

  const worker = {
    get onmessage() {
      return onmessage;
    },
    set onmessage(value) {
      onmessage = value;
    },
    get onerror() {
      return onerror;
    },
    set onerror(value) {
      onerror = value;
    },
    get onmessageerror() {
      return onmessageerror;
    },
    set onmessageerror(value) {
      onmessageerror = value;
    },
    postMessage(command: PptxImportWorkerCommand) {
      if (command.type === 'start') {
        startCommands.push(command);
        requestId = command.requestId;
        mode = command.mode;
        skipPages = new Set(command.skipPages);
        if (!options?.stalled) {
          emit({
            type: 'validated',
            requestId,
            metadata: createMetadata(),
          });
        }
      } else if (command.type === 'continue' && !options?.stalled) {
        if (mode === 'cache-only') {
          emit({ type: 'complete', requestId });
        } else {
          emitNext();
        }
      }
    },
    terminate: terminated,
  } as unknown as Worker;

  return { worker, startCommands, terminated };
}

function createInputFile(): File {
  return new File(['pptx-bytes'], 'deck.pptx', {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    lastModified: 123,
  });
}

describe('PPTX import service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies page-level backpressure and persists only lightweight URLs', async () => {
    const cache = new MemoryImportCache();
    const controller = createWorkerController();
    const checkpoints: string[] = [];

    const result = await importPptx(createInputFile(), {
      jobId: 'job-cache',
      cache,
      workerFactory: () => controller.worker,
      onCheckpoint: (checkpoint) => {
        checkpoints.push(JSON.stringify(checkpoint));
      },
    });

    expect(result.status).toBe('completed');
    expect(result.slides.map((slide) => slide.pageIndex)).toEqual([1, 2]);
    expect(controller.startCommands[0].mode).toBe('slide-images');
    expect(result.slides[0].notes).toBe('第一页备注');
    expect(cache.entries.size).toBe(3);
    expect(checkpoints).toHaveLength(4);
    expect(checkpoints.every((value) => !value.includes('pptx-bytes'))).toBe(
      true
    );
    expect(controller.terminated).toHaveBeenCalled();
    await deletePptxImportCache(result, cache);
    expect(cache.entries.size).toBe(0);
  });

  it('resumes from cached input and skips page snapshots that still exist', async () => {
    const cache = new MemoryImportCache();
    const firstWorker = createWorkerController();
    const initial = await importPptx(createInputFile(), {
      jobId: 'job-resume',
      cache,
      workerFactory: () => firstWorker.worker,
    });
    const missingSlideCacheUrl = initial.slides[1].cacheUrl;
    expect(missingSlideCacheUrl).toBeTruthy();
    if (!missingSlideCacheUrl) throw new Error('测试页面快照缓存缺失');
    await cache.delete(missingSlideCacheUrl);

    const resumeWorker = createWorkerController();
    const resumed = await resumePptxImport(initial, {
      cache,
      workerFactory: () => resumeWorker.worker,
    });

    expect(resumeWorker.startCommands[0].skipPages).toEqual([1]);
    expect(resumed.slides).toHaveLength(2);
    expect(resumed.status).toBe('completed');
  });

  it('validates and caches PPTX metadata without rendering slide images', async () => {
    const cache = new MemoryImportCache();
    const controller = createWorkerController();
    const checkpoints: string[] = [];
    const progressPhases: string[] = [];

    const result = await importPptx(createInputFile(), {
      jobId: 'job-cache-only',
      mode: 'cache-only',
      cache,
      workerFactory: () => controller.worker,
      onCheckpoint: (checkpoint) => {
        checkpoints.push(JSON.stringify(checkpoint));
      },
      onProgress: (progress) => progressPhases.push(progress.phase),
    });

    expect(controller.startCommands[0]).toMatchObject({
      mode: 'cache-only',
      skipPages: [],
    });
    expect(result).toMatchObject({
      mode: 'cache-only',
      status: 'completed',
      slideCount: 2,
    });
    expect(result.slides).toEqual([
      {
        pageIndex: 1,
        notes: '第一页备注',
        diagnostics: [],
      },
      { pageIndex: 2, diagnostics: [] },
    ]);
    expect(cache.entries.size).toBe(1);
    expect(cache.entries.has(result.source.cacheUrl)).toBe(true);
    expect(checkpoints).toHaveLength(2);
    expect(progressPhases).not.toContain('rendering');
    expect(progressPhases).not.toContain('caching-slide');
    expect(checkpoints.every((value) => !value.includes('pptx-bytes'))).toBe(
      true
    );
    expect(controller.terminated).toHaveBeenCalled();
    await deletePptxImportCache(result, cache);
    expect(cache.entries.size).toBe(0);
  });

  it('resumes cache-only checkpoints without switching to rendering', async () => {
    const cache = new MemoryImportCache();
    const initialWorker = createWorkerController();
    const initial = await importPptx(createInputFile(), {
      jobId: 'job-cache-only-resume',
      mode: 'cache-only',
      cache,
      workerFactory: () => initialWorker.worker,
    });
    const resumeWorker = createWorkerController();

    const resumed = await resumePptxImport(initial, {
      cache,
      workerFactory: () => resumeWorker.worker,
    });

    expect(resumeWorker.startCommands[0]).toMatchObject({
      mode: 'cache-only',
      skipPages: [],
    });
    expect(resumed).toMatchObject({
      mode: 'cache-only',
      status: 'completed',
      slideCount: 2,
    });
    expect(resumed.slides.every((slide) => !slide.cacheUrl)).toBe(true);
    expect(cache.entries.size).toBe(1);
    expect(resumeWorker.terminated).toHaveBeenCalled();
  });

  it('rejects an unknown mode from a damaged persisted checkpoint', async () => {
    const cache = new MemoryImportCache();
    const controller = createWorkerController();
    const initial = await importPptx(createInputFile(), {
      jobId: 'job-invalid-mode',
      mode: 'cache-only',
      cache,
      workerFactory: () => controller.worker,
    });
    const workerFactory = vi.fn(() => createWorkerController().worker);

    await expect(
      resumePptxImport(
        { ...initial, mode: 'invalid' as typeof initial.mode },
        { cache, workerFactory }
      )
    ).rejects.toMatchObject({ code: 'invalid-file', kind: 'input' });
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('terminates an active Worker on abort and starts the next queued import', async () => {
    const cache = new MemoryImportCache();
    const stalled = createWorkerController({ stalled: true });
    const next = createWorkerController();
    const firstAbort = new AbortController();
    let factoryCalls = 0;

    const first = importPptx(createInputFile(), {
      jobId: 'job-first',
      cache,
      signal: firstAbort.signal,
      workerFactory: () => {
        factoryCalls += 1;
        return stalled.worker;
      },
    });
    const second = importPptx(createInputFile(), {
      jobId: 'job-second',
      cache,
      workerFactory: () => {
        factoryCalls += 1;
        return next.worker;
      },
    });

    await vi.waitFor(() => expect(factoryCalls).toBe(1));
    expect(getPptxImportQueueState()).toMatchObject({ active: 1, queued: 1 });
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await expect(second).resolves.toMatchObject({ status: 'completed' });
    expect(factoryCalls).toBe(2);
    expect(stalled.terminated).toHaveBeenCalled();
    expect(getPptxImportQueueState()).toEqual({ active: 0, queued: 0 });
  });

  it('removes a source cached before its first checkpoint when cancelled', async () => {
    const cache = new MemoryImportCache();
    const controller = createWorkerController();
    const abortController = new AbortController();
    const put = cache.put.bind(cache);
    vi.spyOn(cache, 'put').mockImplementation(async (url, blob) => {
      await put(url, blob);
      abortController.abort();
    });

    await expect(
      importPptx(createInputFile(), {
        jobId: 'job-cancel-before-checkpoint',
        cache,
        signal: abortController.signal,
        workerFactory: () => controller.worker,
      })
    ).rejects.toMatchObject({ code: 'cancelled' });

    await vi.waitFor(() => expect(cache.entries.size).toBe(0));
    expect(controller.terminated).toHaveBeenCalled();
  });

  it('deletes only browser cache entries owned by the requested job', async () => {
    const deleteEntry = vi.fn(async () => true);
    const cache = {
      keys: vi.fn(async () => [
        new Request(
          'https://example.test/__aitu_cache__/pptx-import/job-target/a/source.pptx'
        ),
        new Request(
          'https://example.test/__aitu_cache__/pptx-import/job-target/a/slide-1.svg'
        ),
        new Request(
          'https://example.test/__aitu_cache__/pptx-import/job-other/a/source.pptx'
        ),
      ]),
      delete: deleteEntry,
    };
    const open = vi.fn(async () => cache);
    vi.stubGlobal('location', { origin: 'https://example.test' });
    vi.stubGlobal('caches', { open });

    await deletePptxImportCacheByJobId('job-target');

    expect(open).toHaveBeenCalledWith('drawnix-images');
    expect(deleteEntry).toHaveBeenCalledTimes(2);
    expect(
      deleteEntry.mock.calls.every(([request]) =>
        request.url.includes('/job-target/')
      )
    ).toBe(true);
  });
});
