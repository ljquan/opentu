# 图片请求 Request ID 经验

更新日期：2026-07-28

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
3. 图片适配器在可信 Tuzi 的非 `GET` 提交请求中写入 `X-Request-Id`。
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
- 不覆盖鉴权；若配置中已有任意大小写形式的 `X-Request-Id`，统一替换为当前任务 ID，避免浏览器合并出两个值。
- 可信 Tuzi API 的图片非 `GET` 提交始终附加，不受 OpenTu 网页是本地、局域网或公网部署影响。
- OpenTu 公网部署仍直连用户配置的可信 Tuzi API，不新增匿名公网代理，也不因 Request ID 改投其他节点。
- 带 Request ID 的正式提交遇到网络错误或 `404` 时不跨节点重试，避免同一个 Token 被送入不同的鉴权、计费和权限域；四个 `bus` 节点仅用于中断后的只读结果查询。
- 本机与私有局域网 Vite 开发使用既有同源代理，代理仍转发到原配置节点；公网生产页面直连原配置节点，因此该节点的 CORS 必须放行 `X-Request-Id`。
- 非可信、用户自定义的供应商不自动附加，避免破坏其跨域请求。
- 不为轮询请求重复生成 ID。
- Request ID 只是短字符串，不增加图片或文件的内存占用。
- 不包含查询面板、找回按钮、找回地址、自动找回或 `/log/get-request` 调用。

## 回归检查

```bash
pnpm --filter @aitu/drawnix exec vitest run \
  src/services/__tests__/provider-routing.test.ts \
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

通过标准：本机与私有局域网 Vite 页面通过同源代理转发到用户原配置节点，公网生产页面直接请求原配置节点；正式请求头等于当前提交 Request ID，网络错误或 `404` 不改投其他节点。只读恢复轮询可在四个查询节点间故障切换，轮询 `GET` 不携带该头，非可信自定义供应商不携带该头。
