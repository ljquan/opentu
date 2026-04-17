# Change: 对齐爆款视频与爆款 MV 的创作流程

## Why
爆款 MV 已经沉淀出一组更完整的创作交互，但爆款视频仍缺少角色编辑、生成重置和统一导出，导致两条流程体验分叉、优秀实践无法复用。

## What Changes
- 为爆款视频脚本页补充角色描述编辑
- 为爆款视频生成页补充重置生成与素材 ZIP 下载
- 抽取爆款视频与爆款 MV 共用的生成结果重置与 ZIP 导出能力
- 统一两边生成页底部操作区文案与布局，保留各自领域特有批量生成能力

## Impact
- Affected specs: video-mv-workflow-parity
- Affected code: `packages/drawnix/src/components/video-analyzer/`, `packages/drawnix/src/components/mv-creator/`, `packages/drawnix/src/components/shared/`
