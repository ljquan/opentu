# Change: AI 任务栏跟随图片目标

## Why

图片插入画布后，现有 AI 任务栏仍固定在底部。生成图片无法在目标旁恢复原提示词，普通本地图还可能显示上一目标的提示词或错误缩略图；重新生成也不能稳定替换当前图片目标。

## What Changes

- 生成图片元素保留 prompt、任务 ID 和 anchor ID 等轻量绑定元数据
- 单选生成图片或普通本地图时，复用现有 AI 任务栏并吸附到图片附近
- 生成图片恢复自身提示词；普通本地图提示词为空，不继承上一目标上下文
- 任务栏缩略图始终显示当前目标，同一元素换源后也立即刷新
- 修改提示词后创建新的图片生成任务，并原位替换目标图片
- 图片绑定状态提供关闭按钮；关闭后保留当前输入配置并改为生成新图片，不再覆盖原目标
- 关闭提示累计触发 5 次后按浏览器永久隐藏，关闭按钮继续保留
- 替换成功时保留元素 ID、位置和尺寸；失败或目标丢失时不新增图片
- 批量生成图片按独立 anchor 和目标元素分别绑定
- 局域网 HTTP 环境无 Service Worker 或 Cache Storage 时，稳定图片 URL 通过 IndexedDB Blob 降级恢复

## Impact

- Affected specs:
  - `ai-input-generation`
  - `image-generation`
  - `image-generation-feedback`
- Affected code:
  - `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - `packages/drawnix/src/components/retry-image.tsx`
  - `packages/drawnix/src/services/unified-cache-service.ts`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - `packages/drawnix/src/mcp/tools/image-generation.ts`
  - `packages/drawnix/src/types/image-generation-anchor.types.ts`
  - `packages/drawnix/src/utils/image-generation-anchor-*`
