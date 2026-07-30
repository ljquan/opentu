## Context

首次图片提交使用任务 ID 作为 `submissionRequestId`，重试保持任务 ID 不变并生成新的提交 Request ID。Tuzi 提供：

```text
GET /v1/images/generations/result?request_id=<submissionRequestId>
```

公网浏览器只有在目标节点的 CORS 放行 `X-Request-Id`，或页面通过固定同源代理转发时，才能发出正式 POST。直接跨域已验证兼容节点为 `bus`、`bus2`、`bus3` 和 `business.tu-zi.com`；六个普通可信节点通过固定代理保留原 Token、计费和权限域。

## Goals / Non-Goals

- Goals:
  - 公网、本地和局域网页面都能在图片正式请求头中携带 Request ID。
  - 页面刷新后找回同一次提交的结果并渲染回原卡片。
  - 不重复提交、不泄露凭据，并限制轮询并发、响应体和内存占用。
- Non-Goals:
  - 不为健康请求增加并行轮询。
  - 不猜测旧任务是否曾发送 Request ID。
  - 不延长现有图片任务 15 分钟总时限。

## Decisions

### 1. 正式 POST 只提交一次

普通可信 Tuzi 节点集合与 Request-ID-CORS 兼容节点集合分开维护。
本地、局域网、官方域名、Vercel 和 Netlify 使用固定白名单同源代理；自定义公网部署可显式启用相同代理配置。兼容节点不会进入普通请求的全局备用列表。

当图片正式请求携带 Request ID 时：

- 配置节点已兼容 CORS：保持该节点。
- 配置节点是六个普通可信节点且部署支持同源代理：改写为对应固定代理路径，保留原节点与 Token。
- 配置节点可信但部署不支持同源代理和 CORS：确定性改写到首个兼容节点，并保留原 API 路径后缀。
- 配置节点不可信或请求路径逃逸到第三方绝对 URL：不附加 Request ID。
- 网络错误、404 或 5xx 后不得跨节点重复 POST，避免重复生成和计费。

GET 请求始终移除任意大小写形式的 `X-Request-Id`。

### 2. 提交身份在 POST 前完成事务持久化

所有图片入口在正式 POST 前写入：

- `submissionRequestId`
- `imageSubmissionAttempted=true`
- `invocationRoute`
- `executionPhase=SUBMITTING`

健康请求继续走原响应、下载、缓存和完成流程，不启动恢复服务。

### 3. 只有页面恢复流程切换到 POLLING

页面初始化仅识别同时满足以下条件的任务：

- 图片、`PROCESSING`、无 `remoteId`
- 显式存在 `submissionRequestId`
- `imageSubmissionAttempted === true`
- 保存了可信同步图片调用路由
- 未取消、删除、同步自远端或被新重试替代

存储恢复事务将任务切换为 `PROCESSING + POLLING`。延迟运行时只为这类持久化候选自动唤醒；执行器在初始化后执行少量有界启动重试，不使用永久结构扫描。

### 4. 只读轮询使用有界资源

- 每个任务最多一个轮询条目。
- 使用小型并发池、FIFO 等待队列、请求超时和有上限退避。
- 优先查询原配置节点；网络错误、404、408、425、429 或 5xx 才切换可信查询节点。
- 任一节点返回 `processing_or_not_found` 后结束本轮，等待下一轮，避免无效扫完所有节点。
- 响应体限制为 256 KiB，结果 URL 只接受无凭据的 HTTP(S) 地址。
- 完成、失败、取消、删除、重试或卸载时清理定时器、队列引用和 AbortController。
- 总截止时间复用现有图片任务 15 分钟时限，到期明确失败。

### 5. 终态写回与卡片渲染

恢复成功先尝试复用现有图片缓存；缓存失败仍使用远程 URL 完成任务。完成结果通过现有任务队列事件同步到批量预览和原卡片。

IndexedDB 写回在同一事务内校验当前 Request ID 和非终态状态。原请求、恢复轮询、取消和新重试发生竞态时，第一个合法终态生效；旧 Request ID 的迟到结果被忽略。

终态写回失败时使用有界 watchdog 和退避重试；不会复制大图片数据或创建无界 Promise/定时器。

## Risks / Trade-offs

- `processing_or_not_found` 不能证明请求一定存在，因此只读等待到原 15 分钟截止，不自动重提。
- 多节点可能存在短暂数据同步延迟，因此网络/协议错误可切换节点，但“处理中”不会在同一轮继续轰炸所有节点。
- 配置或 Token 在刷新后已失效时无法继续查询，任务会得到明确配置/鉴权失败，而不是永久处理中。
