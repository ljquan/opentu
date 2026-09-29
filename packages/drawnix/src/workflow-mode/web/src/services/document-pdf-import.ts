import { nanoid } from "nanoid";
import type { BatchDiagnostic, BatchRow } from "@/types/document-batch";

export const PDF_IMPORT_LIMITS = {
    maxBytes: 50 * 1024 * 1024,
    maxPages: 100,
    maxPixelsPerPage: 16_000_000,
    maxTextCharacters: 500_000,
    maxTextItemsPerPage: 50_000,
    maxAssetBytes: 500 * 1024 * 1024,
};

export type NormalizedRect = { x: number; y: number; width: number; height: number };
export type PdfTextItem = { str: string; transform?: number[]; width?: number; height?: number };
export class PdfTextItemLimitError extends Error {
    constructor() { super('页面文本项超过 50,000 个，已跳过文字提取；请从原页手动核对'); }
}
export type PdfViewport = { width: number; height: number; rotation: number; convertToViewportRectangle?: (rect: number[]) => number[] };
export type PdfPageAdapter = {
    pageNumber: number;
    rotate?: number;
    getViewport: (options: { scale: number; rotation?: number }) => PdfViewport;
    getTextContent: () => Promise<{ items: PdfTextItem[] }>;
    render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void>; cancel?: () => void };
};
export type PdfDocumentAdapter = { numPages: number; getPage: (pageNumber: number) => Promise<PdfPageAdapter>; destroy?: () => Promise<void> | void };
export type PdfDocumentLoader = (data: Uint8Array) => Promise<PdfDocumentAdapter>;

export type PdfImportedPage = {
    pageNumber: number;
    blob: Blob;
    width: number;
    height: number;
    rotation: number;
    text: string;
    textBlocks?: Array<{ text: string; rect: NormalizedRect }>;
};
export type ImportPdfResult = {
    rows: BatchRow[];
    diagnostics: BatchDiagnostic[];
    pages: PdfImportedPage[];
    hash: string;
};

const diag = (message: string, locator?: string, severity: BatchDiagnostic["severity"] = "warning"): BatchDiagnostic => ({ id: nanoid(), message, locator, severity });

/** Keep user-selected crops stable when the rendered preview is resized or rotated. */
export function normalizeCrop(rect: { x: number; y: number; width: number; height: number }, width: number, height: number): NormalizedRect {
    if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, width: 0, height: 0 };
    const x1 = Math.min(1, Math.max(0, rect.x / width));
    const y1 = Math.min(1, Math.max(0, rect.y / height));
    const x2 = Math.min(1, Math.max(0, (rect.x + rect.width) / width));
    const y2 = Math.min(1, Math.max(0, (rect.y + rect.height) / height));
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function cropCanvasToBlob(canvas: HTMLCanvasElement, crop: NormalizedRect, type = "image/png"): Promise<Blob> {
    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1 || !canvas.width || !canvas.height) throw new Error("裁图坐标无效或越界");
    const x = Math.max(0, Math.floor(crop.x * canvas.width));
    const y = Math.max(0, Math.floor(crop.y * canvas.height));
    const width = Math.max(1, Math.min(canvas.width - x, Math.floor(crop.width * canvas.width)));
    const height = Math.max(1, Math.min(canvas.height - y, Math.floor(crop.height * canvas.height)));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("浏览器不支持 2D 画布");
    context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
    return new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error("页面裁图失败")), type));
}

function textFromItems(items: PdfTextItem[], limit: number): string {
    let result = "";
    for (const item of items) {
        const value = String(item.str || "");
        if (!value) continue;
        const separator = result && !/[\n ]$/.test(result) ? " " : "";
        result += separator + value;
        if (result.length >= limit) return result.slice(0, limit);
    }
    return result.trim();
}

