# Change: update chat drawer unified ai composer

## Why

当前分支已经把 `ChatDrawer` 底部收窄成简洁输入框，但仍残留两类偏差：

- 抽屉和外部 `AIInputBar` 仍共享未发送附件草稿，导致两个入口互相污染
- 外部手动生成同步进抽屉时会抢占当前会话，不符合“抽屉持续对话、手动生成单独开新会话”的目标

这让抽屉不像源仓库里的 agent / copilot 面板，而更像第二个手动生成器。

## What Changes

- 将 `ChatDrawer` 底部输入区固定为 agent-only 简洁对话框，只保留输入与发送
- 抽屉发送不再根据外部 `generationType` 直接提交图片/视频/音频工作流，而是统一走对话 / agent 链路
- 共享 AI composer 状态只保留生成配置；抽屉与外部 `AIInputBar` 的上传/素材库草稿完全独立
- 恢复抽屉顶部的文本模型选择器，仅用于对话 / Agent 文本链路
- 外部 `AIInputBar` 继续作为唯一的手动生成入口；它发起的工作流结果继续同步进入抽屉存储，但每次手动生成新建 `direct_generation` 会话且不自动切走当前 agent 会话
- 保留抽屉现有顶部骨架与会话列表结构，不拆双栏、不拆标签页
- 保留现有会话续接、顶部文本模型持久化、工作流状态同步、自动插画布修复

## Impact

- Affected code:
  - `packages/drawnix/src/components/chat-drawer/*`
  - `packages/drawnix/src/contexts/AIComposerContext.tsx`
