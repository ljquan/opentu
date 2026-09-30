export type BatchDiagnostic = { id: string; severity: 'info' | 'warning' | 'error'; message: string; locator?: string };
export type BatchReference = { id: string; name: string; url: string; source: string; mimeType?: string; blob?: Blob };
export type BatchSettings = { model: string; count: number; nativeParams: string };
export type BatchRow = {
    id: string; order: number; title: string; prompt: string; references: BatchReference[]; source: string;
    status: 'ready' | 'needs-review' | 'invalid'; diagnostics: BatchDiagnostic[];
    results: Array<{ id: string; url: string; status: 'success' | 'failed' }>;
    overrides?: Partial<BatchSettings>; updatedAt: number;
};
export type BatchImport = { id: string; hash: string; name: string; blob: Blob; parser: string; mappings?: unknown; pages?: Array<{pageNumber: number; blob: Blob; width: number; height: number; text: string}> };
export type DocumentBatch = {
    schemaVersion: 1; id: string; scopeId: string; title: string; revision?: number; epoch?: number; deletedAt?: number;
    sourceFileName?: string; sourceType?: 'xlsx' | 'xls' | 'pdf'; rows: BatchRow[]; diagnostics: BatchDiagnostic[];
    imports?: BatchImport[]; unassigned?: BatchReference[]; defaults?: BatchSettings; concurrency?: number;
    createdAt: number; updatedAt: number;
};
export type BatchWorkState = 'queued' | 'submitting' | 'polling' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled';
export type BatchSnapshot = { rowId: string; title: string; prompt: string; source: string; references: BatchReference[]; model: string; modelId: string; profileId: string | null; params: Record<string,string|number|boolean>; routeFingerprint: string };
export type BatchWorkItem = { id: string; taskId: string; attemptId: string; runId: string; batchId: string; scopeId: string; epoch: number; snapshot: BatchSnapshot; slot: number; state: BatchWorkState; ticket?: string; startedAt?: number; error?: string; results: Array<{id:string;url:string;hidden?:boolean}>; updatedAt: number };
export type BatchRun = { id: string; commandId: string; batchId: string; scopeId: string; createdAt: number; itemIds: string[] };
