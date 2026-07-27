# 图片请求 Request ID 经验

更新日期：2026-07-27

## 功能目标

OpenTu 在图片提交请求中增加 `X-Request-Id`，用于把本地图片任务与 API 请求关联起来。

Request ID 直接复用本地图片任务 ID：

- 每个图片任务创建时由 `generateTaskId()` 生成 UUID。
- 同一任务的首次提交与重试复用同一个 ID。
- 不同任务使用不同 ID，避免并发请求互相覆盖。
- MCP 直调优先复用 `retryTaskId`，新调用生成任务 UUID。
- 模型评测使用评测条目 `entry.id`。
- ID 不包含账号、API Key、提示词或图片内容。

请求示例：

```http
POST /v1/images/generations
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

## 覆盖范围

`X-Request-Id` 覆盖以下图片提交链路：

- OpenAI-compatible 图片生成与编辑。
- Tuzi/GPT Image 适配器。
- Google `generateContent` 图片请求。
- 异步图片任务的首次提交请求。
- MCP 图片生成入口。
- 模型评测图片生成。

统一适配器只对非 `GET` 的图片提交请求透传 Request ID。异步状态轮询 `GET` 不携带该标头，避免把轮询误认为新的图片提交。

## 调用链

1. 图片任务创建时生成本地 UUID。
2. 执行器把任务 ID 写入适配器上下文的 `requestId`。
3. 图片适配器在供应商和运行环境允许时写入 `X-Request-Id`。
4. 同一任务重试时继续传递原任务 ID。

核心代码位置：

- `packages/drawnix/src/utils/task-utils.ts`
- `packages/drawnix/src/services/model-adapters/context.ts`
- `packages/drawnix/src/services/model-adapters/default-adapters.ts`
- `packages/drawnix/src/services/media-api/image-api.ts`
- `packages/drawnix/src/services/async-image-api-service.ts`
- `packages/drawnix/src/services/media-executor/fallback-executor.ts`
- `packages/drawnix/src/utils/gemini-api/apiCalls.ts`
- `packages/drawnix/src/mcp/tools/image-generation.ts`
- `packages/drawnix/src/services/model-benchmark-service.ts`

## 实现约束

- 只在图片提交请求中注入，不修改请求体和 URL。
- 不覆盖鉴权及供应商自定义请求头。
- 浏览器跨域请求必须遵守供应商 CORS；当前只在可信 Tuzi 同源或本地代理路径自动附加。
- 不为轮询请求重复生成 ID。
- Request ID 只是短字符串，不增加图片或文件的内存占用。
- 不包含查询面板、找回按钮、找回地址、自动找回或 `/log/get-request` 调用。

## 回归检查

```bash
pnpm --filter @aitu/drawnix exec vitest run \
  src/services/__tests__/model-adapter-context.test.ts \
  src/services/__tests__/gpt-image-adapter.test.ts \
  src/services/__tests__/async-image-api-service.test.ts \
  src/services/__tests__/media-api-routing.test.ts \
  src/services/__tests__/default-image-adapter.test.ts \
  src/services/__tests__/media-executor.test.ts \
  src/services/__tests__/model-benchmark-service.test.ts \
  src/services/__tests__/task-queue-service-image-retry.test.ts \
  src/utils/gemini-api/apiCalls.test.ts \
  src/mcp/tools/__tests__/image-generation.test.ts
pnpm exec nx run drawnix:typecheck
git diff --check
```

通过标准：图片提交头等于本地任务 ID、同一任务重试复用原 ID、不同任务 ID 不同、轮询 `GET` 不携带该头。
