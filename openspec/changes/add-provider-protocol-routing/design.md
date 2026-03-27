## Context

当前代码已经具备以下基础能力：

- `settings-manager` 可以管理 `ProviderProfile / ProviderCatalog / ModelRef / InvocationPreset`
- `runtime-model-discovery` 可以按 `profileId` 隔离发现和选择模型
- 图片和视频侧已经存在若干专用 adapter，分别处理 Flux、MJ、Kling、Seedance 等协议变体

但当前结构仍存在三个核心缺口：

1. `resolveInvocationRoute` 只解析凭证和模型，不解析协议与请求体策略
2. `runtime-model-discovery` 仍以统一 `/models + Bearer` 的假设执行发现
3. `model-adapters` 仍然按模型 / 厂商 / 标签进行猜测式匹配，无法表达“同名模型在不同 profile 下走不同协议”的事实

这会导致下列问题：

- 同名模型在不同上游中发生协议冲突
- 同协议不同请求体的差异只能堆在 adapter 内的条件分支中，难以扩展
- 文本链路继续绕过统一路由层，无法和图片 / 视频共享同一套供应商协议规划

## Goals / Non-Goals

- Goals:
  - 让运行时调用基于 `profileId + modelId + operation` 选择协议绑定
  - 支持同一模型 ID 在不同供应商下走不同协议
  - 支持同一协议下的不同请求体 schema
  - 统一文本、图片、视频三类调用的运行时规划流程
  - 尽量降低用户配置成本，优先自动推断协议绑定，仅在歧义时暴露高级覆盖项
- Non-Goals:
  - 本次不实现跨供应商自动故障切换
  - 本次不实现按价格 / 延迟 / 健康度自动择优调度
  - 本次不为所有第三方平台实现完全自动化、零误差的协议识别

## Decisions

- Decision: 区分“模型标识”和“可执行绑定”
  - `modelId` 表示用户看到的模型
  - `ProviderModelBinding` 表示该模型在特定供应商下针对特定操作的调用方式
  - 绑定的主键必须至少包含 `profileId + modelId + operation`

- Decision: 引入 `InvocationPlanner`
  - 输入：`routeType + ModelRef + optional override`
  - 输出：`InvocationPlan`
  - Planner 负责在多个绑定中选择当前最合适的协议，而不是让 UI 或 service 直接拼 URL

- Decision: 将适配器从“按模型注册”迁移为“按协议注册”
  - 现有 Flux / MJ / Kling / Seedance 等实现可以保留，但角色改为 `ProtocolAdapter`
  - `ProtocolAdapter` 负责请求体构建、响应解析、可选轮询策略

- Decision: 将鉴权和基础 URL 处理下沉到 `ProviderTransport`
  - 统一处理 `bearer / header / query / custom` 等认证方式
  - 统一处理额外 Header、查询参数和供应商级发现接口
  - 避免每个 adapter 再重复拼装认证信息

- Decision: discovery 必须保留原始元数据和绑定推断结果
  - 不能只把远端模型压成扁平 `ModelConfig`
  - 必须保留 `raw`、`capabilityHints`、`bindingCandidates`
  - 否则后续运行时无法稳定判断同名模型的协议归属

- Decision: 同名模型不得按裸 `modelId` 全局去重
  - 选择器和运行时缓存应使用 `selectionKey = profileId::modelId`
  - 运行时绑定必须保留 `profileId`

## Proposed Data Model

```ts
interface ResolvedProviderContext {
  profileId: string;
  profileName: string;
  providerType: string;
  baseUrl: string;
  apiKey: string;
  authType: 'bearer' | 'header' | 'query' | 'custom';
  extraHeaders?: Record<string, string>;
}

interface ProviderModelBinding {
  id: string;
  profileId: string;
  modelId: string;
  operation: 'text' | 'image' | 'video';
  protocol:
    | 'openai.chat.completions'
    | 'openai.images.generations'
    | 'openai.async.video'
    | 'google.generateContent'
    | 'mj.imagine'
    | 'flux.task'
    | 'kling.video'
    | 'seedance.task';
  requestSchema: string;
  responseSchema: string;
  submitPath: string;
  pollPathTemplate?: string;
  priority: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'discovered' | 'template' | 'manual';
}

interface DiscoveredProviderModel {
  profileId: string;
  modelId: string;
  selectionKey: string;
  raw: unknown;
  capabilityHints: {
    supportsText: boolean;
    supportsImage: boolean;
    supportsVideo: boolean;
  };
  bindings: ProviderModelBinding[];
}

interface InvocationPlan {
  provider: ResolvedProviderContext;
  modelRef: { profileId: string; modelId: string };
  binding: ProviderModelBinding;
}
```

## Execution Flow

1. 用户在设置中保存 `ProviderProfile`
2. `ProviderTransport` 根据 `providerType/baseUrl` 选择供应商模板或探测策略
3. discovery 同步远端模型，并推断出每个模型的 `bindings[]`
4. 用户在运行时选择 `ModelRef(profileId + modelId)`
5. `InvocationPlanner` 根据 `operation` 找到最高优先级的可执行 binding
6. `ProtocolAdapterRegistry` 按 `binding.protocol` 取得协议适配器
7. 适配器根据 `requestSchema` 构建请求，并通过 `ProviderTransport` 发送
8. 如为异步任务，则由对应 `PollingStrategy` 轮询并标准化结果

## Binding Inference Strategy

- OpenAI 兼容供应商：
  - 优先使用 `/v1/models` 返回的字段、模型 ID 和供应商模板推断绑定
  - 默认优先生成 `openai.chat.completions / openai.images.generations / openai.async.video`
- Gemini 官方供应商：
  - 不再强依赖 `/models`
  - 允许由 provider template 直接提供 `google.generateContent` 绑定
- 自定义供应商：
  - 若 discovery 无法高置信度推断协议，则保留低置信度绑定
  - 仅在需要时暴露高级覆盖入口

## Request Schema Strategy

同一协议下的请求体差异不再通过大量 `if modelId.includes(...)` 解决，而是显式建模：

- `openai.image.basic-json`
- `openai.video.form.input-reference`
- `google.gemini.generate-content.image`
- `kling.video.text2video`
- `kling.video.image2video`
- `seedance.video.first-last-frame`

这样新增模型时，优先复用已有协议，仅为其指派合适的 `requestSchema`。

## Migration Plan

1. 新增 provider protocol routing 类型与 planner，不改 UI
2. 将现有图片 / 视频 adapter 包装为 `ProtocolAdapter`
3. 将文本链路迁移到同一 planner 和 protocol registry
4. 扩展 discovery 存储，保留 `bindings[]`
5. 最后再清理旧的“按模型猜 adapter”逻辑

## Risks / Trade-offs

- 风险: 架构抽象增加初始复杂度
  - Mitigation: 分阶段迁移，先保留现有 adapter 实现，只调整其注册方式

- 风险: 自动推断协议可能存在误判
  - Mitigation: 为 binding 引入 `confidence` 与 `source`，仅在低置信度场景允许高级覆盖

- 风险: 文本 / 图片 / 视频同时迁移会影响面较大
  - Mitigation: 先完成 planner 和 image/video 迁移，再迁移 text

## Open Questions

- 是否需要将用户手动覆盖的 binding 保存在 `ProviderCatalog`，还是单独存为 `ProviderBindingOverrides`
- `authType` 是否需要从当前的 `bearer/header` 扩展为更通用的 `query/custom`
- 官方 Gemini 等不提供 OpenAI 风格 `/models` 时，设置页是否需要显式展示“供应商模板已接管模型能力”
