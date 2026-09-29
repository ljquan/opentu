// 插件模板:复制本目录 → 改 id/name/type → 写你的节点。
// 这是一个演示节点:编辑文本、跟随主题、读取上游节点、用画布指令衍生新节点。
import { definePlugin, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

function TemplateContent({ ctx }: CanvasNodeContentProps) {
    const [editing, setEditing] = useState(false);
    const content = ctx.node.metadata?.content || "";

    // 读取上游相连节点的文本内容(演示 ctx.getUpstream)
    const upstreamText = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .filter(Boolean)
        .join("\n");

    // 用画布指令集衍生一个文本节点并连线(演示 ctx.applyOps)
    const spawnBelow = () => {
        const id = `template-${ctx.node.id}-${ctx.getNodes().length}`;
        ctx.applyOps([
            { type: "add_node", id, nodeType: "text", title: "衍生节点", x: ctx.node.position.x, y: ctx.node.position.y + ctx.node.height + 40, metadata: { content, status: "success" } },
            { type: "connect_nodes", fromNodeId: ctx.node.id, toNodeId: id },
        ]);
    };

    const btn = { padding: "4px 10px", borderRadius: 8, border: `1px solid ${ctx.theme.node.stroke}`, background: ctx.theme.toolbar.panel, color: ctx.theme.node.text, cursor: "pointer", fontSize: 12 } as const;

    return (
        // data-canvas-no-zoom + stopPropagation:交互控件避免触发画布拖拽/缩放
        <div data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, boxSizing: "border-box", color: ctx.theme.node.text }}>
            <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={btn} onClick={() => setEditing((v) => !v)}>
                    {editing ? "完成" : "编辑"}
                </button>
                <button type="button" style={btn} onClick={spawnBelow}>
                    衍生文本
                </button>
            </div>
            {editing ? (
                <textarea autoFocus value={content} placeholder="输入内容…" onChange={(e) => ctx.updateMetadata({ content: e.target.value })} onWheel={(e) => e.stopPropagation()} style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: ctx.theme.node.text, fontSize: 14, lineHeight: 1.5 }} />
            ) : (
                <div onWheel={(e) => e.stopPropagation()} style={{ flex: 1, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>
                    {content || upstreamText || <span style={{ color: ctx.theme.node.placeholder }}>点“编辑”写点什么,或连一个上游文本节点</span>}
                </div>
            )}
        </div>
    );
}

export default definePlugin({
    id: "template", // ← 改成你的唯一 id(kebab-case)
    name: "模板节点",
    version: "1.0.0",
    description: "插件起步模板:改我。",
    nodes: [
        {
            type: "template:node", // ← 建议 "<id>:<name>",全局唯一
            title: "模板",
            icon: "✨",
            description: "起步示例节点",
            defaultSize: { width: 280, height: 200 },
            defaultMetadata: { content: "" },
            minimapColor: "#8b5cf6",
            // 作为上游输入被消费时输出文本(可连给生成/其它节点);不需要可删
            resource: (node) => ({ kind: "text", text: node.metadata?.content }),
            Content: TemplateContent,
        },
    ],
});
