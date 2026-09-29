import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { ImportPdfResult, PdfDocumentAdapter, PdfImportOptions, PdfTextItem } from "./document-pdf-import";
import { importPdfBytes, PDF_IMPORT_LIMITS, PdfTextItemLimitError } from "./document-pdf-import";

GlobalWorkerOptions.workerSrc = workerSrc;

function asAdapter(document: PDFDocumentProxy): PdfDocumentAdapter {
    return {
        numPages: document.numPages,
        async getPage(pageNumber) {
            const page = await document.getPage(pageNumber);
            return {
                pageNumber, rotate: page.rotate,
                getViewport: (options) => page.getViewport(options),
                getTextContent: async () => {
                    const reader = page.streamTextContent().getReader();
                    const items: PdfTextItem[] = [];
                    let count = 0;
                    try {
                        for (;;) {
                            const chunk = await reader.read();
                            if (chunk.done) break;
                            count += chunk.value.items.length;
                            if (count > PDF_IMPORT_LIMITS.maxTextItemsPerPage) throw new PdfTextItemLimitError();
                            for (const item of chunk.value.items) if ('str' in item) items.push(item as PdfTextItem);
                        }
                        return { items };
                    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
                },
                render: ({ canvasContext, viewport }) => page.render({
                    canvas: canvasContext.canvas,
                    canvasContext,
                    viewport: page.getViewport({ scale: viewport.width / page.getViewport({ scale: 1 }).width, rotation: viewport.rotation }),
                    annotationMode: AnnotationMode.DISABLE,
                }),
            };
        },
    };
}

/** PDF.js owns a dedicated parsing worker; only its public page render API touches the DOM. */
export async function importPdfDocument(file: File, signal?: AbortSignal, options?: PdfImportOptions): Promise<ImportPdfResult> {
    if (file.size > PDF_IMPORT_LIMITS.maxBytes) throw new Error("PDF 超过 50 MiB，请拆分后导入");
    signal?.throwIfAborted();
    const buffer = await file.arrayBuffer();
    signal?.throwIfAborted();
    let loading: ReturnType<typeof getDocument> | undefined;
    const abort = () => { void loading?.destroy(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
        return await importPdfBytes(buffer, file.name, async (bytes) => {
            // PDF.js 6 removed the eval font path; scripts and XFA are never rendered here.
            loading = getDocument({ data: bytes, enableXfa: false, stopAtErrors: true, disableAutoFetch: true, disableStream: true, maxImageSize: PDF_IMPORT_LIMITS.maxPixelsPerPage, useWorkerFetch: false });
            loading.onPassword = () => { void loading?.destroy(); };
            return asAdapter(await loading.promise);
        }, signal, options);
    } finally {
        signal?.removeEventListener("abort", abort);
        await loading?.destroy();
    }
}
