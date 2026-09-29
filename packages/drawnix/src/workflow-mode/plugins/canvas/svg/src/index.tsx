// SVG 节点:编辑与渲染 SVG,透明背景直接融入画布;无自身内容时可取上游文本节点里的 SVG 源码。
import { definePlugin, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

function SvgContent({ ctx }: CanvasNodeContentProps) {
    const [editing, setEditing] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const stored = ctx.node.metadata?.content as string | undefined;
    const upstream = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .find((text): text is string => typeof text === "string" && text.trim().startsWith("<svg"));
    const value = stored ?? "";
    const svg = value.trim() || upstream || "";

    // 无自身内容但有上游 SVG:自动采用上游源码
    useEffect(() => {
        if (stored === undefined && upstream) ctx.updateMetadata({ content: upstream });
    }, [ctx, stored, upstream]);

    // 点击节点外部时退出编辑。用 pointerdown 的 capture 阶段:宿主画布在 pointerdown 上
    // preventDefault 会抑制 mousedown,capture 又能先于宿主 stopPropagation 触发。
    useEffect(() => {
        if (!editing) return;
        const onDocDown = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setEditing(false);
        };
        document.addEventListener("pointerdown", onDocDown, true);
        return () => document.removeEventListener("pointerdown", onDocDown, true);
    }, [editing]);

    // 交互控件上按下时阻止冒泡,避免误触发节点拖动/双击编辑
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

    const toggle = { position: "absolute", right: 8, top: 8, zIndex: 20, width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: `${ctx.theme.toolbar.panel}dd`, color: ctx.theme.node.text, cursor: "pointer" } as const;

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column", cursor: editing ? "text" : "move" }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
            }}
        >
            <button type="button" style={toggle} onMouseDown={stop} onClick={() => setEditing((v) => !v)} title={editing ? "预览" : "编辑源码"}>
                {editing ? "👁" : "✎"}
            </button>
            {editing ? (
                <textarea
                    autoFocus
                    value={value}
                    placeholder="粘贴 SVG 源码,如 <svg …>…</svg>"
                    onChange={(e) => ctx.updateMetadata({ content: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            setEditing(false);
                        }
                    }}
                    onMouseDown={stop}
                    onPointerDown={stop}
                    onWheel={stop}
                    style={{ height: "100%", width: "100%", resize: "none", background: ctx.theme.node.fill, borderRadius: 16, padding: 16, boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, outline: "none", border: `1px solid ${ctx.theme.node.stroke}`, color: ctx.theme.node.text }}
                />
            ) : svg ? (
                // pointerEvents:none 让整块可拖动移动,双击/拖拽都命中外层节点
                <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, boxSizing: "border-box", pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
                <div style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box", color: ctx.theme.node.placeholder, fontSize: 13, textAlign: "center", pointerEvents: "none" }}>双击编辑,粘贴 SVG 源码</div>
            )}
        </div>
    );
}

export default definePlugin({
    id: "svg",
    name: "SVG 节点",
    version: "1.1.0",
    description: "透明背景渲染 SVG 矢量图,可接收上游文本节点的 SVG 源码",
    nodes: [
        {
            type: "svg:vector",
            title: "SVG",
            icon: "🔷",
            description: "渲染 SVG 矢量图",
            defaultSize: { width: 320, height: 320 },
            defaultMetadata: {},
            minimapColor: "#14b8a6",
            // 背景/边框透明,矢量图直接融入画布
            transparentBackground: true,
            Content: SvgContent,
        },
    ],
});
