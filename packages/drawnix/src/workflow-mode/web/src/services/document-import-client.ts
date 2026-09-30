import type { ImportOptions, ImportResult } from "./document-xlsx-import";
export async function importXlsxDocument(file: File, options: ImportOptions = {}, signal?: AbortSignal): Promise<ImportResult> {
    if (file.size > 50 * 1024 * 1024) throw new Error("文件超过 50 MiB，请拆分后导入");
    signal?.throwIfAborted();
    const buffer = await file.arrayBuffer();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./document-import.worker.ts", import.meta.url), { type: "module" });
        const cleanup = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener("abort", abort); };
        const abort = () => { cleanup(); reject(new DOMException("导入已取消", "AbortError")); };
        const timer = setTimeout(() => { cleanup(); reject(new Error("解析超过 30 秒，请拆分文档")); }, 30000);
        signal?.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event) => { cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
        worker.onerror = () => { cleanup(); reject(new Error("文档解析 Worker 失败")); };
        worker.onmessageerror = () => { cleanup(); reject(new Error("文档解析结果无法读取")); };
        if (signal?.aborted) { abort(); return; }
        try { worker.postMessage({ buffer, name: file.name, options }, [buffer]); }
        catch (error) { cleanup(); reject(error); }
    });
}
