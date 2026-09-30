import { Unzip, UnzipInflate, strFromU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import * as XLSX from "xlsx";
import { nanoid } from "nanoid";
import type { BatchDiagnostic, BatchReference, BatchRow, BatchSettings } from "@/types/document-batch";

export const IMPORT_LIMITS = { file: 50 * 1024 * 1024, expanded: 200 * 1024 * 1024, entry: 25 * 1024 * 1024, entries: 10000, rows: 500, references: 16 };
export type SheetMapping = { sheet: string; headerRow: number; prompt: number; title: number; images: number; model?:number; count?:number; parameters?:number; aspectRatio?:number; resolution?:number };
export type ImportResult = { rows: BatchRow[]; diagnostics: BatchDiagnostic[]; sheetNames: string[]; hash: string; mappings: SheetMapping[]; unassigned: BatchReference[] };
export type ImportOptions = { mappings?: SheetMapping[]; includeHidden?: boolean; availableModels?:string[] };
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, processEntities: false });
const diagnostic = (message: string, locator?: string): BatchDiagnostic => ({ id: nanoid(), severity: "warning", message, locator });
const list = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string => value == null ? "" : String(value).trim();

export function resolveZipPath(source: string, target: string): string {
    if (!target || /[\\\x00-\x1f]/.test(target) || /^[a-z]+:/i.test(target)) throw new Error("非法文档资源路径");
    const parts = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
    for (const part of target.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") { if (!parts.length) throw new Error("文档资源越过包边界"); parts.pop(); }
        else parts.push(part);
    }
    return parts.join("/");
}

/** Count actual output as chunks arrive; declared ZIP lengths are not trusted. */
export function unpackDocument(bytes: Uint8Array, limits = IMPORT_LIMITS): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    let total = 0, entries = 0, completed = 0; let budgetError: Error | undefined;
    const unzip = new Unzip((file) => {
        if (budgetError) throw budgetError;
        if (++entries > limits.entries) throw new Error("文档条目超过预算");
        if (file.name.startsWith("/") || file.name.split("/").some((part) => part === "." || part === "..")) throw new Error("非法 ZIP 条目路径");
        const name = resolveZipPath("", file.name);
        if (files.has(name)) throw new Error("文档包含重复资源路径");
        files.set(name, new Uint8Array());
        let size = 0;
        const chunks: Uint8Array[] = [];
        file.ondata = (error, chunk, final) => {
            if (error) { budgetError = new Error("文档解压失败"); return; }
            size += chunk.length; total += chunk.length;
            if (size > limits.entry || total > limits.expanded) { budgetError = new Error("文档实际解压量超过预算，请拆分文件"); file.terminate(); return; }
            chunks.push(chunk);
            if (final) { const output = new Uint8Array(size); let offset = 0; for (const part of chunks) { output.set(part, offset); offset += part.length; } files.set(name, output); completed++; }
        };
        file.start();
    });
    unzip.register(UnzipInflate);
    // Small input chunks also bound the output produced by a single inflate call.
    for (let offset = 0; offset < bytes.length; offset += 1024) {
        unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
        if (budgetError) throw budgetError;
    }
    if (budgetError) throw budgetError;
    if (completed !== entries || !entries) throw new Error("文档包不完整");
    return files;
}

function xml(files: Map<string, Uint8Array>, path: string) {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`文档结构缺少资源：${path}`);
    const source = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) throw new Error("文档 XML 无效或含不支持的实体");
    return xmlParser.parse(source);
}
function relationships(files: Map<string, Uint8Array>, source: string): Map<string, { path?: string; type: string }> {
    const path = source.replace(/([^/]+)$/, "_rels/$1.rels");
    if (!files.has(path)) return new Map();
    return new Map(list<any>(xml(files, path).Relationships?.Relationship).map((r) => [r["@Id"], { type: r["@Type"] || "", path: r["@TargetMode"] === "External" ? undefined : resolveZipPath(source, r["@Target"]) }]));
}
export function validateImageLink(value: string): string {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const normalizedHost = host.endsWith(".") ? host.slice(0, -1) : host;
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || !normalizedHost.includes(".") || normalizedHost === "localhost" || host.endsWith(".") || normalizedHost.endsWith(".local") || normalizedHost.endsWith(".localhost") || normalizedHost.endsWith(".nip.io") || normalizedHost.endsWith(".sslip.io") || normalizedHost.includes(":")) throw new Error("图片地址不允许");
    const octets = normalizedHost.split(".").map(Number);
    if (octets.length === 4 && octets.every(Number.isInteger) && (octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127))) throw new Error("不允许自动访问本地或私网图片地址");
    return url.href;
}
function imageReference(bytes: Uint8Array, path: string, source: string): BatchReference {
    const type = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? "image/png" : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : strFromU8(bytes.subarray(0, 6)).startsWith("GIF8") ? "image/gif" : strFromU8(bytes.subarray(0, 4)) === "RIFF" && strFromU8(bytes.subarray(8, 12)) === "WEBP" ? "image/webp" : undefined;
    if (!type) throw new Error("仅支持 PNG、JPEG、GIF、WebP 参考图；其他格式需手动转换");
    return { id: nanoid(), name: path.split("/").pop() || "图片", url: "", blob: new Blob([new Uint8Array(bytes)], { type }), mimeType: type, source };
}
export { imageReference };

