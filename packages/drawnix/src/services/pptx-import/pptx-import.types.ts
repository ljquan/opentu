export const PPTX_IMPORT_SCHEMA_VERSION = 1 as const;
export const PPTX_IMPORT_RENDERER = 'pptx-glimpse' as const;
export const PPTX_IMPORT_RENDERER_VERSION = '5.3.0' as const;
export const PPTX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export type PptxImportMode = 'cache-only' | 'slide-images';

export type PptxImportErrorKind =
  | 'input'
  | 'security'
  | 'render'
  | 'environment'
  | 'cancelled';

export type PptxImportErrorCode =
  | 'invalid-file'
  | 'encrypted-file'
  | 'unsafe-package-path'
  | 'unsafe-compression-ratio'
  | 'unsafe-package-resource-budget'
  | 'invalid-ooxml'
  | 'empty-presentation'
  | 'external-relationship'
  | 'relationship-depth-exceeded'
  | 'slide-render-failed'
  | 'cache-unavailable'
  | 'cache-write-failed'
  | 'cached-input-missing'
  | 'cached-input-mismatch'
  | 'worker-unavailable'
  | 'worker-failed'
  | 'cancelled';

export interface PptxImportDiagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  pageIndex?: number;
  source?: 'package' | 'ooxml' | 'renderer';
  sourcePartPath?: string;
}

export interface PptxSlideSize {
  widthEmu: number;
  heightEmu: number;
  aspectRatio: number;
}

export interface PptxImportedSlide {
  pageIndex: number;
  /** Present only when `mode` is `slide-images`. */
  cacheUrl?: string;
  notes?: string;
  diagnostics: PptxImportDiagnostic[];
}

export interface PptxCachedSource {
  cacheUrl: string;
  fileName: string;
  mimeType: string;
  size: number;
  fingerprint: string;
  fingerprintAlgorithm: 'sha256' | 'fnv1a64';
  lastModified?: number;
}

export interface PptxImportCheckpoint {
  schemaVersion: typeof PPTX_IMPORT_SCHEMA_VERSION;
  jobId: string;
  /** Missing on legacy checkpoints and treated as `slide-images`. */
  mode?: PptxImportMode;
  status: 'validated' | 'rendering' | 'completed';
  source: PptxCachedSource;
  slideSize: PptxSlideSize;
  slideCount: number;
  slides: PptxImportedSlide[];
  diagnostics: PptxImportDiagnostic[];
  renderer: {
    name: typeof PPTX_IMPORT_RENDERER;
    version: typeof PPTX_IMPORT_RENDERER_VERSION;
    outputMimeType: 'image/svg+xml';
  };
}

export interface PptxImportProgress {
  phase:
    | 'queued'
    | 'validating'
    | 'caching-source'
    | 'rendering'
    | 'caching-slide'
    | 'completed';
  queuePosition?: number;
  pageIndex?: number;
  completedPages?: number;
  totalPages?: number;
}

export interface PptxImportCache {
  put(url: string, blob: Blob): Promise<void>;
  get(url: string): Promise<Blob | null>;
  delete(url: string): Promise<void>;
}

export interface PptxImportOptions {
  jobId: string;
  /** Defaults to `slide-images` for backward compatibility. */
  mode?: PptxImportMode;
  signal?: AbortSignal;
  onProgress?: (progress: PptxImportProgress) => void;
  onCheckpoint?: (checkpoint: PptxImportCheckpoint) => void | Promise<void>;
  cache?: PptxImportCache;
  workerFactory?: () => Worker;
}

export interface PptxImportPackageSlide {
  pageIndex: number;
  sourcePartPath: string;
  notes?: string;
}

export interface PptxImportPackageMetadata {
  fingerprint: string;
  fingerprintAlgorithm: PptxCachedSource['fingerprintAlgorithm'];
  slideSize: PptxSlideSize;
  slides: PptxImportPackageSlide[];
  diagnostics: PptxImportDiagnostic[];
}

export type PptxImportWorkerCommand =
  | {
      type: 'start';
      requestId: string;
      source: Blob;
      mode: PptxImportMode;
      skipPages: number[];
    }
  | { type: 'continue'; requestId: string }
  | { type: 'cancel'; requestId: string };

export interface PptxImportWorkerError {
  code: PptxImportErrorCode;
  kind: PptxImportErrorKind;
  message: string;
  pageIndex?: number;
}

export type PptxImportWorkerEvent =
  | {
      type: 'validated';
      requestId: string;
      metadata: PptxImportPackageMetadata;
    }
  | {
      type: 'slide';
      requestId: string;
      pageIndex: number;
      blob: Blob;
      diagnostics: PptxImportDiagnostic[];
    }
  | { type: 'complete'; requestId: string }
  | {
      type: 'error';
      requestId: string;
      error: PptxImportWorkerError;
    };

export class PptxImportError extends Error {
  readonly code: PptxImportErrorCode;
  readonly kind: PptxImportErrorKind;
  readonly pageIndex?: number;
  readonly cause?: unknown;

  constructor(
    code: PptxImportErrorCode,
    kind: PptxImportErrorKind,
    message: string,
    options?: { pageIndex?: number; cause?: unknown }
  ) {
    super(message);
    this.name = 'PptxImportError';
    this.code = code;
    this.kind = kind;
    this.pageIndex = options?.pageIndex;
    this.cause = options?.cause;
  }
}

export function createPptxImportCancelledError(
  reason?: unknown
): PptxImportError {
  const detail = reason instanceof Error ? `：${reason.message}` : '';
  return new PptxImportError(
    'cancelled',
    'cancelled',
    `PPTX 导入已取消${detail}`,
    { cause: reason }
  );
}
