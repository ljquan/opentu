import type { BatchRow } from "@/types/document-batch";

/** Prompt edits must not implicitly approve ambiguous document/image pairing. */
export function promptEdit(row: BatchRow, prompt: string): Partial<BatchRow> {
    const diagnostics = row.diagnostics.filter((d) => !d.message.includes("提示词为空"));
    if (!prompt.trim()) diagnostics.push({ id: `${row.id}-empty-prompt`, severity: "warning", message: "提示词为空，需要补录" });
    return { prompt, diagnostics, status: prompt.trim() && !diagnostics.length && !row.references.some((r) => !r.blob) ? "ready" : "needs-review" };
}
export function validateEditedBatch(rows: BatchRow[]): string | undefined {
    if (rows.length > 500) return "批次最多 500 行，请拆分";
    if (rows.some((r) => r.references.length > 16)) return "每行最多 16 张参考图，请拆分";
    return undefined;
}
