import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Alert, Button, InputNumber, Space, Typography } from "antd";
import { Crop, RotateCcw } from "lucide-react";
import type { NormalizedRect, PdfImportedPage } from "@/services/document-pdf-import";
import { cropCanvasToBlob, normalizeCrop } from "@/services/document-pdf-import";

type Props = { page: PdfImportedPage; onCrop?: (blob: Blob, crop: NormalizedRect) => void };

/** A manual, source-preserving page crop. It never claims to infer image boundaries. */
export default function DocumentPdfPreview({ page, onCrop }: Props) {
    const imageRef = useRef<HTMLImageElement>(null);
    const [crop, setCrop] = useState<NormalizedRect>({ x: 0, y: 0, width: 1, height: 1 });
    const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
    const [objectUrl, setObjectUrl] = useState<string>();
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);
    const [loadedUrl, setLoadedUrl] = useState<string>();
    const imageReady = Boolean(objectUrl && loadedUrl === objectUrl);
    useEffect(() => { const url = URL.createObjectURL(page.blob); setObjectUrl(url); return () => URL.revokeObjectURL(url); }, [page.blob]);
    const point = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
    };
    const start = (event: ReactPointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); setDrag(point(event)); setCrop({ x: 0, y: 0, width: 0, height: 0 }); };
    const move = (event: ReactPointerEvent<HTMLDivElement>) => { if (!drag) return; const end = point(event); const rect = event.currentTarget.getBoundingClientRect(); setCrop(normalizeCrop({ x: Math.min(drag.x, end.x), y: Math.min(drag.y, end.y), width: Math.abs(end.x - drag.x), height: Math.abs(end.y - drag.y) }, rect.width, rect.height)); };
    const finish = () => setDrag(null);
    const emitCrop = async () => {
        if (!imageReady || !imageRef.current?.complete || !imageRef.current.naturalWidth || crop.width <= 0 || crop.height <= 0 || !onCrop) return;
        setBusy(true); setError(undefined);
        try {
        const canvas = document.createElement("canvas"); canvas.width = page.width; canvas.height = page.height;
        const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器不支持画布");
        context.drawImage(imageRef.current, 0, 0, page.width, page.height);
        onCrop(await cropCanvasToBlob(canvas, crop), crop);
        } catch (error) { setError(error instanceof Error ? error.message : "裁图失败"); } finally { setBusy(false); }
    };
    return <section aria-label={`PDF 第 ${page.pageNumber} 页预览`} className="space-y-2">
        <div className="flex items-center justify-between gap-2"><Typography.Text strong>第 {page.pageNumber} 页</Typography.Text><Space>
            <Button size="small" icon={<RotateCcw className="size-3.5" />} aria-label="重置裁剪" onClick={() => setCrop({ x: 0, y: 0, width: 1, height: 1 })}>重置</Button>
            <Button size="small" type="primary" loading={busy} icon={<Crop className="size-3.5" />} onClick={() => void emitCrop()} disabled={!onCrop || !imageReady || crop.width <= 0}>使用裁剪区域</Button>
        </Space></div>
        <div className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded border" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} aria-label="拖动框选 PDF 页面区域">
            {objectUrl && <img ref={imageRef} src={objectUrl} alt={`第 ${page.pageNumber} 页原始页面`} onLoad={() => setLoadedUrl(objectUrl)} onError={() => setLoadedUrl(undefined)} className="block max-h-[70vh] max-w-full" draggable={false} />}
            {crop.width > 0 && <div className="pointer-events-none absolute border-2 border-sky-500 bg-sky-400/20" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} />}
        </div>
        <Space wrap>{(["x", "y", "width", "height"] as const).map((key) => <label key={key} className="text-xs">{{ x: "左", y: "上", width: "宽", height: "高" }[key]}（%）<InputNumber size="small" aria-label={`裁图${key}百分比`} min={0} max={100} value={Math.round(crop[key] * 1000) / 10} onChange={(value) => { const changed = { ...crop, [key]: Number(value || 0) / 100 }; setCrop(normalizeCrop(changed, 1, 1)); }} /></label>)}</Space>
        {error && <Alert type="error" showIcon message={error} />}
        <Typography.Paragraph type="secondary" className="!mb-0 text-xs">来源保留为 PDF 页面裁图；请手动框选，系统不会把启发式区域当作确定识别。</Typography.Paragraph>
    </section>;
}
