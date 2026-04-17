# Change: 优化视频展示为海报优先并保留可播放降级

## Why
当前项目中多个视频列表/卡片场景直接渲染 `<video preload="metadata">`，导致素材库等页面首次展示慢。项目内已经存在视频首帧缩略图与 Cache Storage 基础能力，但接入不统一，且跨域失败时容易退化为“无预览”。

## What Changes
- 统一视频缩略场景的展示策略为“海报图优先，失败再降级到 video”
- 优先复用已有 `thumbnail`、`previewImageUrl` 与 `?thumbnail=` Service Worker 缓存能力
- 在需要直接点击播放的场景支持“先海报、后切换 video 播放”
- 对必须保留原生 `video` 的场景维持现状，避免交互回退

## Impact
- Affected specs: `media-preview`
- Affected code:
  - `packages/drawnix/src/components/media-library/*`
  - `packages/drawnix/src/components/shared/media-preview/*`
  - `packages/drawnix/src/components/task-queue/*`
  - `packages/drawnix/src/components/MarkdownEditor/asset-embed-plugin/*`
  - `packages/drawnix/src/components/shared/SelectedContentPreview.tsx`
