# Change: 更新默认模型目录与 Seedance 2.0 调用

## Why

当前默认模型入口仍展示 GPT-5.4 及以下旧模型，且缺少模型广场已上线的 GPT-5.6、DeepSeek V4 与 Seedance 2.0 系列。Seedance 2.0 使用统一 `/v1/videos` 异步任务接口，现有 Seedance 1.x 专用模型名转换不能直接复用。

## What Changes

- 将模型广场确认的 GPT-5.6、DeepSeek V4 与 Seedance 2.0 系列加入默认可选模型
- 将 GPT-5.4 及以下旧入口从默认可选列表隐藏，但保留模型配置解析和历史选择兼容
- 沿用统一模型展示排序，让新增且版本更高的模型优先展示
- 让 Seedance 2.0 系列按模型广场声明的 `/v1/videos` 异步接口提交、轮询并读取结果
- 按官方 JSON 契约为 Seedance 2.0 全系列开放独立的 480p/720p/1080p 分辨率、7 种宽高比、4-12 秒时长及可选控制字段

## Impact

- Affected specs:
  - `runtime-model-discovery`
  - `provider-protocol-routing`
- Affected code:
  - `packages/drawnix/src/constants/model-config.ts`
  - `packages/drawnix/src/constants/video-model-config.ts`
  - `packages/drawnix/src/utils/runtime-model-discovery.ts`
  - `packages/drawnix/src/services/provider-routing/binding-inference.ts`
  - `packages/drawnix/src/services/model-adapters/seedance2-adapter.ts`
  - related focused tests
