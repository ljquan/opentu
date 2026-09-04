# Change: 跨媒体目标绑定生成控制

## Why

当前图片目标已具备任务栏跟随和提示词虚化建议，但视频、音频和文本生成结果即使保留了生成提示词，也无法复用同一交互。跨媒体目标的提示词恢复、原位替换和“只作参考/上下文”边界需要统一，且不能把普通文本正文或导入媒体误判为 AI 生成内容。

## What Changes

- 为图片、视频、音频和文本生成建立轻量目标绑定，统一记录提示词、任务与最终画布元素之间的关系
- 复用现有 AI 任务栏，单选带生成元数据的目标时切换到对应生成类型并恢复目标状态
- 任务栏进入目标编辑状态时，将原提示词作为一次性虚化建议展示，并提示可用空格或回车复用
- 用户直接输入或操作任务栏其他按钮时，立即丢弃该建议，不自动写入真实输入值
- follow 模式提交后创建同类型生成任务，并在完成后原位替换绑定目标，保持原位置、尺寸和画布上下文
- 图片、视频和文本目标支持关闭任务栏跟随，并分别保留为参考图、参考视频或文本上下文；参考/上下文模式不再替换原目标
- 音频目标支持提示词恢复与同类型原位替换，但不新增“只作参考”输入能力或关闭方式菜单
- 非图片目标仅从元素生成元数据或明确任务 ID 恢复提示词，不扫描正文或媒体 URL 猜测来源
- 将左侧 AI 图片入口和底部 AI 输入栏的图片生成结果接入同一套目标绑定链路
- 生成结果仅保留 prompt、task ID 等轻量元数据，不保存媒体二进制或完整任务历史

## Impact

- Affected specs:
  - `image-generation-feedback`
  - `ai-input-generation`
  - `image-generation`
- Affected code:
  - `packages/drawnix/src/types/image-generation-anchor.types.ts`
  - `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - `packages/drawnix/src/components/ai-input-bar/target-bound-taskbar-state.ts`
  - `packages/drawnix/src/plugins/components/image.tsx`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - `packages/drawnix/src/services/canvas-operations/canvas-insertion.ts`
  - `packages/drawnix/src/mcp/tools/image-generation.ts`
  - `packages/drawnix/src/mcp/tools/canvas-insertion.ts`
  - `packages/drawnix/src/utils/image-task-prefill.ts`
