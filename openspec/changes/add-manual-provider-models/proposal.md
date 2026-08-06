# Change: 添加供应商自定义接口模型

## Why

当前设置页只能通过供应商的 `/models` 接口获取模型列表，再由内置推断决定调用协议。部分兼容供应商不提供模型列表或返回不完整，用户无法把自定义模型加入网页原有调用流程。

## What Changes

- 在供应商详情的“模型”区域增加“添加自定义模型”入口
- 用户可选择网页已有调用方式，也可为当前模型独立配置自定义 HTTP 请求地址、方法、请求体模板、响应字段和轮询方式
- 自定义模型写入当前供应商的运行时模型目录，并同步保存一条 `manualBindings` 调用配置
- 默认提供文本对话/多模态文本、图片生成/编辑、异步图片任务、视频任务、Suno 音频任务等网页已有调用方式
- 提示词、参考图、尺寸和时长仍由原生成面板提供；自定义 HTTP 模式通过模板变量注入这些运行时参数
- 默认模型预设和文本、图片、视频、音频生成入口继续通过现有 `ModelRef -> ProviderProfile -> ProviderModelBinding` 路由调用该模型
- 不引入脚本执行器；自定义模型复用当前供应商的 Base URL、API Key、鉴权和 transport，并通过受控模板执行自定义 HTTP 请求

## Impact

- Affected specs:
  - `runtime-model-discovery`
  - `provider-profiles`
- Affected code:
  - `packages/drawnix/src/utils/runtime-model-discovery.ts`
  - `packages/drawnix/src/utils/settings-types.ts`
  - `packages/drawnix/src/utils/settings-manager.ts`
  - `packages/drawnix/src/services/provider-routing/settings-repository.ts`
  - `packages/drawnix/src/services/provider-routing/manual-http-template.ts`
  - `packages/drawnix/src/services/model-adapters/custom-http-adapter.ts`
  - `packages/drawnix/src/components/settings-dialog/settings-dialog.tsx`
  - `packages/drawnix/src/components/settings-dialog/settings-dialog.scss`
  - `packages/drawnix/src/services/media-api/video-api.ts`
  - `packages/drawnix/src/services/media-executor/fallback-executor.ts`
  - `packages/drawnix/src/services/video-api-service.ts`
  - `packages/drawnix/src/utils/__tests__/runtime-model-discovery.test.ts`
  - `packages/drawnix/src/services/__tests__/media-api-routing.test.ts`
  - `packages/drawnix/src/services/__tests__/custom-http-adapter.test.ts`
  - `packages/drawnix/src/services/__tests__/media-executor.test.ts`
  - `packages/drawnix/src/services/__tests__/settings-repository.test.ts`
  - `packages/drawnix/src/utils/__tests__/settings-manager.test.ts`

## Relationship To Existing Work

- 建立在当前 `ProviderProfile`、`ProviderCatalog`、`ModelRef`、`ProviderModelBinding` 和运行时模型发现链路之上
- 是 `add-runtime-model-discovery` / `add-multi-provider-profiles` 的小扩展：当自动发现不可用或协议推断不准确时，允许用户手动把模型和接口绑定加入同一个目录
- 比“脚本式调用接口”更推荐：能满足自定义接口调用，同时避免脚本执行、密钥泄露和任意响应解析带来的安全与维护成本