export async function importXlsxBytes(buffer: ArrayBuffer, fileName: string, options: ImportOptions = {}): Promise<ImportResult> {
    if (buffer.byteLength > IMPORT_LIMITS.file) throw new Error("文件超过 50 MiB，请拆分后导入");
    const bytes = new Uint8Array(buffer);
    const xlsx = /\.xlsx$/i.test(fileName);
    if (!xlsx && !/\.xls$/i.test(fileName)) throw new Error("请选择 XLSX 或 XLS 文件");
    if (xlsx ? !(bytes[0] === 80 && bytes[1] === 75) : !(bytes[0] === 208 && bytes[1] === 207)) throw new Error("文件内容与扩展名不一致");
    const files = xlsx ? unpackDocument(bytes) : null;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (v) => v.toString(16).padStart(2, "0")).join("");
    const diagnostics: BatchDiagnostic[] = [], rows: BatchRow[] = [], unassigned: BatchReference[] = [], mappings: SheetMapping[] = [];
    if (!xlsx) diagnostics.push(diagnostic("XLS 仅导入文本和链接，内嵌图片请转存为 XLSX"));
    if (files && [...files.keys()].some((p) => /vbaProject|activeX/i.test(p))) throw new Error("不支持包含宏或 ActiveX 的文档");
    // metadata.xml is emitted by common XLSX writers even when no cell images exist.
    // Only warn for the image-bearing extension parts that this importer cannot map reliably.
    const unsupportedImages = files && [...files.entries()].some(([p, bytes]) => /cellimages|richData/i.test(p) || (/metadata\.xml$/i.test(p) && /XLRICHVALUE/i.test(strFromU8(bytes))));
    if (unsupportedImages) diagnostics.push(diagnostic("发现单元格图片或扩展数据，可能无法提取；请核对原文件并手动补图"));
    // Validate XML before handing the package to the workbook parser as well.
    if (files) for (const path of files.keys()) if (/\.(xml|rels)$/i.test(path)) xml(files, path);
    const workbook = XLSX.read(buffer, { type: "array", cellFormula: true, cellHTML: false, cellStyles: true, bookVBA: true, sheetRows: 10002 });
    if (workbook.vbaraw || Object.values(workbook.Sheets).some((sheet) => String(sheet["!type"]) === "macro")) throw new Error("不支持包含宏的 XLS 文档，请另存为不含宏的 XLSX");
    if (options.mappings) {
        const seen = new Set<string>();
        for (const mapping of options.mappings) {
            if (!workbook.SheetNames.includes(mapping.sheet) || seen.has(mapping.sheet)) throw new Error("工作表映射不存在或重复");
            seen.add(mapping.sheet);
            if (!Number.isInteger(mapping.headerRow) || mapping.headerRow < 1 || mapping.headerRow > 10001 || [mapping.prompt, mapping.title, mapping.images, ...[mapping.model,mapping.count,mapping.parameters,mapping.aspectRatio,mapping.resolution].filter((v):v is number=>v!==undefined)].some((col) => !Number.isInteger(col) || col < -1 || col > 255)) throw new Error("表头或列映射超出有效范围");
        }
    }
    const workbookRels = files ? relationships(files, "xl/workbook.xml") : null;
    const sheets = files ? list<any>(xml(files, "xl/workbook.xml").workbook?.sheets?.sheet) : [];
    for (const sheetName of workbook.SheetNames) {
        if (options.mappings && !options.mappings.some((m) => m.sheet === sheetName)) continue;
        const sheetIndex = workbook.SheetNames.indexOf(sheetName), sheet = workbook.Sheets[sheetName];
        if (workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden && !options.includeHidden) { diagnostics.push(diagnostic("隐藏工作表未导入", sheetName)); continue; }
        const range = XLSX.utils.decode_range(sheet["!fullref"] || sheet["!ref"] || "A1");
        if (range.e.r > 10000 || range.e.c > 255) throw new Error(`工作表 ${sheetName} 超过 10001 个物理行或 256 列扫描预算，请拆分`);
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true, range: 0 });
        const headerRow = options.mappings?.find((m) => m.sheet === sheetName)?.headerRow || 1;
        const headers = (matrix[headerRow - 1] || []).map(text);
        const column = (names: string[]) => headers.findIndex((h) => names.includes(h.toLowerCase()));
        const mapping = options.mappings?.find((m) => m.sheet === sheetName) || { sheet: sheetName, headerRow, prompt: column(["prompt", "提示词", "描述", "内容"]), title: column(["name", "名称", "标题", "编号"]), images: column(["images", "image", "图片", "参考图", "图片链接", "url"]), model:column(["model","模型"]), count:column(["count","数量"]), parameters:column(["parameters","params","参数"]), aspectRatio:column(["aspect_ratio","比例","尺寸"]), resolution:column(["resolution","分辨率"]) };
        mappings.push(mapping);
        const sheetRows = new Map<number, BatchRow>();
        for (let index = headerRow; index < matrix.length; index++) {
            const data = matrix[index] || [];
            if (!data.some((v) => text(v)) && !Array.from({ length: range.e.c + 1 }, (_, col) => sheet[XLSX.utils.encode_cell({ r: index, c: col })]?.f).some(Boolean)) continue;
            if (sheet["!rows"]?.[index]?.hidden && !options.includeHidden) { diagnostics.push(diagnostic("隐藏行未导入", `${sheetName}!${index + 1}`)); continue; }
            const source = `${sheetName}!${index + 1}`, rowDiagnostics: BatchDiagnostic[] = [];
            if (unsupportedImages) rowDiagnostics.push(diagnostic("文档含无法定位到行的单元格图片，请核对本行是否需要补图", source));
            const prompt = mapping.prompt >= 0 ? text(data[mapping.prompt]) : "";
            if (!prompt) rowDiagnostics.push(diagnostic("提示词为空或未映射，请补录", source));
            if (sheet["!merges"]?.some((merge) => merge.s.r <= index && merge.e.r >= index && merge.s.r !== merge.e.r)) rowDiagnostics.push(diagnostic("存在跨行合并单元格，请核对图文归属", source));
            for (let col = 0; col <= range.e.c; col++) if (sheet[XLSX.utils.encode_cell({ r: index, c: col })]?.f) rowDiagnostics.push(diagnostic("公式仅读取缓存值；公式图片需手动补录", `${source}:${XLSX.utils.encode_col(col)}`));
            const references: BatchReference[] = [];
            const imageCell = mapping.images >= 0 ? sheet[XLSX.utils.encode_cell({ r: index, c: mapping.images })] : undefined;
            const links = mapping.images >= 0 ? text(imageCell?.l?.Target || data[mapping.images]) : "";
            // Do not split signed URLs on commas: commas can be part of the signature.
            for (const link of links.split(/\r?\n/).filter(Boolean)) {
                try { const url = validateImageLink(link.trim()); references.push({ id: nanoid(), name: new URL(url).hostname, url, source }); }
                catch { rowDiagnostics.push(diagnostic("图片链接无效或属于私网，请修正", source)); }
            }
            if (references.length > IMPORT_LIMITS.references) throw new Error(`${source} 超过 16 张参考图预算，请拆分该行`);
            const overrides:Partial<BatchSettings>={};
            const value=(col:number|undefined)=>col!==undefined&&col>=0?text(data[col]):'';
            const rawModel=value(mapping.model), rawCount=value(mapping.count), rawParams=value(mapping.parameters);
            let resolvedModel='';
            if(rawModel){const candidates=(options.availableModels||[]).filter(m=>m===rawModel||m.slice(m.indexOf('::')+2)===rawModel);if(candidates.length===1){resolvedModel=candidates[0];overrides.model=resolvedModel;}else{overrides.model=rawModel;rowDiagnostics.push(diagnostic(`模型需指定唯一渠道，原值：${rawModel}`,source));}}
            if(rawCount){const count=Number(rawCount);if(!Number.isInteger(count)||count<1||count>1000){rowDiagnostics.push(diagnostic(`数量必须为 1–1000 的整数，原值：${rawCount}`,source));overrides.count=0;}else overrides.count=count;}
            const params:Record<string,string|number|boolean>={};
            if(rawParams)try{const parsed:unknown=JSON.parse(rawParams);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.entries(parsed).some(([key,val])=>['__proto__','prototype','constructor'].includes(key)||!['string','number','boolean'].includes(typeof val)))throw new Error();Object.assign(params,parsed);}catch{rowDiagnostics.push(diagnostic(`参数 JSON 无效，请修正原值：${rawParams}`,source));}
            if(value(mapping.aspectRatio))params.aspect_ratio=value(mapping.aspectRatio);
            if(value(mapping.resolution))params.resolution=value(mapping.resolution);
            if(Object.keys(params).length){overrides.nativeParams=JSON.stringify({[`image::${resolvedModel||rawModel}`]:params});rowDiagnostics.push(diagnostic(`请核对模型参数键及取值：${JSON.stringify(params)}${resolvedModel?'':'；须先确定模型渠道再录入设置'}`,source));}
            const row: BatchRow = { id: nanoid(), order: rows.length, overrides:Object.keys(overrides).length?overrides:undefined, title: mapping.title >= 0 ? text(data[mapping.title]) || source : source, prompt, references, source, status: rowDiagnostics.length || references.length ? "needs-review" : "ready", diagnostics: rowDiagnostics, results: [], updatedAt: Date.now() };
            rows.push(row); sheetRows.set(index, row);
            if (rows.length > IMPORT_LIMITS.rows) throw new Error("导入超过 500 行，请选择较少的工作表或拆分文件");
        }
        if (!files) continue;
        const sheetPart = sheets.find((s) => s["@name"] === sheetName);
        const sheetPath = workbookRels?.get(sheetPart?.["@id"])?.path;
        if (!sheetPath) { diagnostics.push(diagnostic("无法定位工作表绘图关系，请核对参考图", sheetName)); continue; }
        const sheetXml = xml(files, sheetPath), sheetRels = relationships(files, sheetPath);
        for (const drawingRef of list<any>(sheetXml.worksheet?.drawing)) {
            const drawingPath = sheetRels.get(drawingRef["@id"])?.path;
            if (!drawingPath) { diagnostics.push(diagnostic("外部或缺失的绘图关系未加载", sheetName)); continue; }
            const drawing: any = xml(files, drawingPath).wsDr; const rels = relationships(files, drawingPath);
            if (drawing?.absoluteAnchor || drawing?.grpSp) diagnostics.push(diagnostic("绝对锚点或分组绘图需手动补图", sheetName));
            const anchors: any[] = [...list<any>(drawing?.oneCellAnchor), ...list<any>(drawing?.twoCellAnchor)].sort((a, b) => Number(a.from?.row) - Number(b.from?.row) || Number(a.from?.col) - Number(b.from?.col));
            for (const anchor of anchors) {
                const index = Number(anchor.from?.row), targetRow = sheetRows.get(index), locator = `${sheetName}!${index + 1}:drawing`;
                if (!Number.isInteger(index) || index < 0 || !Number.isInteger(Number(anchor.from?.col))) { diagnostics.push(diagnostic("绘图锚点无效，请手动补图", sheetName)); continue; }
                if (sheet["!rows"]?.[index]?.hidden && !options.includeHidden) { diagnostics.push(diagnostic("隐藏行图片未导入", locator)); continue; }
                const path = rels.get(anchor.pic?.blipFill?.blip?.["@embed"])?.path;
                if (!path || !files.has(path)) { diagnostics.push(diagnostic("不支持的绘图、外链或缺失图片，请手动补图", locator)); if (targetRow) { targetRow.status = "needs-review"; targetRow.diagnostics.push(diagnostic("该行绘图资源不完整", locator)); } continue; }
                try {
                    const reference = imageReference(files.get(path)!, path, locator);
                    // Endpoint exactly at the next row's top edge still belongs to the preceding row.
                    const rowHeight = Number(sheet["!rows"]?.[index]?.hpt || sheetXml.worksheet?.sheetFormatPr?.["@defaultRowHeight"] || 15) * 12700;
                    const extent = Number(anchor.ext?.["@cy"]);
                    const end = anchor.to ? Number(anchor.to.row) - (Number(anchor.to.rowOff || 0) === 0 ? 1 : 0) : index + (Number.isFinite(extent) && extent > 0 && extent + Number(anchor.from.rowOff || 0) <= rowHeight ? 0 : 1);
                    if (!targetRow || end > index) {
                        unassigned.push(reference); diagnostics.push(diagnostic("图片跨行或没有对应任务行，请手动指定归属", locator));
                        for (const [rowIndex, row] of sheetRows) if (rowIndex >= index && rowIndex <= end) { row.status = "needs-review"; row.diagnostics.push(diagnostic("跨行图片需要核对归属", locator)); }
                    } else { targetRow.references.push(reference); targetRow.status = "needs-review"; }
                } catch { diagnostics.push(diagnostic("图片格式不支持，请转换后补图", locator)); if (targetRow) { targetRow.status = "needs-review"; targetRow.diagnostics.push(diagnostic("图片格式不支持", locator)); } }
            }
        }
    }
    for (const row of rows) if (row.references.length > IMPORT_LIMITS.references) throw new Error(`${row.source} 超过 16 张参考图预算，请拆分该行`);
    return { rows, diagnostics, sheetNames: workbook.SheetNames, hash, mappings, unassigned };
}
