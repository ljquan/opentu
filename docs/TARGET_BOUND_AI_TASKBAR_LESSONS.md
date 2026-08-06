# AI 任务栏跟随图片目标经验

## 背景

图片生成完成后，AI 任务栏仍固定在画布底部。用户选中生成图片时，无法直接查看和修改原提示词，重新生成还可能插入一张新的孤立图片。

本功能支持任务栏跟随当前图片目标：选中图片后任务栏吸附到目标附近；生成图片恢复自身提示词，普通本地图片保持空提示词；提交修改后原位替换目标图片。

## 最终行为

### 1. 识别可绑定图片

画布仅选中一个图片元素时，系统依次读取图片元素、anchor 和历史图片任务中的提示词及绑定 ID。生成图片恢复自身上下文；普通上传图片也进入目标跟随，但 `/asset-library/...` 不回查历史生成任务，不继承其他图片的提示词、任务或 anchor。

### 2. 任务栏跟随目标

- 复用现有 AI 任务栏，不新增控制条。
- 优先显示在图片下方，空间不足时显示在上方。
- 左右位置限制在当前视口内。
- 画布缩放或平移后刷新吸附位置。
- 普通本地图片显示自身缩略图，提示词为空。
- 切换目标时清除上一目标的手动附件和知识库上下文。
- 目标 URL、prompt、taskId 或 anchorId 变化时，即使元素 ID 不变也刷新上下文。
- 目标缩略图通过公共图片组件读取局域网虚拟 URL；换源时旧 Blob 请求和重试定时器不能覆盖新图。
- 取消选择、多选或选择不支持的元素后回到底部。
- 移动端保持底部布局，避免遮挡画布。

### 3. 编辑提示词并原位替换

目标编辑提交时创建新的图片任务，不调用 `retryTask`。任务携带目标元素 ID、anchor ID、来源任务 ID 和原提示词。

成功后直接更新原图片元素的 URL 和生成元数据，保留元素 ID、位置、尺寸和层级。任务失败或目标在生成期间被删除时，不修改画布，也不新增孤立图片。

### 4. 批量图片独立替换

批量生成的每张图片使用独立 anchor 和批次槽位。编辑其中一张图片时，替换任务使用目标元素 ID 和明确的 anchor ID，只影响所选目标。

## 数据边界

- 图片元素：`generationPrompt`、`generationTaskId`、`generationAnchorId`
- anchor：`prompt`、`resultElementId`、`targetElementId`、`sourceTaskId`、`latestTaskId`
- 任务参数：`anchorId`、`replaceElementId`、`targetElementId`、`sourceTaskId`、`sourcePrompt`

绑定层只保存 URL、ID、prompt 和生成参数，不保存 base64、完整任务历史或大媒体内容。

## 关键实现

- `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - 识别目标、隔离目标上下文、恢复提示词、计算吸附位置并提交替换任务。
- `packages/drawnix/src/components/shared/SelectedContentPreview.tsx`
- `packages/drawnix/src/components/retry-image.tsx`
  - 显示当前目标缩略图，解析本地虚拟 URL，并隔离快速换源时的新旧异步结果。
- `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - 首次插入时写入绑定元数据，替换成功时原位更新目标。
- `packages/drawnix/src/components/ai-input-bar/workflow-converter.ts`
- `packages/drawnix/src/mcp/tools/image-generation.ts`
  - 将目标绑定字段放在任务顶层，避免进入 provider 参数。
- `packages/drawnix/src/utils/image-generation-anchor-lookup.ts`
- `packages/drawnix/src/utils/image-generation-anchor-task.ts`
  - 按明确 anchor 和替换目标隔离任务。

## 设计规则

1. 修改提示词属于新生成任务，不是原参数重试。
2. 替换只更新图片资源和生成元数据，不删除后重新插入元素。
3. 图片元素自身保存 prompt，使任务历史不可用时仍能编辑。
4. 只有结果成功且目标存在时才更新图片。
5. 批量图片按目标元素和 anchor 槽位独立处理。
6. 切换图片时不能保留上一目标的提示词、附件或知识库上下文；普通本地图没有生成元数据时保持空提示词。
7. 白板数据保存稳定 URL，临时 `blob:` 只用于渲染；旧 Blob 结果不能覆盖当前目标。

## 关联 QA

- [2026-07-15-AI 任务栏跟随目标测试](../qa/2026-07-15-AI任务栏跟随目标测试/2026-07-15-AI任务栏跟随目标测试.md)

## 一句话结论

选中任意图片时，AI 任务栏显示当前目标；生成图片恢复自身提示词，普通本地图不继承旧上下文，再次生成后只原位替换当前图片。
