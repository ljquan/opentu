import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Checkbox, Empty, Image as AntImage, Input, List, Popconfirm, Select, Space, Tag, Typography, Upload, Alert, Pagination, InputNumber, Progress } from "antd";
import { FileSpreadsheet, Plus, Save, Trash2, UploadCloud, Copy, Merge, Split, X, Play, Pause } from "lucide-react";
import { nanoid } from "nanoid";
import type { BatchReference, BatchRow, DocumentBatch, BatchWorkItem, BatchSettings, BatchRun } from "@/types/document-batch";
import { importXlsxDocument } from "@/services/document-import-client";
import { deleteDocumentBatch, getDocumentBatch, listDocumentBatches, saveDocumentBatch, setBatchActive, cancelQueuedItems, listBatchItems, listBatchRuns, hideBatchResult, retryFailedBatchItems } from "@/services/document-batch-repository";
import { getDocumentBatchScope, subscribeDocumentBatchScope } from "@/services/document-batch-scope";
import { exportBatchResults, loadBatchReference, loadResult } from "@/services/document-batch-export";
import { downloadDocumentBatchTemplate } from "@/services/document-xlsx-template";
import { importPdfDocument } from "@/services/document-pdf-client";
import { prepareBatchGeneration, startBatchSubmission, reconcileBatchItems } from "@/services/document-batch-scheduler";

import { ModelPicker } from "@/components/model-picker";
import { NativeSettingsPanel } from "@/components/native-settings-panel";
import { useEffectiveConfig, decodeChannelModel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { recognizePdfPage } from "@/services/document-pdf-recognition";
import { promptEdit, validateEditedBatch } from "./row-editing";
import DocumentPdfPreview from "./document-pdf-preview";
import type { ImportOptions } from "@/services/document-xlsx-import";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { batchImageConfig, resolveBatchImageModel } from "@/services/document-batch-models";
import { syncOpenTuModels } from "@/integration/opentu-model-defaults";
const now = () => Date.now();
function ReferencePreview({ reference }: { reference: BatchReference }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        if (!reference.blob) {
            setUrl("");
            return;
        }
        const next = URL.createObjectURL(reference.blob);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [reference.blob]);
    return url ? <img src={url} alt={reference.name} className="h-16 w-20 rounded object-contain bg-stone-100" /> : <span className="text-xs text-stone-500">外部图片尚未加载</span>;
}
function ResultPreview({ result, title }: { result: { id: string; url: string }; title: string }) {
    const [previewUrl, setPreviewUrl] = useState<string>();
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let alive = true;
        let objectUrl: string | undefined;
        const controller = new AbortController();
        setFailed(false);
        setPreviewUrl(undefined);
        void loadResult(result.url, result.id, title, controller.signal).then((loaded) => {
            if (!alive) return;
            if (!loaded.blob) throw new Error("图片内容为空");
            objectUrl = URL.createObjectURL(loaded.blob);
            setPreviewUrl(objectUrl);
        }).catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [result.id, result.url, title]);
    if (failed) return <div className="flex aspect-square items-center justify-center text-center text-xs text-stone-500">图片暂时无法读取<br />可重试下载或稍后刷新</div>;
    if (!previewUrl) return <div role="status" className="flex aspect-square items-center justify-center text-sm text-stone-500">正在加载图片…</div>;
    return <AntImage src={previewUrl} preview={{ src: previewUrl }} alt={title} onError={() => setFailed(true)} className="aspect-square w-full object-contain" />;
}
function Settings({ value, onChange }: { value: BatchSettings; onChange: (value: BatchSettings) => void }) {
    const allConfig = useEffectiveConfig();
    const config = batchImageConfig(allConfig);
    const valid = !!resolveBatchImageModel(config.channels, value.model);
    const [refreshing, setRefreshing] = useState(false);
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((s) => s.theme)];
    const effective = { ...config, model: value.model, imageModel: value.model, nativeParams: value.nativeParams } as AiConfig;
    return (
        <div className="space-y-3">
            <ModelPicker config={config} capability="image" value={valid ? value.model : ""} onChange={(model) => onChange({ ...value, model })} fullWidth />
            {!valid && <Alert type="warning" message={value.model ? "该批次保存的模型渠道已失效或不支持批量生成，请重新选择 OpenTu 图片模型。" : "请选择 OpenTu 图片模型；自定义渠道及脚本模型暂不支持持久批量队列。"} />}
            <Button size="small" loading={refreshing} onClick={async () => {
                setRefreshing(true);
                try { await syncOpenTuModels(); } catch { message.error("OpenTu 模型读取失败，请检查供应商配置后重试"); }
                finally { setRefreshing(false); }
            }}>刷新 OpenTu 模型</Button>
            <label className="flex items-center gap-3 text-sm">
                每行生成数量
                <InputNumber min={1} max={1000} value={value.count} onChange={(count) => onChange({ ...value, count: count || 1 })} />
            </label>
            {valid && <NativeSettingsPanel config={effective} capability="image" theme={theme} onChange={(nativeParams) => onChange({ ...value, nativeParams })} />}
        </div>
    );
}
const makeBatch = (scopeId: string): DocumentBatch => ({
    schemaVersion: 1,
    id: nanoid(),
    scopeId,
    title: "未命名批次",
    rows: [],
    diagnostics: [],
    imports: [],
    unassigned: [],
    defaults: { model: "", count: 1, nativeParams: "{}" },
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
    epoch: 0,
});
const emptyRow = (order: number): BatchRow => ({
    id: nanoid(),
    order,
    title: `新任务 ${order + 1}`,
    prompt: "",
    references: [],
    source: "手动新增",
    status: "needs-review",
    diagnostics: [{ id: nanoid(), severity: "warning", message: "提示词为空，需要补录" }],
    results: [],
    updatedAt: now(),
});

