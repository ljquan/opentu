# 图片请求 Request ID 与刷新恢复经验

更新日期：2026-07-30

## 功能目标

OpenTu 为每次图片正式提交建立稳定的 `submissionRequestId`，并在可信 Tuzi 请求头中发送：

```http
POST /v1/images/generations
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

首次提交使用任务 ID；用户重试时保留任务 ID，但生成新的提交 Request ID。这样旧请求、旧轮询和迟到结果无法覆盖新重试。

## 请求头规则

- 图片正式 POST 前先事务持久化提交 Request ID、提交标记和调用路由。
- 六个普通可信节点通过固定同源代理保留原节点、Token、计费和权限域，并附加该头。
- 直接跨域兼容节点：`bus`、`bus2`、`bus3`、`business.tu-zi.com`。
- 兼容节点不混入普通请求备用列表；部署不支持固定代理时才确定性路由到兼容节点。
- 固定代理只允许已知 Tuzi 节点，不能转发任意地址。
- 带 Request ID 的 POST 遇到网络错误、404 或 5xx 不跨节点重提，避免重复生成和计费。
- GET、第三方地址和不可信供应商不接收任务 Request ID；恢复 GET 会清除已有的大小写变体。

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

轮询具有有界并发、FIFO 等待队列、请求超时、响应体限制、退避和完整清理。原配置节点优先；网络或协议故障时才切换可信查询节点。收到 `processing_or_not_found` 后等待下一轮，不自动重新提交 POST。

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

- 本地、局域网及受支持的公网页面通过固定同源路径访问原配置节点，请求头有唯一正确的 `X-Request-Id`。
- 正常健康 POST 期间没有结果查询 GET，也没有第二个图片 POST。
- 刷新后启动只读结果 GET，GET 不携带 `X-Request-Id`。
- 上游成功后原任务完成，卡片显示图片；缓存失败仍可显示远程图片。
- 旧任务、未正式提交任务、取消任务和新重试不会被旧轮询覆盖。
