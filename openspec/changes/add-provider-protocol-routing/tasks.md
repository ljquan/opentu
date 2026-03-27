## 1. Types And Storage

- [ ] 1.1 为运行时路由新增 `ResolvedProviderContext / ProviderModelBinding / InvocationPlan` 类型
- [ ] 1.2 扩展 provider catalog 存储结构，保存每个模型的原始元数据与绑定信息
- [ ] 1.3 停止按裸 `modelId` 作为跨 profile 的全局唯一键，统一使用 `selectionKey`

## 2. Provider Transport Layer

- [ ] 2.1 新增 `ProviderTransport` 抽象，统一处理 base URL、认证方式、额外 Header 和查询参数
- [ ] 2.2 为 `openai-compatible / gemini-compatible / custom` 提供 transport 模板或探测入口
- [ ] 2.3 将 discovery 从固定 `/models + Bearer` 改为通过 transport 执行

## 3. Binding Inference

- [ ] 3.1 为 discovery 增加 `bindingCandidates` 推断逻辑
- [ ] 3.2 支持同一模型在同一 profile 下生成多个协议绑定
- [ ] 3.3 为推断结果标记 `priority / confidence / source`

## 4. Invocation Planner

- [ ] 4.1 新增 `InvocationPlanner`，输入 `routeType + ModelRef`，输出 `InvocationPlan`
- [ ] 4.2 让 planner 支持显式模型、默认 preset 模型和 legacy 回退
- [ ] 4.3 当存在多个 binding 时，按优先级和能力筛选规则选择默认协议

## 5. Protocol Adapter Registry

- [ ] 5.1 将现有 `model-adapters` 重构为按 `protocol` 注册的适配器
- [ ] 5.2 为现有 Flux / MJ / Kling / Seedance / Seedream 适配器补齐 `requestSchema` 与标准化输出
- [ ] 5.3 为文本链路新增 `openai.chat.completions` 与 `google.generateContent` 适配器
- [ ] 5.4 为异步任务引入可复用的 `PollingStrategy`

## 6. Integration

- [ ] 6.1 将 `generation-api-service` 改为先走 planner，再取 protocol adapter
- [ ] 6.2 将 `gemini-api` 文本 / 图片 / 视频调用改为通过 planner 解析协议
- [ ] 6.3 将 `media-executor` 与 fallback 执行链改为复用相同的 planner 和 adapter registry

## 7. UI And Advanced Overrides

- [ ] 7.1 设置页继续保持“最少配置”，默认自动推断 binding
- [ ] 7.2 在歧义场景下，为高级用户提供协议绑定覆盖入口
- [ ] 7.3 在模型管理界面中展示模型来源和可用协议摘要，而不是暴露底层细节给普通用户

## 8. Verification

- [ ] 8.1 补充“同名模型不同 profile 不同协议”的路由测试
- [ ] 8.2 补充“同协议不同 requestSchema”的请求体构建测试
- [ ] 8.3 补充 discovery、planner、adapter registry 的集成测试
- [ ] 8.4 手工验证 `gemini-3-pro-image-preview` 在 OpenAI 兼容上游与 Gemini 官方上游中的双协议路由行为