export default function BatchGenerationPage() {
    const { message, modal } = App.useApp();
    const addAsset = useAssetStore((state) => state.addAsset);
    const [scope, setScope] = useState(() => getDocumentBatchScope());
    const [batches, setBatches] = useState<DocumentBatch[]>([]);
    const [batch, setBatch] = useState<DocumentBatch>();
    const [selected, setSelected] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [dirty, setDirty] = useState(false);
    const [importing, setImporting] = useState(false);
    const [filter, setFilter] = useState<"all" | "ready" | "review">("all");
    const [page, setPage] = useState(1);
    const [runBusy, setRunBusy] = useState(false);
    const [error, setError] = useState("");
    const [items, setItems] = useState<BatchWorkItem[]>([]);
    const [runs, setRuns] = useState<BatchRun[]>([]);
    const [failedIds, setFailedIds] = useState<string[]>([]);
    const [resultIds, setResultIds] = useState<string[]>([]);
    const [exporting, setExporting] = useState(false);
    const [pdfPage, setPdfPage] = useState(0);
    const [recognitionModel, setRecognitionModel] = useState("");
    const [recognizing, setRecognizing] = useState(false);
    const config = useEffectiveConfig();
    const resourceAbort = useRef(new AbortController());
    const [mappingText, setMappingText] = useState("");
    const [includeHidden, setIncludeHidden] = useState(false);
    const [appendDuplicate, setAppendDuplicate] = useState(false);
    const [resultScope, setResultScope] = useState<"latest" | "all">("latest");
    const batchRef = useRef(batch);
    batchRef.current = batch;
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    const fail = (e: unknown) => {
        const text = e instanceof Error ? e.message : String(e);
        setError(text);
        message.error(text);
    };
    const importAbort = useRef<AbortController>();
    const generationCancel = useRef<(() => void) | undefined>();
    const revision = useRef(0);

    const reload = useCallback(async (activeScope: string) => {
        const token = ++revision.current;
        setLoading(true);
        setError("");
        try {
            const loaded = await listDocumentBatches(activeScope);
            if (token !== revision.current || getDocumentBatchScope() !== activeScope) return;
            setBatches(loaded);
            setBatch(loaded[0] || makeBatch(activeScope));
            setSelected([]);
            setDirty(false);
            setPage(1);
        } catch (e) {
            if (token === revision.current) setError(e instanceof Error ? e.message : "批次读取失败");
        } finally {
            if (token === revision.current) setLoading(false);
        }
    }, []);
    useEffect(() => {
        const change = () => {
            const next = getDocumentBatchScope();
            if (next === scopeRef.current) return;
            revision.current++;
            resourceAbort.current.abort();
            resourceAbort.current = new AbortController();
            importAbort.current?.abort();
            generationCancel.current?.();
            setScope(next);
            setBatch(undefined);
            setSelected([]);
            setItems([]);
            setResultIds([]);
            setDirty(false);
            setImporting(false);
        };
        const unsubscribe = subscribeDocumentBatchScope(change);
        return () => {
            unsubscribe();
            revision.current++;
            resourceAbort.current.abort();
            importAbort.current?.abort();
            generationCancel.current?.();
        };
    }, []);
    useEffect(() => {
        if (scope) void reload(scope);
        else setLoading(false);
    }, [scope, reload]);
    useEffect(() => {
        if (!batch || !scope) return;
        let alive = true;
        let refreshing = false;
        const refresh = () => {
            if (refreshing || !alive) return;
            refreshing = true;
            void reconcileBatchItems(batch.id, scope)
                .then(() => Promise.all([listBatchItems(batch.id, scope), listBatchRuns(batch.id, scope)]))
                .then(([next, nextRuns]) => {
                    if (alive && getDocumentBatchScope() === scope) {
                        setItems(next);
                        setRuns(nextRuns);
                    }
                })
                .catch((e) => {
                    if (alive) setError(e instanceof Error ? e.message : "任务状态读取失败");
                })
                .finally(() => {
                    refreshing = false;
                });
        };
        refresh();
        const timer = setInterval(refresh, 2000);
        return () => {
            alive = false;
            clearInterval(timer);
            setItems([]);
            setResultIds([]);
            setFailedIds([]);
            setRuns([]);
            generationCancel.current?.();
        };
    }, [batch?.id, scope]);
    useEffect(() => {
        const guard = (e: BeforeUnloadEvent) => {
            if (dirtyRef.current) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", guard);
        return () => window.removeEventListener("beforeunload", guard);
    }, []);
    const update = (fn: (b: DocumentBatch) => DocumentBatch) => {
        const current = batchRef.current;
        if (!current || current.scopeId !== getDocumentBatchScope()) return;
        const next = { ...fn(current), updatedAt: now() };
        const validation = validateEditedBatch(next.rows);
        if (validation) {
            fail(new Error(validation));
            return;
        }
        batchRef.current = next;
        dirtyRef.current = true;
        setBatch(next);
        setDirty(true);
    };
    const persist = async (value = batchRef.current) => {
        if (!value || !scope || getDocumentBatchScope() !== scope) return;
        setSaving(true);
        try {
            const saved = await saveDocumentBatch(value);
            if (getDocumentBatchScope() !== scope) return;
            setBatch((current) => (current?.id === saved.id ? (current === value ? saved : { ...current, revision: saved.revision }) : current));
            setBatches((xs) => [saved, ...xs.filter((x) => x.id !== saved.id)]);
            if (batchRef.current === value) {
                setDirty(false);
                dirtyRef.current = false;
            }
            return saved;
        } catch (e) {
            fail(e);
            throw e;
        } finally {
            setSaving(false);
        }
    };
    const switchBatch = async (next?: DocumentBatch) => {
        try {
            if (saving) return;
            if (dirtyRef.current) {
                const before = batchRef.current;
                await persist();
                if (batchRef.current !== before && dirtyRef.current) return;
            }
            if (getDocumentBatchScope() !== scope) return;
            importAbort.current?.abort();
            generationCancel.current?.();
            const token = ++revision.current;
            const loaded = next ? await getDocumentBatch(next.id, scope!) : makeBatch(scope!);
            if (token !== revision.current || getDocumentBatchScope() !== scope) return;
            setBatch(loaded);
            setSelected([]);
            setDirty(false);
            dirtyRef.current = false;
            setPage(1);
            setPdfPage(0);
        } catch (e) {
            fail(e);
        }
    };
    const importFile = async (file: File) => {
        const original = batchRef.current;
        if (!original || !scope) return;
        const batchId = original.id;
        const token = revision.current;
        const controller = new AbortController();
        importAbort.current?.abort();
        importAbort.current = controller;
        setImporting(true);
        setError("");
        try {
            let options: ImportOptions = { includeHidden, availableModels: selectableModelsByCapability(batchImageConfig(config), "image") };
            if (mappingText.trim()) {
                const parsed = JSON.parse(mappingText);
                if (!Array.isArray(parsed)) throw new Error("列映射必须是 JSON 数组");
                options = { ...options, mappings: parsed };
            }
            const pdf = /\.pdf$/i.test(file.name);
            const result = pdf ? await importPdfDocument(file, controller.signal) : await importXlsxDocument(file, options, controller.signal);
            if (controller.signal.aborted || token !== revision.current || getDocumentBatchScope() !== scope || batchRef.current?.id !== batchId) return;
            const current = batchRef.current!;
            if (current.imports?.some((i) => i.hash === result.hash) && !appendDuplicate) throw new Error("该文件已导入；勾选明确追加相同文件或新建批次后再导入");
            if (current.rows.length + result.rows.length > 500) throw new Error("导入后超过 500 行，请新建批次");
            const pages = "pages" in result ? result.pages : undefined;
            const unassigned = "unassigned" in result ? result.unassigned : [];
            update((b) => ({
                ...b,
                title: b.title === "未命名批次" ? file.name.replace(/\.[^.]+$/, "") : b.title,
                sourceFileName: file.name,
                sourceType: pdf ? "pdf" : /\.xls$/i.test(file.name) ? "xls" : "xlsx",
                rows: [...b.rows, ...result.rows.map((r, i) => ({ ...r, order: b.rows.length + i }))],
                diagnostics: [...b.diagnostics, ...result.diagnostics],
                unassigned: [...(b.unassigned || []), ...unassigned],
                imports: [...(b.imports || []), { id: nanoid(), hash: result.hash, name: file.name, blob: file, parser: pdf ? "pdf" : "xlsx", mappings: "mappings" in result ? result.mappings : undefined, pages }],
            }));
            message.success(`已导入 ${result.rows.length} 行，请核对诊断和参考图`);
        } catch (e) {
            if ((e as DOMException)?.name !== "AbortError") fail(e);
        } finally {
            if (importAbort.current === controller) setImporting(false);
        }
    };
    const updateRow = (id: string, patch: Partial<BatchRow>) => update((b) => ({ ...b, rows: b.rows.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: now() } : r)) }));
    const editPrompt = (row: BatchRow, prompt: string) => updateRow(row.id, promptEdit(row, prompt));
    const addRow = () => update((b) => ({ ...b, rows: [...b.rows, emptyRow(b.rows.length)] }));
    const duplicate = () => update((b) => ({ ...b, rows: [...b.rows, ...b.rows.filter((r) => selected.includes(r.id)).map((r) => ({ ...r, id: nanoid(), order: b.rows.length, results: [], title: `${r.title} 副本`, updatedAt: now() }))] }));
    const removeRows = () => {
        update((b) => ({ ...b, rows: b.rows.filter((r) => !selected.includes(r.id)).map((r, i) => ({ ...r, order: i })) }));
        setSelected([]);
    };
    const mergeRows = () => {
        if (selected.length < 2) return;
        update((b) => {
            const xs = b.rows.filter((r) => selected.includes(r.id));
            const first = xs[0];
            return {
                ...b,
                rows: [
                    ...b.rows.filter((r) => !selected.includes(r.id)),
                    {
                        ...first,
                        id: nanoid(),
                        prompt: xs
                            .map((x) => x.prompt)
                            .filter(Boolean)
                            .join("\n"),
                        title: xs.map((x) => x.title).join(" / "),
                        references: xs.flatMap((x) => x.references),
                        diagnostics: xs.flatMap((x) => x.diagnostics),
                        status: "needs-review" as const,
                        order: b.rows.length - xs.length,
                    },
                ].map((r, i) => ({ ...r, order: i })),
            };
        });
        setSelected([]);
    };
    const splitRow = (row: BatchRow) => {
        const lines = row.prompt
            .split(/\n+/)
            .map((x) => x.trim())
            .filter(Boolean);
        if (lines.length < 2) return;
        update((b) => ({
            ...b,
            rows: [
                ...b.rows.filter((r) => r.id !== row.id),
                ...lines.map((prompt, i) => ({ ...row, id: nanoid(), title: `${row.title}-${i + 1}`, prompt, order: b.rows.length + i, diagnostics: row.diagnostics, status: "needs-review" as const, updatedAt: now() })),
            ].map((r, i) => ({ ...r, order: i })),
        }));
    };
    const changeRef = (row: BatchRow, id: string, patch: Partial<BatchReference>) =>
        update((b) => ({ ...b, rows: b.rows.map((current) => (current.id === row.id ? { ...current, status: "needs-review", references: current.references.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : current)) }));
    const removeRef = (row: BatchRow, id: string) => updateRow(row.id, { references: row.references.filter((r) => r.id !== id) });
    const addRef = (row: BatchRow) => updateRow(row.id, { references: [...row.references, { id: nanoid(), name: "参考图", source: "手动新增", url: "" }] });
    const start = async () => {
        const current = batchRef.current;
        if (!current || !scope || !selected.length) return;
        setRunBusy(true);
        try {
            const saved = await persist();
            if (!saved || getDocumentBatchScope() !== scope) return;
            await prepareBatchGeneration(saved, selected, nanoid());
            if (getDocumentBatchScope() !== scope || batchRef.current?.id !== saved.id) return;
            generationCancel.current?.();
            const cancel = await startBatchSubmission(
                saved.id,
                scope,
                undefined,
                () =>
                    void listBatchItems(saved.id, scope).then((next) => {
                        if (getDocumentBatchScope() === scope && batchRef.current?.id === saved.id) setItems(next);
                    }),
                fail,
            );
            if (getDocumentBatchScope() !== scope || batchRef.current?.id !== saved.id) cancel();
            else generationCancel.current = cancel;
            message.success("生成计划已保存，开始提交");
        } catch (e) {
            fail(e);
        } finally {
            setRunBusy(false);
        }
    };
    const confirmStart = () => {
        const total = (batch?.rows || []).filter((r) => selected.includes(r.id)).reduce((n, r) => n + (r.overrides?.count || batch?.defaults?.count || 1), 0);
        modal.confirm({ title: "确认提交生成", content: `本轮选择 ${selected.length} 行，共 ${total} 个工作项。将使用当前账号配置请求供应商并可能产生费用，暂停仅阻止尚未提交的工作项；价格以供应商实际计费为准。`, okText: "确认提交", onOk: start });
    };
    const pause = async () => {
        try {
            generationCancel.current?.();
            await setBatchActive(batch!.id, scope!, false);
        } catch (e) {
            fail(e);
        }
    };
    const resume = async () => {
        const id = batch!.id;
        const currentScope = scope!;
        try {
            generationCancel.current?.();
            const cancel = await startBatchSubmission(
                id,
                currentScope,
                undefined,
                () =>
                    void listBatchItems(id, currentScope).then((next) => {
                        if (getDocumentBatchScope() === currentScope && batchRef.current?.id === id) setItems(next);
                    }),
                fail,
            );
            if (getDocumentBatchScope() !== currentScope || batchRef.current?.id !== id) cancel();
            else generationCancel.current = cancel;
        } catch (e) {
            fail(e);
        }
    };
    const moveRef = (row: BatchRow, id: string, delta: number) => {
        const refs = [...row.references];
        const i = refs.findIndex((r) => r.id === id);
        const j = i + delta;
        if (j < 0 || j >= refs.length) return;
        [refs[i], refs[j]] = [refs[j], refs[i]];
        updateRow(row.id, { references: refs });
    };
    const localRef = async (row: BatchRow, file: File, replaceId?: string) => {
        const activeBatch = batchRef.current?.id;
        const activeScope = scope;
        try {
            const reference = await loadBatchReference({ id: replaceId || nanoid(), name: file.name, url: "", source: "手动上传", blob: file, mimeType: file.type });
            if (getDocumentBatchScope() !== activeScope || batchRef.current?.id !== activeBatch) return;
            update((b) => ({ ...b, rows: b.rows.map((r) => (r.id === row.id ? { ...r, references: replaceId ? r.references.map((ref) => (ref.id === replaceId ? reference : ref)) : [...r.references, reference], status: "needs-review" } : r)) }));
        } catch (e) {
            fail(e);
        }
    };
    const externalRef = async (row: BatchRow, reference: BatchReference) => {
        const activeScope = scope;
        const activeBatch = batch?.id;
        try {
            const loaded = await loadBatchReference(reference, resourceAbort.current.signal);
            if (getDocumentBatchScope() === activeScope && batchRef.current?.id === activeBatch) changeRef(row, reference.id, loaded);
        } catch (e) {
            fail(e);
        }
    };
    const pdfPages = (batch?.imports || []).flatMap((i) => (i.pages || []).map((p) => ({ ...p, rotation: "rotation" in p ? Number(p.rotation) : 0, documentName: i.name })));
    const recognize = async () => {
        const currentPage = pdfPages[pdfPage],
            currentBatch = batchRef.current;
        const decoded = decodeChannelModel(recognitionModel);
        if (!currentPage || !currentBatch || !decoded) {
            fail(new Error("请选择支持图片输入的识别模型及渠道"));
            return;
        }
        const signal = resourceAbort.current.signal;
        setRecognizing(true);
        try {
            const rows = await recognizePdfPage(currentPage, decoded.channelId, decoded.model, signal);
            if (signal.aborted || batchRef.current?.id !== currentBatch.id || getDocumentBatchScope() !== currentBatch.scopeId) return;
            update((b) => ({ ...b, rows: [...b.rows, ...rows.map((r, i) => ({ ...r, order: b.rows.length + i }))] }));
        } catch (e) {
            if (!signal.aborted) fail(e);
        } finally {
            setRecognizing(false);
        }
    };
    const lastRun = runs[0]?.id;
    const visibleItems = items.filter((i) => resultScope === "all" || i.runId === lastRun);
    const progressItems = lastRun ? items.filter((i) => i.runId === lastRun) : [];
    const progressDone = progressItems.filter((i) => ["succeeded", "failed", "cancelled"].includes(i.state)).length;
    const progressActive = progressItems.filter((i) => ["submitting", "polling"].includes(i.state)).length;
    const progressFailed = progressItems.filter((i) => i.state === "failed").length;
    const progressPercent = progressItems.length ? Math.round((progressDone / progressItems.length) * 100) : 0;
    const progressUncertain = progressItems.filter((i) => i.state === "uncertain").length;
    const progressCancelled = progressItems.filter((i) => i.state === "cancelled").length;
    const results = visibleItems.flatMap((item) => item.results.filter((r) => !r.hidden).map((result) => ({ ...result, item })));
    const retryFailed = async () => {
        if (!batch || !scope) return;
        try {
            const run = await retryFailedBatchItems(batch.id, scope, failedIds, nanoid());
            if (getDocumentBatchScope() !== scope) return;
            setRuns((xs) => [run, ...xs]);
            setFailedIds([]);
            await resume();
        } catch (e) {
            fail(e);
        }
    };
    const hideResult = async (itemId: string, resultId: string) => {
        if (!batch || !scope) return;
        try {
            await hideBatchResult(batch.id, scope, itemId, resultId);
            if (getDocumentBatchScope() !== scope) return;
            setItems((xs) => xs.map((i) => (i.id === itemId ? { ...i, results: i.results.map((r) => (r.id === resultId ? { ...r, hidden: true } : r)) } : i)));
            setResultIds((xs) => xs.filter((id) => id !== resultId));
        } catch (e) {
            fail(e);
        }
    };
    const exportSelected = async () => {
        if (!batch) return;
        setExporting(true);
        try {
            const result = await exportBatchResults(batch, items, resultIds, resourceAbort.current.signal);
            if (result.failed.length) setError(`已下载 ${result.saved} 项，${result.failed.length} 项失败：${result.failed.map((f) => f.message).join("；")}`);
            else message.success(`已下载 ${result.saved} 项`);
        } catch (e) {
            fail(e);
        } finally {
            setExporting(false);
        }
    };
    const saveResultToAsset = async (result: { id: string; url: string; item: BatchWorkItem }) => {
        const signal = resourceAbort.current.signal;
        try {
            if (getDocumentBatchScope() !== result.item.scopeId) return;
            const reference = await loadResult(result.url, result.id, result.item.snapshot.source, signal);
            const stored = await uploadImage(reference.blob!, { signal });
            if (signal.aborted || getDocumentBatchScope() !== result.item.scopeId) return;
            addAsset({ kind: "image", title: result.item.snapshot.title, coverUrl: stored.url, tags: ["批量生成"], source: result.item.snapshot.source,
                data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "document-batch", rowId: result.item.snapshot.rowId, runId: result.item.runId, prompt: result.item.snapshot.prompt } });
            message.success("已存入资产");
        } catch (e) { fail(e); }
    };
    const filtered = useMemo(() => (batch?.rows || []).filter((r) => filter === "all" || (filter === "ready" ? r.status === "ready" : r.status !== "ready")), [batch, filter]);
    const pageRows = filtered.slice((page - 1) * 20, page * 20);
    if (loading) return <main className="flex h-full items-center justify-center">正在加载批量生成工作台…</main>;
    if (!scope)
        return (
            <main className="p-8">
                <Card>
                    <Empty description="当前未获取到工作区身份，无法读写批次" />
                </Card>
            </main>
        );
    if (!batch)
        return (
            <main className="p-8">
                <Alert type="error" message={error || "批次读取失败"} action={<Button onClick={() => void reload(scope)}>重试</Button>} />
            </main>
        );
    return (
        <main className="h-full overflow-y-auto bg-[#f5f2eb] px-4 py-6 text-stone-950 dark:bg-stone-950 dark:text-stone-100 sm:px-8">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <Typography.Title level={2} className="!mb-1">
                            批量生成工作台
                        </Typography.Title>
                        <Typography.Text type="secondary">导入文档，逐行核对后提交生成。</Typography.Text>
                    </div>
                    <Space wrap>
                        <Upload
                            accept=".xlsx,.xls,.pdf"
                            showUploadList={false}
                            beforeUpload={(file) => {
                                void importFile(file);
                                return false;
                            }}
                        >
                            <Button loading={importing} icon={<UploadCloud className="size-4" />}>
                                导入 Excel / PDF
                            </Button>
                        </Upload>
                        <Button onClick={() => void switchBatch()}>新建批次</Button>
                        <Button icon={<Plus className="size-4" />} onClick={addRow}>
                            新建行
                        </Button>
                        <Button type="primary" loading={saving} icon={<Save className="size-4" />} onClick={() => void persist().catch(() => undefined)}>
                            保存批次
                        </Button>
                        <Popconfirm
                            title="删除当前批次？"
                            onConfirm={async () => {
                                try {
                                    if (!batch.revision) {
                                        await switchBatch();
                                        return;
                                    }
                                    await deleteDocumentBatch(batch.id, scope, batch.revision);
                                    await reload(scope);
                                } catch (e) {
                                    fail(e);
                                }
                            }}
                        >
                            <Button danger icon={<Trash2 className="size-4" />}>
                                删除
                            </Button>
                        </Popconfirm>
                    </Space>
                </header>
                {error && <Alert closable onClose={() => setError("")} type="error" message={error} />}
                <Card>
                    <div className="flex flex-wrap items-center gap-3">
                        <Input aria-label="批次名称" value={batch.title} onChange={(e) => update((b) => ({ ...b, title: e.target.value }))} className="max-w-sm" prefix={<FileSpreadsheet className="size-4 text-stone-400" />} />
                        <span className="text-sm text-stone-500">
                            共 {batch.rows.length} 行 · 通过 {batch.rows.filter((r) => r.status === "ready").length} 行
                        </span>
                        {dirty && <Tag color="orange">有未保存修改</Tag>}
                    </div>
                </Card>
                <Card size="small" title="导入选项">
                    <div className="mb-3 space-y-2">
                        <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => { try { downloadDocumentBatchTemplate(); } catch { message.error("模板下载失败，请重试"); } }}>下载 Excel 模板</Button>
                        <Alert type="info" showIcon message="推荐按模板填写，一行对应一个任务" description={<ul className="list-disc pl-5">
                            <li>第一行为表头，提示词必填；标题、图片、数量可选。模型可在导入后统一选择。</li>
                            <li>参考图可为 0 张或多张：图片列的多个公开链接用换行分隔；也可插入标准浮动图片，并将图片完整放在对应行内。不要合并任务行。</li>
                            <li>使用前替换或删除模板示例。缺失提示词、未加载图片或归属不明确的行，需要修正并确认后才能生成。</li>
                            <li>优先使用 XLSX；XLS 内嵌图片、WPS 特殊图片和图片公式不保证识别。PDF 无需套模板，但需要核对解析结果。</li>
                        </ul>} />
                    </div>
                    <Space wrap>
                        <Checkbox checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)}>
                            包含隐藏行与隐藏工作表
                        </Checkbox>
                        <Checkbox checked={appendDuplicate} onChange={(e) => setAppendDuplicate(e.target.checked)}>
                            明确追加相同文件
                        </Checkbox>
                        {importing && <Button onClick={() => importAbort.current?.abort()}>取消导入</Button>}
                    </Space>
                    <details className="mt-3 text-sm">
                        <summary>Excel 工作表与列映射</summary>
                        <p>留空自动识别；指定映射时仅导入列出的表。headerRow 从 1 开始，列从 0 开始（A=0、B=1），-1 表示不映射。</p>
                        <Input.TextArea
                            aria-label="Excel 列映射 JSON"
                            value={mappingText}
                            onChange={(e) => setMappingText(e.target.value)}
                            placeholder={'[{"sheet":"Sheet1","headerRow":1,"prompt":0,"title":-1,"images":1}]'}
                            autoSize={{ minRows: 2, maxRows: 8 }}
                        />
                    </details>
                </Card>
                <Card title="批次默认生成设置">
                    <Settings value={batch.defaults || { model: "", count: 1, nativeParams: "{}" }} onChange={(defaults) => update((b) => ({ ...b, defaults }))} />
                    <label className="mt-3 flex items-center gap-3 text-sm">
                        并发上限
                        <InputNumber min={1} max={8} value={batch.concurrency || 3} onChange={(concurrency) => update((b) => ({ ...b, concurrency: concurrency || 1 }))} />
                    </label>
                </Card>
                {pdfPages.length > 0 && (
                    <Card title="PDF 原文与页面裁图">
                        <Pagination current={Math.min(pdfPage + 1, pdfPages.length)} pageSize={1} total={pdfPages.length} onChange={(p) => setPdfPage(p - 1)} />
                        {pdfPages[pdfPage] && (
                            <div className="mt-3 grid gap-4 md:grid-cols-2">
                                <DocumentPdfPreview
                                    page={pdfPages[pdfPage]}
                                    onCrop={(blob, crop) => {
                                        const p = pdfPages[pdfPage];
                                        update((b) => ({
                                            ...b,
                                            unassigned: [
                                                ...(b.unassigned || []),
                                                {
                                                    id: nanoid(),
                                                    name: `第 ${p.pageNumber} 页裁图`,
                                                    url: "",
                                                    blob,
                                                    mimeType: blob.type,
                                                    source: `${p.documentName} 第 ${p.pageNumber} 页 (${crop.x.toFixed(3)},${crop.y.toFixed(3)},${crop.width.toFixed(3)},${crop.height.toFixed(3)})`,
                                                },
                                            ],
                                        }));
                                    }}
                                />
                                <div>
                                    <div className="mb-4 space-y-2">
                                        <ModelPicker config={config} capability="text" value={recognitionModel} onChange={setRecognitionModel} fullWidth />
                                        <Popconfirm title="将把当前 PDF 页面图片发送给所选模型，可能产生识别费用。是否确认？" onConfirm={recognize}>
                                            <Button loading={recognizing} disabled={!recognitionModel}>
                                                识别当前页图文配对
                                            </Button>
                                        </Popconfirm>
                                        <p className="text-xs text-stone-500">请选择支持图片输入的模型。识别结果仍需逐行核对，识别不会自动提交生图。</p>
                                    </div>
                                    <Typography.Text strong>{pdfPages[pdfPage].documentName} · 页面原文</Typography.Text>
                                    <pre className="mt-2 whitespace-pre-wrap text-sm">{pdfPages[pdfPage].text || "未提取到文字，请手动填写提示词。"}</pre>
                                </div>
                            </div>
                        )}
                    </Card>
                )}
                {!!batch.unassigned?.length && (
                    <Card title="未归属参考图">
                        {batch.unassigned.map((reference) => (
                            <div key={reference.id} className="mb-3 flex items-center gap-3">
                                <ReferencePreview reference={reference} />
                                <span>
                                    {reference.name} · {reference.source}
                                </span>
                                <Select
                                    placeholder="指定归属行"
                                    className="min-w-48"
                                    options={batch.rows.map((r) => ({ value: r.id, label: r.title }))}
                                    onChange={(id) =>
                                        update((b) => ({ ...b, unassigned: b.unassigned?.filter((r) => r.id !== reference.id), rows: b.rows.map((r) => (r.id === id ? { ...r, references: [...r.references, reference], status: "needs-review" } : r)) }))
                                    }
                                />
                            </div>
                        ))}
                    </Card>
                )}
                {batch.diagnostics.length > 0 && (
                    <Card size="small" className="border-amber-200 bg-amber-50/60">
                        <Typography.Text strong>导入诊断</Typography.Text>
                        <List
                            size="small"
                            dataSource={batch.diagnostics}
                            renderItem={(d) => (
                                <List.Item>
                                    <span className={d.severity === "error" ? "text-red-600" : "text-amber-700"}>
                                        {d.message}
                                        {d.locator ? `（${d.locator}）` : ""}
                                    </span>
                                </List.Item>
                            )}
                        />
                    </Card>
                )}
                <Card
                    title={
                        <Space>
                            <span>任务行</span>
                            <Select
                                size="small"
                                value={filter}
                                onChange={(v) => {
                                    setFilter(v);
                                    setPage(1);
                                }}
                                options={[
                                    { value: "all", label: "全部" },
                                    { value: "ready", label: "可生成" },
                                    { value: "review", label: "待确认" },
                                ]}
                            />
                            <Button size="small" icon={<Copy className="size-3" />} disabled={!selected.length} onClick={duplicate}>
                                复制
                            </Button>
                            <Button size="small" icon={<Merge className="size-3" />} disabled={selected.length < 2} onClick={mergeRows}>
                                合并
                            </Button>
                            <Button size="small" icon={<Trash2 className="size-3" />} danger disabled={!selected.length} onClick={removeRows}>
                                删除
                            </Button>
                        </Space>
                    }
                >
                    {pageRows.length === 0 ? (
                        <Empty description="没有匹配的任务行" />
                    ) : (
                        <List
                            dataSource={pageRows}
                            rowKey="id"
                            renderItem={(row) => (
                                <List.Item>
                                    <div className="w-full space-y-3">
                                        <div className="flex gap-3">
                                            <Checkbox aria-label={`选择 ${row.title}`} checked={selected.includes(row.id)} onChange={(e) => setSelected((xs) => (e.target.checked ? [...new Set([...xs, row.id])] : xs.filter((x) => x !== row.id)))} />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Input aria-label="行标题" value={row.title} onChange={(e) => updateRow(row.id, { title: e.target.value })} className="max-w-xs" />
                                                    {row.status === "ready" ? <Tag color="green">可生成</Tag> : <Tag color="gold">待确认</Tag>}
                                                    <Typography.Text type="secondary">{row.source}</Typography.Text>
                                                    <Button size="small" icon={<Split className="size-3" />} onClick={() => splitRow(row)}>
                                                        按换行拆分
                                                    </Button>
                                                </div>
                                                <Input.TextArea aria-label={`${row.title}提示词`} className="mt-2" value={row.prompt} onChange={(e) => editPrompt(row, e.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} placeholder="输入提示词" />
                                            </div>
                                        </div>
                                        <div className="ml-8 space-y-2">
                                            {row.references.map((ref) => (
                                                <div className="flex items-center gap-2" key={ref.id}>
                                                    <ReferencePreview reference={ref} />
                                                    <Button size="small" aria-label="参考图前移" onClick={() => moveRef(row, ref.id, -1)}>
                                                        ↑
                                                    </Button>
                                                    <Button size="small" aria-label="参考图后移" onClick={() => moveRef(row, ref.id, 1)}>
                                                        ↓
                                                    </Button>
                                                    <Input aria-label="参考图 URL" disabled={!!ref.blob} size="small" value={ref.url} placeholder="https:// 图片地址（保存后手动加载）" onChange={(e) => changeRef(row, ref.id, { url: e.target.value })} />
                                                    <Button size="small" icon={<X className="size-3" />} onClick={() => removeRef(row, ref.id)} />
                                                    <Tag>{ref.name}</Tag>
                                                    {!ref.blob && (
                                                        <Popconfirm title="将访问该图片来源，不携带供应商密钥。确认加载？" onConfirm={() => externalRef(row, ref)}>
                                                            <Button size="small" disabled={!ref.url}>
                                                                加载外部图片
                                                            </Button>
                                                        </Popconfirm>
                                                    )}
                                                    <Upload
                                                        accept="image/png,image/jpeg,image/webp,image/gif"
                                                        showUploadList={false}
                                                        beforeUpload={(file) => {
                                                            void localRef(row, file, ref.id);
                                                            return false;
                                                        }}
                                                    >
                                                        <Button size="small">替换图片</Button>
                                                    </Upload>
                                                </div>
                                            ))}
                                            <Space>
                                                <Button size="small" disabled={row.references.length >= 16} onClick={() => addRef(row)}>
                                                    添加图片链接
                                                </Button>
                                                <Upload
                                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                                    showUploadList={false}
                                                    beforeUpload={(file) => {
                                                        void localRef(row, file);
                                                        return false;
                                                    }}
                                                >
                                                    <Button size="small" disabled={row.references.length >= 16}>
                                                        上传参考图
                                                    </Button>
                                                </Upload>
                                                <Button size="small" disabled={!row.prompt.trim() || row.references.some((r) => !r.blob)} onClick={() => {
                                                    if (!row.diagnostics.length) { void updateRow(row.id, { status: "ready" }); return; }
                                                    modal.confirm({ title: "确认已逐项处理导入诊断", content: row.diagnostics.map(d => d.message).join("；"), okText: "已修正并确认", onOk: () => updateRow(row.id, { status: "ready", diagnostics: [] }) });
                                                }}>
                                                    已核对归属与诊断
                                                </Button>
                                            </Space>
                                            <details className="mt-2">
                                                <summary>单行生成设置（覆盖批次默认值）</summary>
                                                <Checkbox checked={!!row.overrides} onChange={(e) => updateRow(row.id, { overrides: e.target.checked ? { ...batch.defaults } : undefined })}>
                                                    启用单行设置
                                                </Checkbox>
                                                {row.overrides && <Settings value={{ model: "", count: 1, nativeParams: "{}", ...batch.defaults, ...row.overrides }} onChange={(overrides) => updateRow(row.id, { overrides })} />}
                                            </details>
                                            {row.diagnostics.map((d) => (
                                                <div className="text-xs text-amber-700" key={d.id}>
                                                    {d.message}
                                                    {d.locator ? `（${d.locator}）` : ""}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </List.Item>
                            )}
                        />
                    )}
                    <Pagination className="mt-4" current={page} pageSize={20} total={filtered.length} showSizeChanger={false} onChange={setPage} />
                </Card>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white/95 px-4 py-3 shadow-lg">
                    <span className="text-sm">已选择 {selected.length} 行</span>
                    <Space>
                        <Button icon={<Pause className="size-4" />} onClick={() => void pause()}>
                            暂停
                        </Button>
                        <Button onClick={resume} disabled={!items.some((i) => i.state === "queued")}>
                            继续已排队任务
                        </Button>
                        <Popconfirm title="取消全部尚未提交的任务？已提交任务继续查询。" onConfirm={() => cancelQueuedItems(batch.id, scope)}>
                            <Button>取消排队</Button>
                        </Popconfirm>
                        <Button icon={<Play className="size-4" />} type="primary" disabled={!selected.length || runBusy} loading={runBusy} onClick={confirmStart}>
                            提交生成
                        </Button>
                    </Space>
                </div>
                <Card
                    title="生成结果"
                    extra={
                        <Space>
                            <Select
                                value={resultScope}
                                onChange={(v) => {
                                    setResultScope(v);
                                    setResultIds([]);
                                    setFailedIds([]);
                                }}
                                options={[
                                    { value: "latest", label: "当前轮次" },
                                    { value: "all", label: "全部历史" },
                                ]}
                            />
                            <Button loading={exporting} disabled={!resultIds.length} onClick={() => void exportSelected()}>
                                下载所选 ZIP
                            </Button>
                        </Space>
                    }
                >
                    <div className="mb-3 text-sm">
                        <div className="mb-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-3" aria-live="polite" aria-label="批量生成进度">
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span className="font-medium">本轮进度</span>
                                <span>{progressDone}/{progressItems.length || 0} 已结束{progressActive ? ` · ${progressActive} 个处理中` : ""}</span>
                            </div>
                            <Progress percent={progressPercent} status={progressFailed ? "exception" : progressCancelled ? "normal" : progressPercent === 100 ? "success" : progressActive ? "active" : "normal"} showInfo />
                            <div className="mt-1 text-xs text-stone-500">
                                {progressItems.length === 0 ? "提交后将在这里显示实时进度" : `排队 ${progressItems.filter((i) => i.state === "queued").length} · 成功 ${progressItems.filter((i) => i.state === "succeeded").length} · 失败 ${progressFailed} · 待确认 ${progressUncertain} · 已取消 ${progressCancelled}`}
                                {progressItems.length > 0 && <div className="mt-1">进度按已结束任务数量统计，不代表单张图片的生成百分比。暂停只阻止后续提交，在途任务继续处理。</div>}
                            </div>
                        </div>
                        {items.length} 个工作项 · 排队 {items.filter((i) => i.state === "queued").length} · 完成 {items.filter((i) => i.state === "succeeded").length} · 失败 {items.filter((i) => i.state === "failed").length}
                    </div>
                    {visibleItems
                        .filter((i) => i.error)
                        .map((item) => (
                            <div key={item.id} className="mb-2 flex gap-2">
                                {item.state === "failed" && (
                                    <Checkbox
                                        aria-label={`重试 ${item.snapshot.title} 的失败工作项`}
                                        checked={failedIds.includes(item.id)}
                                        onChange={(e) => setFailedIds((ids) => (e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)))}
                                    />
                                )}
                                <Alert className="flex-1" type="warning" message={`${item.snapshot.title}：${item.error}`} />
                            </div>
                        ))}
                    <Popconfirm title={`仅重试已选 ${failedIds.length} 个明确失败工作项，沿用原输入快照，可能再次计费。确认？`} onConfirm={retryFailed}>
                        <Button className="mb-3" disabled={!failedIds.length}>
                            重试所选失败项
                        </Button>
                    </Popconfirm>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        {results.map((result) => (
                            <div key={result.id} className="space-y-2 rounded border p-2">
                                <Checkbox checked={resultIds.includes(result.id)} onChange={(e) => setResultIds((ids) => (e.target.checked ? [...ids, result.id] : ids.filter((id) => id !== result.id)))}>
                                    {result.item.snapshot.title}
                                </Checkbox>
                                <Button size="small" onClick={() => void hideResult(result.item.id, result.id)}>
                                    隐藏此结果
                                </Button>
                                <Button size="small" onClick={() => void saveResultToAsset(result)}>
                                    存入资产
                                </Button>
                                <ResultPreview result={result} title={result.item.snapshot.title} />
                            </div>
                        ))}
                    </div>
                    {!results.length && <Empty description={progressActive ? `正在处理 ${progressActive} 个任务，完成后图片将在这里显示` : progressUncertain ? "部分任务受理结果待确认，不会自动重新提交" : "暂无成功结果"} />}
                </Card>
                {batches.length > 0 && (
                    <Card size="small" title="批次历史">
                        <Space wrap>
                            {batches.map((item) => (
                                <Button key={item.id} type={item.id === batch.id ? "primary" : "default"} onClick={() => void switchBatch(item)}>
                                    {item.title}
                                </Button>
                            ))}
                        </Space>
                    </Card>
                )}
            </div>
        </main>
    );
}
