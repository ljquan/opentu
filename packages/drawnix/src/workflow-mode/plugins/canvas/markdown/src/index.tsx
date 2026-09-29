// Markdown 节点:编辑与渲染 Markdown。marked 从 CDN 按需加载,不打进插件体积。
// 移动/交互:走宿主统一的「交互 ⇄ 移动」开关(interactionToggle)——默认「移动」态整块可拖,
//   切「交互」态可滚动/选择;编辑态强制可交互。
// 防闪烁:解析结果按源码模块级缓存,且只在 HTML 真正变化时写入 DOM——
//   画布任何重渲染都不会重新解析或重载 Markdown 里的图片。
// styles.css 由 esbuild 以 text 方式打进 bundle,通过 plugin.css 自动注入。
import { definePlugin, useEffect, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

import css from "./styles.css";

type Marked = { parse: (src: string) => string };

let marked: Marked | undefined; // 加载完成后的 marked 实例,模块级缓存,后续同步渲染
let markedPromise: Promise<Marked> | undefined;
function loadMarked(): Promise<Marked> {
    if (marked) return Promise.resolve(marked);
    if (!markedPromise) markedPromise = import("https://esm.sh/marked@14").then((mod: { marked: Marked }) => (marked = mod.marked));
    return markedPromise;
}

const PLACEHOLDER = "*选中节点,点上方工具条的 ✎ 编辑 Markdown*";

// 解析结果按源码缓存(模块级):同一段 Markdown 只解析一次,重复渲染/重挂载都命中缓存,
// 返回的是同一个字符串引用,配合下方「值不变不写 DOM」彻底避免图片被重新请求。
const htmlCache = new Map<string, string>();
function renderMarkdown(source: string): string {
    if (!marked) return "";
    const key = source || PLACEHOLDER;
    let out = htmlCache.get(key);
    if (out === undefined) {
        out = marked.parse(key);
        htmlCache.set(key, out);
    }
    return out;
}

// 预览态:用 ref 手动写 innerHTML,且仅在 html 真正变化时写入。
// 这样宿主的任何重渲染(点击、移动视角、选中态变化等)都不会触碰已渲染的 DOM,图片不会重新加载。
function MarkdownPreview({ ctx }: CanvasNodeContentProps) {
    const [, force] = useState(0);
    const ref = useRef<HTMLDivElement>(null);
    const lastHtml = useRef<string | null>(null);

    // marked 未就绪时按需加载,加载完触发一次重渲染填充内容
    useEffect(() => {
        if (marked) return;
        let alive = true;
        loadMarked().then(() => alive && force((n) => n + 1));
        return () => {
            alive = false;
        };
    }, []);

    const source = (ctx.node.metadata?.content as string | undefined) || "";
    const html = renderMarkdown(source);

    useEffect(() => {
        const el = ref.current;
        if (!el || lastHtml.current === html) return; // 内容没变:不动 DOM,已加载的图片保持原样
        el.innerHTML = html;
        lastHtml.current = html;
    }, [html]);

    return <div ref={ref} className="cnv-md" data-canvas-no-zoom onWheel={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", color: ctx.theme.node.text }} />;
}

function MarkdownEditor({ ctx }: CanvasNodeContentProps) {
    const value = (ctx.node.metadata?.content as string | undefined) || "";
    return (
        <textarea
            autoFocus
            value={value}
            placeholder="# 输入 Markdown"
            onChange={(e) => ctx.updateMetadata({ content: e.target.value })}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            style={{ height: "100%", width: "100%", resize: "none", background: ctx.theme.node.fill, borderRadius: 16, boxSizing: "border-box", padding: 16, fontFamily: "monospace", fontSize: 14, outline: "none", border: "none", color: ctx.theme.node.text }}
        />
    );
}

function MarkdownContent({ ctx }: CanvasNodeContentProps) {
    return ctx.node.metadata?.editing ? <MarkdownEditor ctx={ctx} /> : <MarkdownPreview ctx={ctx} />;
}

export default definePlugin({
    id: "markdown",
    name: "Markdown 节点",
    version: "1.1.0",
    description: "在画布中编辑与渲染 Markdown",
    css,
    nodes: [
        {
            type: "markdown:doc",
            title: "Markdown",
            icon: "📝",
            description: "编辑与渲染 Markdown",
            defaultSize: { width: 360, height: 300 },
            defaultMetadata: { content: "" },
            minimapColor: "#6366f1",
            hidePanel: true, // 纯展示/编辑节点:不弹出下方生图面板
            // 宿主统一提供「交互 ⇄ 移动」开关;编辑态强制可交互并隐藏该开关
            interactionToggle: true,
            forceInteractive: (node) => Boolean(node.metadata?.editing),
            resource: (node) => ({ kind: "text", text: node.metadata?.content }),
            Content: MarkdownContent,
            // 仅保留「编辑/预览」开关(状态存 metadata.editing);交互/移动 由宿主自动注入
            toolbar: (ctx) => {
                const editing = Boolean(ctx.node.metadata?.editing);
                return [
                    {
                        id: "md-toggle-edit",
                        title: editing ? "预览渲染结果" : "编辑 Markdown 源码",
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
