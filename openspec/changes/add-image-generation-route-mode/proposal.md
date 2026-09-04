# Change: Add image generation site mode selector

## Why

AI 图片生成页目前只暴露模型选择，用户不容易理解同一个模型会走哪个供应商站点。首页已有“自动选择最优站点 + 手动切换站点”的心智，图片生成页也需要用同一心智降低失败率和配置成本。

## What Changes

- 在 AI 图片生成页模型选择区域增加站点模式：
  - `自动最优站点`：默认模式，使用当前启用方案里的图片站点路由。
  - `手动站点`：允许用户手动指定供应商站点来源与模型，作为本次生成的临时覆盖。
- 自动最优站点模式下，模型展示与任务提交必须优先使用当前图片路由解析结果。
- 手动选择模式下，用户可继续使用现有模型下拉选择供应商/模型，但不强制改写全局默认路由。
- 任务创建时保存实际使用的 `modelRef`，确保异步执行、重试和历史编辑仍走同一路径。

## Non-Goals

- 不新增独立的站点健康探测系统。
- 不改变供应商配置页的默认方案管理能力。
- 不改变模型执行适配器或图片 API wire contract。
- 不在 AI 图片页复制首页完整站点面板。

## Impact

- Affected specs:
  - `image-generation`
  - `provider-routing`
- Affected code:
  - `packages/drawnix/src/components/ttd-dialog/ai-image-generation.tsx`
  - `packages/drawnix/src/components/ttd-dialog/ai-image-generation.scss`
  - `packages/drawnix/src/utils/settings-manager.ts`
  - `packages/drawnix/src/utils/model-selection.ts`