function textBlocksFromItems(items: PdfTextItem[], viewport: PdfViewport): Array<{ text: string; rect: NormalizedRect }> {
    const blocks: Array<{ text: string; rect: NormalizedRect; baseline: number }> = [];
    for (const item of items) {
        const value = String(item.str || "").trim();
        const transform = item.transform;
        if (!value || !transform || transform.length < 6) continue;
        const x = Number(transform[4]); const y = Number(transform[5]);
        const width = Math.max(1, Number(item.width) || Math.abs(Number(transform[0]) || 1) * value.length);
        const height = Math.max(1, Number(item.height) || Math.abs(Number(transform[3]) || 1));
        if (![x, y, width, height].every(Number.isFinite)) continue;
        // PDF.js maps the unrotated PDF coordinates through CropBox + rotation.
        const corners = viewport.convertToViewportRectangle?.([x, y, x + width, y + height]) || [x, viewport.height - y - height, x + width, viewport.height - y];
        const normalized = normalizeCrop({ x: corners[0], y: corners[1], width: corners[2] - corners[0], height: corners[3] - corners[1] }, viewport.width, viewport.height);
        const previous = blocks[blocks.length - 1];
        if (previous && Math.abs(previous.baseline - normalized.y) < 0.02 && normalized.x <= previous.rect.x + previous.rect.width + 0.04) {
            const right = Math.max(previous.rect.x + previous.rect.width, normalized.x + normalized.width);
            const bottom = Math.max(previous.rect.y + previous.rect.height, normalized.y + normalized.height);
            previous.text += ` ${value}`; previous.rect.width = right - previous.rect.x; previous.rect.y = Math.min(previous.rect.y, normalized.y); previous.rect.height = bottom - previous.rect.y;
        } else blocks.push({ text: value, rect: normalized, baseline: normalized.y });
    }
    return blocks.map(({ text, rect }) => ({ text, rect }));
}

function canvasFor(width: number, height: number): HTMLCanvasElement {
    if (typeof document === "undefined") throw new Error("PDF 页面渲染需要浏览器画布环境");
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
}

export type PdfImportOptions = { pages?: number[]; onProgress?: (completed: number, total: number, page: PdfImportedPage) => void };

