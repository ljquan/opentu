# 图片请求 Request ID 与刷新恢复经验

更新日期：2026-09-15

## 功能目标

OpenTu 为每次图片正式提交建立稳定的 `submissionRequestId`。可信 Tuzi 同步图片节点在请求头中发送：

```http
POST /v1/images/generations
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

首次提交使用任务 ID；用户重试时保留任务 ID，但生成新的提交 Request ID。这样旧请求、旧轮询和迟到结果无法覆盖新重试。

## 请求头规则

- 图片正式 POST 前先事务持久化稳定的提交 Request ID、提交标记和调用路由。
- 所有图片正式 `POST` 直接请求用户配置节点，不再通过固定同源代理改写地址。
- 所有可信 Tuzi 同步图片节点附加 `X-Request-Id`；API 与网关必须统一放行并暴露相关请求头。
- 图片 POST 遇到网络模糊失败、404、5xx、普通 429 或无法确认的响应时不跨节点重提，避免重复生成和计费；网络结果未知后先按同一 Request ID 查询原节点结果。
- 只有 API 明确返回 `accepted=false,retryable=true`，并通过 `X-Tuzi-Request-Accepted: false` 与 `X-Tuzi-Request-Retryable: true` 表达同一结论时，才允许携带同一 Request ID 切换可信备用节点。
- 恢复 GET 同时携带 `request_id` 查询参数和相同的 `X-Request-Id`；其他 GET、第三方地址和不可信供应商不接收该请求头。

## 环境路由

- 本地、局域网、官方公网部署和自托管页面的图片 `POST`、刷新恢复 `GET` 均直连用户配置节点。
- 同步图片路径允许可去重的 `/vN` 或 `/vNbetaN` 前缀。
- 可信 Tuzi 节点均可携带请求头；本地 API 仅在被当前部署显式配置时作为直连节点，不加入公网备用集合。
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

轮询具有有界并发、FIFO 等待队列、请求超时、响应体限制、退避和完整清理。查询每轮优先原配置节点；原节点发生网络错误、429 或 5xx 时，才继续查询共享幂等存储可见的可信备用节点。收到 `processing_or_not_found` 后结束本轮并等待下一轮，不自动重新提交 POST。

跨节点查询和受控 POST 切换依赖所有 API 节点复用同一数据库中的幂等记录；未共享数据库的节点不得作为安全备用节点。

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
- 所有可信 Tuzi 同步图片正式 `POST` 携带唯一且正确的 `X-Request-Id`。
- 正式 `POST` 前仍持久化稳定 Request ID、提交标记和调用路由。
- 正常健康 POST 期间没有结果查询 GET；结果未知时没有第二个图片 POST。
- 只有明确 `accepted=false,retryable=true` 才允许携带同一 ID 切换可信备用节点；普通 429、5xx、网络失败均不得切换 POST。
- 刷新后启动只读结果 GET，查询参数和请求头使用相同 Request ID，且每轮优先原节点。
- 任一节点返回 `processing_or_not_found` 后按退避等待至原截止时间，不自动重新提交。
- 上游成功后原任务完成，卡片显示图片；缓存失败仍可显示远程图片。
- 旧任务、未正式提交任务、取消任务和新重试不会被旧轮询覆盖。
