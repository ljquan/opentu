# Change: 跨媒体目标提示词复用

## Why

当前 AI 任务栏只有在选中图片目标时，才会把生成提示词显示为可复用的虚化建议。视频、音频和文本生成结果即使保留了原提示词，也无法在目标旁快速复用，交互不一致。

## What Changes

- 将目标提示词虚化建议扩展到 AI 生成的图片、视频、音频和文本元素
- 单选支持的生成元素时，任务栏切换到对应生成类型并跟随目标
- 保持空格或回车采纳、直接输入或操作其他控件取消的既有交互
- 为 AI 生成视频和文本复用图片目标已有的任务栏跟随开关、临时关闭和永久关闭控件
- 视频和文本目标关闭跟随后分别保留参考视频或正文上下文，但不再原位替换该目标
- 非图片目标仅从轻量生成元数据或明确任务 ID 恢复提示词，不扫描历史正文或媒体 URL
- 普通手写文本、手动导入视频和音频没有生成提示词时，继续使用普通选区行为
- 生成结果插入画布时统一保留 prompt 和 task ID，不保存媒体二进制或完整任务历史

## Impact

- Affected specs:
  - `ai-input-generation`
- Affected code:
  - `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - `packages/drawnix/src/services/canvas-operations/canvas-insertion.ts`
  - `packages/drawnix/src/mcp/tools/canvas-insertion.ts`
