# Change: 将爆款视频生成的分析与改编接入任务队列，并补齐历史输入源回填

## Why

当前爆款视频生成工具的第 1 步分析和第 2 步脚本改编都在组件内直接发起异步调用，不进入统一任务队列。
这导致用户无法在任务面板里追踪进度、失败后重试，也无法在页面切换或刷新后恢复这些长耗时任务。

同时，历史记录目前只保存 `sourceLabel`。YouTube 场景还能靠文本回填 URL，本地上传视频则只剩文件名，无法在重新分析时恢复原视频输入。

## What Changes

- 将爆款视频生成工具的“视频分析”接入统一任务队列
- 将爆款视频生成工具的“脚本改编”接入统一任务队列
- 为这两类任务补充结构化任务元数据，区分普通文本任务与视频分析器内部任务
- 为分析历史补充输入源持久化：
  - YouTube 记录真实 `youtubeUrl`
  - 本地上传记录缓存后的视频来源信息，支持后续恢复
- 用户从历史记录重新进入分析页时，自动回填 YouTube URL 或本地视频预览，并可直接重新提交
- 保持现有素材生成、首尾帧提取和记录存储结构可兼容迁移

## Impact

- Affected specs:
  - `video-analyzer`
- Affected code:
  - `packages/drawnix/src/components/video-analyzer/*`
  - `packages/drawnix/src/mcp/tools/video-analyze.ts`
  - `packages/drawnix/src/mcp/tools/text-generation.ts`
  - `packages/drawnix/src/services/task-queue-service.ts`
  - `packages/drawnix/src/types/shared/core.types.ts`
  - `packages/drawnix/src/utils/video-frame-cache.ts`
  - `packages/drawnix/src/services/unified-cache-service.ts`

## Scope

### Included In This Change

- 视频分析任务的入队、进度展示、结果回写
- 脚本改编任务的入队、进度展示、结果回写
- 历史记录对 YouTube URL 和本地视频来源的恢复
- 必要的数据结构迁移与兼容处理

### Not Included In This Change

- 通用任务队列 UI 的大规模改版
- 将爆款视频生成的“素材生成”页面改造成新的队列协议
- 云端上传原视频或服务端持久化视频源
- 跨设备同步本地上传视频源
