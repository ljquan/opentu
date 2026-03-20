## Context

当前仓库中已经存在统一的 `GeminiMessage` 消息结构，并且底层协议层已经能处理图片消息：

- `openai.chat.completions` 可以直接承载 `image_url`
- `google.generateContent` 已经能把 `image_url` 转成 `inline_data`

但上层文本链路并没有把图片喂给协议层：

- `chat-service` 会显式丢弃 `attachments`
- `AgentExecutor` 默认只发送结构化文本和图片占位符
- `ai_analyze` 工作流主要传递纯文本 `messages`

因此，当前需要解决的不是“协议是否支持图片”，而是“什么时候允许文本消息带图，以及如何在不同入口统一组装消息”。

## Goals / Non-Goals

- Goals:
  - 让文本聊天与 Agent 在支持的绑定上能真正发送图片内容
  - 用绑定能力位控制是否允许图片输入，避免纯文本模型误收图片
  - 在不改动现有 provider routing 主干的前提下复用现有 `GeminiMessage` 结构
- Non-Goals:
  - 不在本阶段接入新的文件上传协议
  - 不在本阶段统一支持所有第三方自定义文本协议
  - 不在本阶段做服务端中转上传

## Decisions

### Decision: 以绑定能力位控制文本图片输入

文本模型是否支持图片输入，不再由 UI 或模型名猜测，而是由文本绑定显式声明。

建议新增字段：

```ts
interface TextInputCapability {
  supportsImageInput?: boolean;
  maxImageCount?: number;
}
```

第一阶段默认规则：

- `google.generateContent` 绑定默认 `supportsImageInput = true`
- `openai.chat.completions` 绑定默认 `supportsImageInput = true`
- 其他文本绑定默认 `false`

这样可以在不引入复杂供应商探测的前提下，先覆盖当前已经落地的两条文本协议。

### Decision: 统一使用 `GeminiMessage.content[]` 承载文本图片消息

不新增新的消息结构，继续复用：

```ts
type GeminiMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
```

原因：

- 现有 OpenAI 兼容消息已经能直接使用 `image_url`
- 现有 Google 协议转换器已经能把 `image_url` 转成 `inline_data`
- 这条路径对聊天与 Agent 都可复用

### Decision: 先优先支持可直接引用的图片来源

第一阶段支持以下来源：

- 聊天抽屉上传得到的图片附件
- 画布分析/Agent 选择上下文中的图片 URL
- 已存在的 `data:`、缓存 URL、远程 URL

对于 Google 协议，继续依赖现有 `toGoogleInlineData()` 在发送前转码。

### Decision: 保留参考图片占位说明，但不再仅靠占位符

Agent 原有的“参考图片说明文字”仍可保留，帮助模型理解上下文，但它不应代替真实图片输入。

最终消息结构应同时包含：

- 文本说明
- 图片内容 part

## Risks / Trade-offs

- 第三方 OpenAI 兼容供应商未必真的支持 vision，即使接口名是 `chat/completions`
  - Mitigation: 第一阶段仍以绑定能力位控制，必要时允许后续做供应商级覆盖
- 将本地图片转为 `data:` 或 Google `inline_data` 可能增大请求体
  - Mitigation: 第一阶段不处理超大图上传，后续通过 Gemini Files API / OpenAI file 引用扩展
- Agent 消息结构从纯文本变成多 part 后，旧的日志和调试输出可能不再完整反映实际请求
  - Mitigation: 为消息组装层增加最小调试信息与测试覆盖

## Migration Plan

1. 为文本 binding 增加图片输入能力声明与推断
2. 改造聊天服务，允许在支持的文本 binding 下发送附件图片
3. 改造 Agent 默认执行链，将参考图片拼进用户消息
4. 改造 `ai_analyze` 相关入口，透传图片内容而不是只透传占位符
5. 补充最小测试，覆盖 OpenAI 与 Google 两条路径

## Open Questions

- 是否需要在 UI 上对“当前文本模型支持看图”做显式提示
- 第三方自定义文本协议是否需要在设置页允许手动关闭 vision 能力
