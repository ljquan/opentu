# Change: 为文本与 Agent 增加图片理解能力

## Why

当前项目中的图片与视频生成链已经支持多供应商协议路由，但文本与 Agent 链路仍然只把图片作为“存在附件”或“占位符说明”处理，没有真正把图片内容发送给上游模型。
这导致用户在聊天抽屉、AI 分析、Agent 工具规划等场景中，无法直接让模型“看图理解”，也无法在保持现有多供应商路由的前提下，安全地区分哪些文本模型支持图片输入、哪些不支持。

## What Changes

- 为文本协议绑定增加“支持图片输入”的能力声明
- 在聊天抽屉文本发送链中，将附件图片按多模态消息内容发送，而不是统一丢弃
- 在 Agent / `ai_analyze` 链中，将参考图片作为真实图片内容发送，而不是仅传占位符文本
- 第一阶段仅覆盖当前最稳定的两类文本协议：
  - `openai.chat.completions`
  - `google.generateContent`
- 为不支持图片输入的文本绑定增加显式保护，避免把图片内容发送给纯文本模型
- 保持现有文本、图片、视频的 provider routing 结构不变，不在本变更中引入新的上传协议或文件存储后端

## Impact

- Affected specs:
  - `agent-image-understanding`
- Affected code:
  - `packages/drawnix/src/services/chat-service.ts`
  - `packages/drawnix/src/services/agent/agent-executor.ts`
  - `packages/drawnix/src/components/ai-input-bar/workflow-converter.ts`
  - `packages/drawnix/src/services/canvas-operations/ai-analyze.ts`
  - `packages/drawnix/src/mcp/tools/ai-analyze.ts`
  - `packages/drawnix/src/services/provider-routing/*`
  - `packages/drawnix/src/utils/gemini-api/*`

## Scope

### Included In This Change

- 聊天抽屉中的附件图片进入文本消息
- Agent 默认执行链中的参考图片进入文本消息
- `ai_analyze` 工作流与画布分析场景中的参考图片进入文本消息
- 绑定级图片输入能力控制

### Not Included In This Change

- Gemini Files API 大文件上传
- OpenAI `responses` 协议接入
- 新增文件持久化后端或服务端中转
- 文本模型能力的自动远程探测

## Relationship To Existing Changes

- 本变更建立在 `add-provider-protocol-routing` 的文本协议绑定与运行时规划之上
- 本变更复用 `add-ai-input-paste-images` 已经建立的输入图片获取链路，但扩展其在文本/Agent 场景中的消费方式