export async function importPdfBytes(buffer: ArrayBuffer, fileName: string, load: PdfDocumentLoader, signal?: AbortSignal, options: PdfImportOptions = {}): Promise<ImportPdfResult> {
    signal?.throwIfAborted();
    if (!/\.pdf$/i.test(fileName)) throw new Error("请选择 PDF 文件");
    if (buffer.byteLength > PDF_IMPORT_LIMITS.maxBytes) throw new Error("PDF 超过 50 MiB，请拆分后导入");
    const bytes = new Uint8Array(buffer);
    if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("文件内容与 PDF 扩展名不一致");
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hash = Array.from(new Uint8Array(hashBuffer), (value) => value.toString(16).padStart(2, "0")).join("");
    const diagnostics: BatchDiagnostic[] = [];
    const pages: PdfImportedPage[] = [];
    let document: PdfDocumentAdapter | undefined;
    let assetBytes = 0;
    const abort = () => { void document?.destroy?.(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
        document = await load(bytes);
        signal?.throwIfAborted();
        const selected = options.pages || Array.from({ length: Math.min(document.numPages, PDF_IMPORT_LIMITS.maxPages + 1) }, (_, index) => index + 1);
        if (selected.length > PDF_IMPORT_LIMITS.maxPages) throw new Error(`PDF 单次最多选择 ${PDF_IMPORT_LIMITS.maxPages} 页，请指定页面或拆分后导入`);
        if (!selected.length || new Set(selected).size !== selected.length || selected.some((page) => !Number.isInteger(page) || page < 1 || page > document!.numPages)) throw new Error("PDF 页面选择无效");
        for (const pageNumber of selected) {
            if (signal?.aborted) throw new DOMException("导入已取消", "AbortError");
            try {
                const page = await document.getPage(pageNumber);
                const rotation = ((page.rotate || 0) % 360 + 360) % 360;
                const viewport = page.getViewport({ scale: 1, rotation });
                const pixels = viewport.width * viewport.height;
                if (!Number.isFinite(pixels) || viewport.width <= 0 || viewport.height <= 0 || pixels > PDF_IMPORT_LIMITS.maxPixelsPerPage) {
                    diagnostics.push(diag(`页面像素预算超过 ${PDF_IMPORT_LIMITS.maxPixelsPerPage.toLocaleString()}，已跳过渲染`, `第 ${pageNumber} 页`));
                    continue;
                }
                let text = ""; let textBlocks: Array<{ text: string; rect: NormalizedRect }> = [];
                try { const content = await page.getTextContent(); if (content.items.length > PDF_IMPORT_LIMITS.maxTextItemsPerPage) throw new PdfTextItemLimitError(); text = textFromItems(content.items, PDF_IMPORT_LIMITS.maxTextCharacters); textBlocks = textBlocksFromItems(content.items, viewport); }
                catch (error) { signal?.throwIfAborted(); diagnostics.push(diag(error instanceof PdfTextItemLimitError ? error.message : "文字提取失败，请从原页手动补录", `第 ${pageNumber} 页`)); }
                if (text.length >= PDF_IMPORT_LIMITS.maxTextCharacters) diagnostics.push(diag("页面文本达到预算，已截断", `第 ${pageNumber} 页`));
                const canvas = canvasFor(viewport.width, viewport.height);
                const context = canvas.getContext("2d");
                if (!context) throw new Error("浏览器不支持 2D 画布");
                const render = page.render({ canvasContext: context, viewport });
                const cancelRender = () => render.cancel?.();
                signal?.addEventListener("abort", cancelRender, { once: true });
                try { await render.promise; } finally { signal?.removeEventListener("abort", cancelRender); }
                signal?.throwIfAborted();
                const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("页面预览编码失败")), "image/png"));
                assetBytes += blob.size;
                if (assetBytes > PDF_IMPORT_LIMITS.maxAssetBytes) throw new Error("PDF 页面资源超过 500 MiB，请拆分后导入");
                const imported = { pageNumber, blob, width: canvas.width, height: canvas.height, rotation, text, textBlocks };
                pages.push(imported);
                options.onProgress?.(pages.length, selected.length, imported);
                canvas.width = 0; canvas.height = 0;
            } catch (error) {
                signal?.throwIfAborted();
                if (assetBytes > PDF_IMPORT_LIMITS.maxAssetBytes) throw error;
                diagnostics.push(diag(error instanceof Error ? error.message : "页面解析失败", `第 ${pageNumber} 页`));
            }
        }
    } finally {
        signal?.removeEventListener("abort", abort);
        await document?.destroy?.();
    }
    if (!pages.length) diagnostics.push(diag("没有成功解析的页面", undefined, "error"));
    const rows: BatchRow[] = pages.flatMap((page) => (page.textBlocks?.length ? page.textBlocks.map((block) => block.text) : [page.text]).map((prompt, index) => ({
        id: nanoid(), order: index, title: `第 ${page.pageNumber} 页${page.textBlocks?.length ? ` · 文本 ${index + 1}` : ""}`, prompt,
        references: [],
        source: `PDF 第 ${page.pageNumber} 页`, status: "needs-review" as const, diagnostics: [diag(page.text ? "PDF 文本与页面区域需要核对后再生成；尚未自动绑定参考图" : "扫描页或空白页：请从原页裁图并手动补录提示词", `第 ${page.pageNumber} 页`)], results: [], updatedAt: Date.now(),
    })));
    if (rows.length > 500) throw new Error("PDF 文本候选超过 500 行，请减少选取页面后导入");
    rows.forEach((row, index) => { row.order = index; });
    return { rows, diagnostics, pages, hash };
}

export type PdfJsGetDocument = (params: { data: Uint8Array }) => { promise: Promise<PdfDocumentAdapter> };
export const createPdfDocumentLoader = (getDocument: PdfJsGetDocument): PdfDocumentLoader => async (data) => (await getDocument({ data })).promise;
