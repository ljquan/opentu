// 便利贴节点:纯展示便利贴——整块可拖动、双击编辑、右上角自选颜色。
// 不再声明 resource(避免宿主在右上角显示「文本N」资源角标),也不再衍生节点。
import { definePlugin, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

// 预设便签色(点选切换),并额外提供自定义取色
const PRESET_COLORS = ["#fde68a", "#fca5a5", "#fdba74", "#a7f3d0", "#bfdbfe", "#ddd6fe", "#f9a8d4", "#e7e5e4"];
const DEFAULT_COLOR = PRESET_COLORS[0];

function StickyNoteContent({ ctx }: CanvasNodeContentProps) {
    const [editing, setEditing] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    // 取色时的本地预览色:仅本组件即时重渲染,避免每次都写宿主 store
    const [draftColor, setDraftColor] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const commitTimerRef = useRef<number | null>(null);

    // pluginColor 是插件自定义 metadata 字段(读出为 unknown,按需断言)
    const committedColor = (ctx.node.metadata?.pluginColor as string | undefined) || DEFAULT_COLOR;
    const color = draftColor ?? committedColor;
    const content = (ctx.node.metadata?.content as string | undefined) || "";

    // 点击便利贴外部时:退出编辑并收起调色板。
    // 监听 pointerdown 的 capture 阶段:宿主画布在 pointerdown 上 preventDefault(会抑制
    // 兼容 mousedown 事件),所以必须用 pointerdown;capture 阶段又能先于宿主的 stopPropagation
    // 触发,避免「按 Esc 能退出、点别处退不出」。
    useEffect(() => {
        if (!editing && !paletteOpen) return;
        const onDocDown = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setEditing(false);
                setPaletteOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDocDown, true);
        return () => document.removeEventListener("pointerdown", onDocDown, true);
    }, [editing, paletteOpen]);

    const pickColor = (next: string) => ctx.updateMetadata({ pluginColor: next });

    // 连续取色(系统取色器拖动时 onChange 高频触发)会不停调用 updateMetadata,
    // 而宿主每次都会整表重建 + 全画布重渲染 + 持久化,导致卡顿。
    // 这里先本地预览(setDraftColor),再节流提交到宿主。
    const previewColor = (next: string) => {
        setDraftColor(next);
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = window.setTimeout(() => {
            commitTimerRef.current = null;
            pickColor(next);
        }, 150);
    };

    // 立即提交(点击预设色、取色器关闭时用):清掉待提交的节流并写入。
    const commitColor = (next: string) => {
        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
            commitTimerRef.current = null;
        }
        setDraftColor(next);
        pickColor(next);
    };

    useEffect(() => () => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    }, []);

    // 宿主里的颜色一旦真正变化(提交完成 / 撤销重做),清掉本地预览,回到 store 为准。
    // 拖动取色期间 committedColor 不变,draftColor 得以保留,故不影响即时预览。
    useEffect(() => {
        setDraftColor(null);
    }, [committedColor]);

    // 交互控件上按下时阻止冒泡,避免误触发节点拖动/双击编辑
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

    return (
        <div
            ref={rootRef}
            data-canvas-no-zoom
            style={{ position: "relative", height: "100%", width: "100%", display: "flex", flexDirection: "column", background: color, borderRadius: 16, padding: 14, boxSizing: "border-box", cursor: editing ? "text" : "move", boxShadow: "inset 0 1px 0 rgba(255,255,255,.45)" }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
            }}
        >
            {/* 右上角:当前颜色小圆点,点开后自选颜色(预设 + 自定义) */}
            <div style={{ position: "absolute", top: 8, right: 8, zIndex: 5 }} onMouseDown={stop} onDoubleClick={stop}>
                <button
                    type="button"
                    title="选择颜色"
                    onClick={() => setPaletteOpen((v) => !v)}
                    style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid rgba(0,0,0,.25)", background: color, cursor: "pointer", padding: 0, boxShadow: "0 1px 3px rgba(0,0,0,.2)" }}
                />
                {paletteOpen ? (
                    <div style={{ position: "absolute", top: 28, right: 0, display: "grid", gridTemplateColumns: "repeat(4, 20px)", gap: 6, padding: 8, borderRadius: 12, background: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
                        {PRESET_COLORS.map((c) => (
                            <button
                                key={c}
                                type="button"
                                title={c}
                                onClick={() => {
                                    commitColor(c);
                                    setPaletteOpen(false);
                                }}
                                style={{ width: 20, height: 20, borderRadius: "50%", border: c === color ? "2px solid #1c1917" : "2px solid rgba(0,0,0,.12)", background: c, cursor: "pointer", padding: 0 }}
                            />
                        ))}
                        {/* 自定义取色:点击彩环唤起系统取色器。拖动时本地预览 + 节流提交,松开(blur)时立即提交 */}
                        <label title="自定义颜色" style={{ position: "relative", width: 20, height: 20, borderRadius: "50%", cursor: "pointer", background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)", border: "2px solid rgba(0,0,0,.12)", boxSizing: "border-box" }}>
                            <input type="color" value={color} onChange={(e) => previewColor(e.target.value)} onBlur={(e) => commitColor(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", border: "none", padding: 0, cursor: "pointer" }} />
                        </label>
                    </div>
                ) : null}
            </div>

            {/* 内容区:双击进入编辑;非编辑态整块可直接拖动移动节点 */}
            {editing ? (
                <textarea
                    autoFocus
                    value={content}
                    placeholder="输入便利贴内容…（点击别处或按 Esc 退出编辑）"
                    onChange={(e) => ctx.updateMetadata({ content: e.target.value })}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.stopPropagation();
                            setEditing(false);
                        }
                    }}
                    onMouseDown={stop}
                    onPointerDown={stop}
                    onWheel={stop}
                    style={{ flex: 1, width: "100%", resize: "none", border: "none", outline: "none", background: "transparent", color: "#1c1917", fontSize: 15, lineHeight: 1.5, fontFamily: "inherit" }}
                />
            ) : (
                <div style={{ flex: 1, whiteSpace: "pre-wrap", overflow: "hidden", color: content ? "#1c1917" : "rgba(28,25,23,.45)", fontSize: 15, lineHeight: 1.5, userSelect: "none", paddingRight: 22 }}>{content || "双击编辑便利贴"}</div>
            )}
        </div>
    );
}

export default definePlugin({
    id: "sticky-note",
    name: "便利贴节点",
    version: "1.1.0",
    description: "可自选颜色、双击编辑、拖动即可移动的便利贴",
    nodes: [
        {
            type: "sticky-note:note",
            title: "便利贴",
            icon: "📌",
            description: "彩色便利贴",
            defaultSize: { width: 240, height: 200 },
            defaultMetadata: { content: "", pluginColor: DEFAULT_COLOR },
            minimapColor: "#f59e0b",
            // 纯记事节点:不弹出下方生成面板(默认会是「生成图片」的提示词面板)
            hidePanel: true,
            Content: StickyNoteContent,
        },
    ],
});
