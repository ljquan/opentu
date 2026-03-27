# Change: 持久化 AI 参数状态

## Why

当前底部 `AIInputBar` 以及 AI 图片/视频生成工具中的关键参数大多停留在组件内 `useState`。
用户关闭页面或重新进入项目后，这些上次使用的参数会回到默认值，导致重复配置成本高，也和现有已持久化的自动插入、面板宽度等体验不一致。

## What Changes

- 持久化底部 `AIInputBar` 的 `generationType`、`selectedModel`、`selectedParams`、`selectedCount`
- 持久化 AI 图片工具的当前模型相关参数和尺寸偏好
- 持久化 AI 视频工具的当前模型相关参数、`duration`、`size`
- 保持现有任务历史、prompt history 逻辑不变，不额外修改其恢复链路

## Impact

- Affected specs:
  - 无
- Affected code:
  - `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - `packages/drawnix/src/components/ttd-dialog/ai-image-generation.tsx`
  - `packages/drawnix/src/components/ttd-dialog/ai-video-generation.tsx`
  - `packages/drawnix/src/constants/storage-keys.ts`
  - `packages/drawnix/src/services/`
