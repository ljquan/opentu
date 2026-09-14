# 图片请求 Request ID 与刷新恢复经验

更新日期：2026-09-14

## 功能目标

OpenTu 为每次图片正式提交建立稳定的 `submissionRequestId`。仅 Request-ID-CORS 兼容 Tuzi 节点在请求头中发送：

```http
POST /v1/images/generations
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

首次提交使用任务 ID；用户重试时保留任务 ID，但生成新的提交 Request ID。这样旧请求、旧轮询和迟到结果无法覆盖新重试。

## 请求头规则

- 图片正式 POST 前先事务持久化稳定的提交 Request ID、提交标记和调用路由。
- 所有图片正式 `POST` 直接请求用户配置节点，不再通过固定同源代理改写地址。
- 六个普通可信节点不附加 `X-Request-Id`；发送前持久化的 `submissionRequestId` 仍用于刷新后的结果查询。
- 直接跨域兼容节点：`bus`、`bus2`、`bus3`、`business.tu-zi.com`。
- 兼容节点保持直连、可附加与提交 ID 一致的 `X-Request-Id`，且不混入普通请求备用列表；系统不会自动改写到兼容节点。
- 图片 POST 遇到网络模糊失败、404 或 5xx 不跨节点重提，避免重复生成和计费；网络结果未知后只按同一 Request ID 查询原节点结果，不再发送 POST。明确 `model_not_found` 的既有模型别名纠正不属于网络恢复重提。
- GET、第三方地址和不可信供应商不接收任务 Request ID；恢复 GET 会清除已有的大小写变体。

## 环境路由

- 本地、局域网、官方公网部署和自托管页面的图片 `POST`、刷新恢复 `GET` 均直连用户配置节点。
- 同步图片路径允许可去重的 `/vN` 或 `/vNbetaN` 前缀。
- Request-ID-CORS 兼容节点可带请求头；普通六节点不带请求头，但仍保留结果轮询资格。
- Vite、Vercel、Netlify、生产及预发布 Nginx 中的 `/__opentu_tuzi_proxy__/` 图片代理配置已移除。
- `/__opentu_tuzi_session__/` 是账户登录和系统 Token 链路，继续保留，不属于图片代理。
- 文本、音频、视频、异步图片、普通 GET 和第三方绝对 URL 不因本次生产修复改道。

## 刷新后恢复

页面刷新后，只恢复同时具有以下持久化信息的同步图片任务：

- `submissionRequestId`
- `imageSubmissionAttempted === true`
- 可信同步图片 `invocationRoute`
- 状态仍为处理中，且未取消、删除、重试或同步自远端

恢复只发送：

```text
GET /v1/images/generations/result?request_id=<submissionRequestId>
```

健康请求不会并行轮询。只有页面恢复流程会把任务切换为 `PROCESSING + POLLING`。

轮询具有有界并发、FIFO 等待队列、请求超时、响应体限制、退避和完整清理。查询始终固定到原配置节点；网络或协议故障只会等待下一轮。收到 `processing_or_not_found` 后同样等待下一轮，不自动重新提交 POST。

普通六节点的提交未携带 `X-Request-Id`，因此“刷新后发出轮询”和“上游能够关联并返回原结果”是两个不同结论。客户端保证前者；后者取决于上游是否有其他关联机制，必须通过真实环境单独验收。

## 卡片渲染

上游返回成功后：

1. 校验结果 URL。
2. 尝试走现有图片缓存。
3. 通过 Request ID 条件事务完成原任务。
4. 复用任务队列事件更新批量预览和原卡片。

缓存失败不会丢弃可用远程 URL。取消、删除、重试或其他终态已抢先写入时，旧结果会被忽略。

正常图片任务仍使用现有 15 分钟总时限；到期明确失败，不提供 24 小时补偿，也不猜测旧任务 ID。

## 核心代码

- `packages/drawnix/src/services/provider-routing/provider-transport.ts`
- `packages/drawnix/src/services/provider-routing/tuzi-api-endpoints.ts`
- `packages/drawnix/src/services/image-generation-recovery-service.ts`
- `packages/drawnix/src/services/media-executor/task-storage-writer.ts`
- `packages/drawnix/src/services/task-queue-service.ts`
- `packages/drawnix/src/hooks/useTaskStorage.ts`
- `packages/drawnix/src/hooks/useTaskExecutor.ts`

## 回归标准

- 本地、局域网及公网页面的图片 `POST` 和恢复 `GET` 直接访问原配置节点，不出现 `/__opentu_tuzi_proxy__/`。
- 六个普通节点的正式 `POST` 不携带 `X-Request-Id`；兼容节点携带唯一且正确的 `X-Request-Id`。
- 正式 `POST` 前仍持久化稳定 Request ID、提交标记和调用路由。
- 正常健康 POST 期间没有结果查询 GET；网络结果未知时没有第二个图片 POST。
- 刷新后启动只读结果 GET，GET 不携带 `X-Request-Id`。
- 普通节点即使持续返回 `processing_or_not_found`，也只按退避继续轮询至原截止时间，不自动重新提交。
- 上游成功后原任务完成，卡片显示图片；缓存失败仍可显示远程图片。
- 旧任务、未正式提交任务、取消任务和新重试不会被旧轮询覆盖。
