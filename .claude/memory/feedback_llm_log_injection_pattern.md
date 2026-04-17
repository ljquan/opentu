---
name: LLM 调用日志统一注入模式
description: 在瓶颈函数注入日志而非新建抽象层，sendChatWithGemini 和 callGoogleGenerateContentWithLog 是两个日志注入点
type: feedback
---

LLM API 日志应在瓶颈函数层注入，而非每个调用方手动添加。

**Why:** 项目中 LLM 调用分散在多处（聊天、歌词、分析等），手动在每个调用方加日志容易遗漏，且新功能需重复实现。

**How to apply:**
- 文本/聊天类调用：走 `sendChatWithGemini`（已内置日志），通过可选 `logMeta` 参数传 taskType/taskId
- 直接调用 `callGoogleGenerateContentRaw` 的分析类场景：改用 `callGoogleGenerateContentWithLog`（`logged-calls.ts`）
- 已有手动日志的场景（`generateImageWithGemini`、`fallback-executor`）不受影响，不会双重记录
- 新增 LLM 调用场景时，优先复用这两个入口，无需手动调 startLLMApiLog/completeLLMApiLog
