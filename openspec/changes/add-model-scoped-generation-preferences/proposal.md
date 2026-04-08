# Change: 按模型记忆生成参数偏好

## Why

当前 AI 输入栏、图片生成弹窗、视频生成弹窗虽然已经支持一定程度的状态持久化，但参数仍主要以“当前工具最近一次状态”为中心保存。
用户切换到另一个模型后，系统通常回退为模型默认参数，无法记住“这个模型我习惯用什么参数”，在图片、视频、音频场景下都会造成重复配置。

更重要的是，运行时模型发现已经引入了同模型来自不同供应商来源的情况。如果继续只按 `modelId` 保存参数，会出现不同供应商间参数串用的问题。

## What Changes

- 为图片、视频、音频生成能力增加“按模型作用域”的参数偏好记忆
- 偏好键优先使用 `selectionKey`，缺失时回退到 `modelId`
- 用户切换模型时，优先回填该模型的上次偏好；无偏好时再回退到模型默认参数
- 回填时仅保留当前模型兼容的参数，并继续应用已有的强制参数规则
- 保持编辑历史任务、初始化外部传参、任务复现等链路优先级高于本地模型偏好

## Impact

- Affected specs:
  - `generation-preferences`
- Affected code:
  - `packages/drawnix/src/services/ai-generation-preferences-service.ts`
  - `packages/drawnix/src/components/ttd-dialog/ai-image-generation.tsx`
  - `packages/drawnix/src/components/ttd-dialog/ai-video-generation.tsx`
  - `packages/drawnix/src/components/ai-input-bar/AIInputBar.tsx`
  - `packages/drawnix/src/constants/storage-keys.ts`
