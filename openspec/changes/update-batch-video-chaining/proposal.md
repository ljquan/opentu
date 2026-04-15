# Change: 串行化爆款 MV / 爆款视频的批量视频生成

## Why

当前“全部→生成视频”会把所有镜头一次性并发丢进任务队列，缺少片段之间的前后依赖。
这使得已生成片段的尾帧无法自动驱动下一段首帧，失败后也只能人工逐段重试，批量生成既不连贯也不自动。

同时，生成页没有统一的视频尺寸配置，单镜头生成与批量生成对尺寸的处理不一致，用户很难稳定控制整组视频的输出规格。

## What Changes

- 将爆款 MV 与爆款视频生成工具的“全部→生成视频”改为串行编排
- 第 1 段优先使用参考图作为首帧；没有参考图时不传首帧
- 后续段自动使用上一段视频尾帧作为当前段首帧
- 已有成片的段落直接跳过，并提取该视频尾帧驱动下一段
- 批量生成失败后立即自动重试，直到成功或用户手动停止
- 在生成页视频模型下方增加通用尺寸选择，并统一作用于单镜头生成与全部生成
- 为记录补充视频尺寸持久化，并兼容旧历史记录

## Impact

- Affected specs:
  - `video-batch-generation`
- Affected code:
  - `packages/drawnix/src/components/mv-creator/pages/GeneratePage.tsx`
  - `packages/drawnix/src/components/video-analyzer/pages/GeneratePage.tsx`
  - `packages/drawnix/src/components/mv-creator/types.ts`
  - `packages/drawnix/src/components/video-analyzer/types.ts`
  - `packages/drawnix/src/constants/video-model-config.ts`
