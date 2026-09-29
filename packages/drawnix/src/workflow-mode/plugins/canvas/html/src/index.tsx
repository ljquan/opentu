// HTML 节点:沙箱 iframe 渲染 HTML,{{input}} 会替换为上游文本节点内容。
// 交互:预览态 iframe 默认 pointer-events:none —— 鼠标事件穿透到宿主节点体,
// 因此点节点任意位置都能拖动,无需在节点上加任何标题栏/按钮。
// 「编辑/预览」与「交互」开关都放在节点外的悬浮工具条(toolbar 扩展点),状态存 metadata。
import { definePlugin, useMemo, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

// 源码编辑器行高/字号,行号槽与文本域必须完全一致才能对齐
const EDITOR_FONT = 12;
const EDITOR_LINE = 20;

function HtmlEditor({ ctx, value }: { ctx: CanvasNodeContentProps["ctx"]; value: string }) {
    const gutterRef = useRef<HTMLDivElement>(null);
    // 行数:按换行统计,至少 1 行;value 变化时重算
    const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
    const [scrollTop, setScrollTop] = useState(0);

    const codeStyle = { fontFamily: "monospace", fontSize: EDITOR_FONT, lineHeight: `${EDITOR_LINE}px`, boxSizing: "border-box" } as const;

    return (
        <div data-canvas-no-zoom style={{ height: "100%", width: "100%", display: "flex", overflow: "hidden", borderRadius: 16, background: ctx.theme.node.fill }} onMouseDown={(e) => e.stopPropagation()}>
            {/* 行号槽:跟随文本域滚动,不可单独滚动 */}
            <div
                ref={gutterRef}
                aria-hidden
                style={{
                    ...codeStyle,
                    flex: "0 0 auto",
                    padding: "16px 8px 16px 12px",
                    textAlign: "right",
                    color: ctx.theme.node.placeholder,
                    background: `${ctx.theme.toolbar.panel}66`,
                    borderRight: `1px solid ${ctx.theme.node.stroke}`,
                    overflow: "hidden",
                    userSelect: "none",
                    whiteSpace: "pre",
                }}
            >
                {/* 用负 margin 让整列跟随 scrollTop 平移,和 textarea 同步 */}
                <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                    {Array.from({ length: lineCount }, (_, i) => (
                        <div key={i}>{i + 1}</div>
                    ))}
                </div>
            </div>
            <textarea
                autoFocus
                value={value}
                placeholder="<div>Hello, {{input}}</div>"
                spellCheck={false}
                wrap="off"
                onChange={(e) => ctx.updateMetadata({ content: e.target.value })}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                onMouseDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{ ...codeStyle, flex: "1 1 auto", minWidth: 0, height: "100%", resize: "none", background: "transparent", padding: "16px 16px 16px 12px", outline: "none", border: "none", color: ctx.theme.node.text, whiteSpace: "pre", overflow: "auto" }}
            />
        </div>
    );
}

function HtmlContent({ ctx }: CanvasNodeContentProps) {
    const value = ctx.node.metadata?.content || "";
    const editing = Boolean(ctx.node.metadata?.editing);
    const upstreamText = useMemo(
        () =>
            ctx
                .getUpstream()
                .map((node) => node.metadata?.content)
                .filter(Boolean)
                .join("\n"),
        [ctx],
    );
    const html = value.replace(/\{\{\s*input\s*\}\}/g, upstreamText);

    if (editing) {
        return <HtmlEditor ctx={ctx} value={value} />;
    }

    if (!value) {
        return (
            <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: ctx.theme.node.placeholder }}>
                <span style={{ fontSize: 26 }}>{"</>"}</span>
                <span style={{ fontSize: 13 }}>选中节点,点上方工具条的 ✎ 编辑 HTML</span>
            </div>
        );
    }

    // 预览态:iframe 的鼠标交互由宿主「交互 ⇄ 移动」开关统一控制(见 interactionToggle),
    // 这里无需再手动做 pointer-events 穿透。data-canvas-no-zoom 保证交互时滚动作用于页面而非缩放画布。
    return (
        <div data-canvas-no-zoom style={{ position: "relative", height: "100%", width: "100%" }}>
            <iframe
                title="html-preview"
                sandbox="allow-scripts allow-forms"
                srcDoc={html}
                style={{ height: "100%", width: "100%", border: 0, borderRadius: 16, background: "#fff", display: "block" }}
            />
        </div>
    );
}

export default definePlugin({
    id: "html",
    name: "HTML 节点",
    version: "1.2.0",
    description: "沙箱 iframe 渲染 HTML,支持 {{input}} 注入上游文本",
    nodes: [
        {
            type: "html:render",
            title: "HTML",
            icon: "🌐",
            description: "沙箱渲染 HTML",
            defaultSize: { width: 420, height: 320 },
            defaultMetadata: { content: "" },
            minimapColor: "#ec4899",
            hidePanel: true, // 纯展示型节点:点击/新建不弹出下方生图面板
            // 宿主统一提供「交互 ⇄ 移动」开关;编辑态强制可交互(编辑器始终可操作)并隐藏该开关
            interactionToggle: true,
            forceInteractive: (node) => Boolean(node.metadata?.editing),
            Content: HtmlContent,
            // 仅保留「编辑/预览」开关;交互/移动 由宿主自动注入
            toolbar: (ctx) => {
                const editing = Boolean(ctx.node.metadata?.editing);
                return [
                    {
                        id: "html-toggle-edit",
                        title: editing ? "预览渲染结果" : "编辑 HTML 源码",
                        label: editing ? "预览" : "编辑",
                        icon: editing ? "👁" : "✎",
                        active: editing,
                        onClick: () => ctx.updateMetadata({ editing: !editing }),
                    },
                ];
            },
        },
    ],
});
