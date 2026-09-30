import { importXlsxBytes, type ImportOptions } from "./document-xlsx-import";
self.onmessage = async (event: MessageEvent<{ buffer: ArrayBuffer; name: string; options: ImportOptions }>) => {
    try { self.postMessage({ result: await importXlsxBytes(event.data.buffer, event.data.name, event.data.options) }); }
    catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "文档解析失败" }); }
};
