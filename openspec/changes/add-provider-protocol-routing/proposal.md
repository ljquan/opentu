# Change: 增加供应商协议路由与请求体适配架构

## Why

当前多供应商架构已经能够保存多个 `baseUrl + apiKey`，并通过 `ModelRef(profileId + modelId)` 将模型归属到特定供应商。
但运行时请求仍然主要依赖“模型 ID / 厂商标签 -> adapter”的方式来决定执行链路，这在以下场景下会失效：

- 同一个模型 ID 在不同上游中需要走不同协议，例如：
  - 上游 A 将 `gemini-3-pro-image-preview` 暴露为 `/v1/images/generations`
  - 上游 B 将同名模型暴露为 Google 官方 `:generateContent`
- 同一个上游中的同一个模型可能支持多个调用协议，需要为不同操作或高级模式选择不同入口
- 即使协议相同，不同模型之间也可能要求不同的请求体字段、序列化格式、轮询方式和结果提取规则
- 文本链路目前仍然绕过现有图片/视频适配层，无法与多供应商路由形成统一模型

这意味着当前系统已经具备“凭证路由”，但还不具备“协议路由”和“请求体路由”。

## What Changes

- 引入 `ProviderModelBinding`，将“模型如何被调用”从 `modelId` 中解耦出来
- 引入 `InvocationPlanner`，统一根据 `profileId + modelId + operation` 选择协议绑定
- 引入 `ProviderTransport`，统一处理鉴权、基础 URL 归一化、额外 Header、查询参数和供应商级发现入口
- 将现有 `model-adapters` 重构为按 `protocol` 注册的协议适配器，而不是按模型猜测执行器
- 为协议适配器引入 `requestSchema / responseSchema / pollingStrategy` 概念，覆盖同协议不同请求体格式的场景
- 将文本、图片、视频三类调用统一接入同一套规划器与协议注册器
- 扩展运行时模型发现存储，保留每个供应商下模型的原始元数据、推断出的能力和绑定信息，避免仅依赖扁平化 `ModelConfig`

## Impact

- Affected specs:
  - `provider-protocol-routing`
- Affected code:
  - `packages/drawnix/src/utils/settings-manager.ts`
  - `packages/drawnix/src/utils/runtime-model-discovery.ts`
  - `packages/drawnix/src/services/model-adapters/*`
  - `packages/drawnix/src/services/generation-api-service.ts`
  - `packages/drawnix/src/utils/gemini-api/*`
  - `packages/drawnix/src/services/video-api-service.ts`
  - `packages/drawnix/src/services/async-image-api-service.ts`
  - `packages/drawnix/src/services/media-executor/*`

## Relationship To Existing Changes

- 本变更建立在 `add-multi-provider-profiles` 的 `profiles + catalogs + presets` 结构之上
- 本变更进一步落实 `add-multi-provider-profiles/design.md` 中“将 `ProviderType/AuthType/capabilities` 下沉到适配层”的决策
- 本变更会扩展 `add-runtime-model-discovery` 的职责，使其不只负责模型列表同步，还要为运行时路由保留协议与绑定信息
