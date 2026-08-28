import { inspectPptxPackage } from './pptx-package-inspector';
import {
  PptxImportError,
  createPptxImportCancelledError,
  type PptxImportDiagnostic,
  type PptxImportWorkerCommand,
  type PptxImportWorkerError,
  type PptxImportWorkerEvent,
} from './pptx-import.types';

interface WorkerScope {
  onmessage: ((event: MessageEvent<PptxImportWorkerCommand>) => void) | null;
  postMessage(message: PptxImportWorkerEvent): void;
  close(): void;
}

const workerScope = globalThis as unknown as WorkerScope;
let activeRequestId: string | null = null;
let continueResolver: (() => void) | null = null;
let continueRejecter: ((error: Error) => void) | null = null;

function post(message: PptxImportWorkerEvent): void {
  workerScope.postMessage(message);
}

function waitForContinue(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    continueResolver = resolve;
    continueRejecter = reject;
  }).finally(() => {
    continueResolver = null;
    continueRejecter = null;
  });
}

function toWorkerError(error: unknown): PptxImportWorkerError {
  if (error instanceof PptxImportError) {
    return {
      code: error.code,
      kind: error.kind,
      message: error.message,
      ...(error.pageIndex ? { pageIndex: error.pageIndex } : {}),
    };
  }
  return {
    code: 'worker-failed',
    kind: 'environment',
    message: error instanceof Error ? error.message : 'PPTX Worker 执行失败',
  };
}

function normalizeRendererDiagnostics(
  diagnostics: readonly {
    code: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    slideNumber?: number;
    sourcePartPath?: string;
  }[],
  pageIndex: number
): PptxImportDiagnostic[] {
  return diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.slideNumber === undefined ||
        diagnostic.slideNumber === pageIndex
    )
    .map((diagnostic) => ({
      code: diagnostic.code.slice(0, 128),
      severity: diagnostic.severity,
      message:
        diagnostic.message.length <= 512
          ? diagnostic.message
          : `${diagnostic.message.slice(0, 509)}...`,
      pageIndex,
      source: 'renderer' as const,
      ...(diagnostic.sourcePartPath
        ? { sourcePartPath: diagnostic.sourcePartPath.slice(0, 512) }
        : {}),
    }));
}

async function runImport(
  command: Extract<PptxImportWorkerCommand, { type: 'start' }>
): Promise<void> {
  const { requestId, source } = command;
  const bytes = new Uint8Array(await source.arrayBuffer());
  const metadata = await inspectPptxPackage(bytes);
  post({ type: 'validated', requestId, metadata });
  await waitForContinue();

  if (command.mode === 'cache-only') {
    post({ type: 'complete', requestId });
    return;
  }

  const skipPages = new Set(command.skipPages);
  const { clearFontCache, convertPptxToSvg } = await import('pptx-glimpse');
  for (const slide of metadata.slides) {
    if (skipPages.has(slide.pageIndex)) continue;
    let report: Awaited<ReturnType<typeof convertPptxToSvg>>;
    try {
      report = await convertPptxToSvg(bytes, {
        slides: [slide.pageIndex],
        logLevel: 'off',
        textOutput: 'path',
        skipSystemFonts: true,
      });
    } catch (error) {
      throw new PptxImportError(
        'slide-render-failed',
        'render',
        `PPTX 第 ${slide.pageIndex} 页渲染失败`,
        { pageIndex: slide.pageIndex, cause: error }
      );
    } finally {
      clearFontCache();
    }

    const rendered = report.slides.find(
      (candidate) => candidate.slideNumber === slide.pageIndex
    );
    if (!rendered?.svg || !rendered.svg.includes('<svg')) {
      throw new PptxImportError(
        'slide-render-failed',
        'render',
        `PPTX 第 ${slide.pageIndex} 页没有生成可用快照`,
        { pageIndex: slide.pageIndex }
      );
    }

    const blob = new Blob([rendered.svg], {
      type: 'image/svg+xml;charset=utf-8',
    });
    post({
      type: 'slide',
      requestId,
      pageIndex: slide.pageIndex,
      blob,
      diagnostics: normalizeRendererDiagnostics(
        report.diagnostics,
        slide.pageIndex
      ),
    });
    await waitForContinue();
  }

  post({ type: 'complete', requestId });
}

workerScope.onmessage = (event): void => {
  const command = event.data;
  if (command.type === 'continue') {
    if (command.requestId === activeRequestId) continueResolver?.();
    return;
  }
  if (command.type === 'cancel') {
    if (command.requestId === activeRequestId) {
      continueRejecter?.(createPptxImportCancelledError());
    }
    return;
  }
  if (activeRequestId !== null) {
    post({
      type: 'error',
      requestId: command.requestId,
      error: {
        code: 'worker-failed',
        kind: 'environment',
        message: 'PPTX Worker 同时收到多个任务',
      },
    });
    return;
  }

  activeRequestId = command.requestId;
  runImport(command)
    .catch((error) => {
      post({
        type: 'error',
        requestId: command.requestId,
        error: toWorkerError(error),
      });
    })
    .finally(() => {
      activeRequestId = null;
      workerScope.close();
    });
};
