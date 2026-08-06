## Context

现有设置系统已经具备：

- `ProviderProfile`：保存供应商名称、Base URL、API Key、鉴权类型、能力开关
- `ProviderCatalog`：按供应商保存 `discoveredModels` 与 `selectedModelIds`
- `RuntimeModelDiscoveryStore`：把目录里的模型转换成运行时可选模型
- `ModelRef`：用 `profileId + modelId` 保留模型来源并路由调用

因此自定义模型不需要新增“脚本调用接口”。把用户输入的模型 ID 写入当前供应商 catalog，同时保存一条指向网页既有协议的 `manualBindings` 绑定，就能被现有选择器、默认预设、transport 和 adapter 路由消费。

## Goals / Non-Goals

- Goals:
  - 允许用户在当前供应商下手动添加未被 `/models` 返回的模型
  - 手动模型可选择模型类型和网页已有调用方式，由系统自动带入协议、提交路径、请求体和轮询方式
  - 手动模型和接口绑定刷新后仍保留，并可从已添加模型中移除
  - 复用现有 provider transport、adapter、鉴权、Service Worker 配置同步
- Non-Goals:
  - 不支持在设置页编写或执行任意 JavaScript 脚本
  - 不支持无边界表达式执行；请求体仅允许固定模板变量，响应仅允许有限字段路径
  - 不承诺手动模型一定被供应商支持；调用失败按现有错误链路展示

## Decisions

- Decision: 手动模型落在 `ProviderCatalog.discoveredModels`

  - 手动模型与自动发现模型使用同一份 `ModelConfig` 结构
  - `selectedModelIds` 同步加入该模型 ID，使其立即出现在“已添加模型”和选择器中
  - 理由：最小改动即可复用当前设置、选择器和路由链路

- Decision: 自定义模型调用方式落在 `ProviderCatalog.manualBindings`

  - 手动 binding 保存 protocol、request schema、response schema、submit path 和可选 poll path
  - `listSettingsModelBindings` 合并 catalog 推断绑定与 manual binding
  - manual binding 使用较高优先级，确保用户显式配置的接口优先于自动推断

- Decision: UI 在供应商“模型”区域提供入口

  - 表单字段：模型 ID、模型类型、调用方式、显示名、描述
  - 当前默认覆盖文本对话/多模态文本、Tuzi/OpenAI 图片接口、异步图片任务、OpenAI/Kling/Seedance/HappyHorse 视频任务、Suno 音频任务
  - 理由：手动模型属于当前供应商目录，不应成为全局模型常量

- Decision: 复用网页固定模型调用

  - 用户选择文本、图片、视频或音频的站内调用方式
  - 系统自动写入对应 protocol、request schema、submit path 和 poll path
  - 理由：与固定模型行为一致，用户无需理解请求体或响应字段，也不会因手动映射导致调用断链

- Decision: 提供受控的自定义 HTTP 调用方式

  - 用户可配置请求地址、Method、JSON/FormData/Raw 请求体、额外 Headers、返回字段路径和可选轮询
  - 模板只支持 `model`、`prompt`、`messages`、`image(s)`、`size`、`duration` 和 `params` 等运行时变量
  - 自定义绑定固定保存为 `protocol/requestSchema = custom-http`，并优先于同模型的自动推断绑定
  - 理由：满足任意兼容接口调用，同时避免脚本执行和不受控响应解析

- Decision: 手动模型覆盖同供应商同 ID 同类型条目
  - 如果用户再次添加同 ID 同类型模型，更新显示名/描述
  - 如果同 ID 不同类型，V1 提示用户换 ID 或先移除原模型，避免当前 `selectedModelIds` 只按 ID 存储导致静默错路由

## Risks / Trade-offs

- 风险：用户把模型类型或接口预设选错

  - Mitigation: UI 先按模型类型过滤调用方式，并说明会复用的站内调用；调用失败沿用现有 provider error

- 风险：不同供应商对同一模型 ID 支持的协议不同

  - Mitigation: 手动模型不绕过 `ProviderProfile` 的鉴权、能力开关、transport 和 adapter 注册

- 风险：自动重新获取模型后覆盖手动模型
  - Mitigation: 自动发现结果合并保留手动模型，除非用户显式移除

## Open Questions

- 是否需要给 `ModelConfig` 增加 `source: discovered | manual | static` 字段，还是先通过描述/标签和 catalog 归属处理
- 后续是否需要把 `selectedModelIds` 升级成 `modelId + type`，以支持同一供应商同 ID 多类型并存
