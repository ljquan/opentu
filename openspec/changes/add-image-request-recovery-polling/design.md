## Context

OpenTu 的任务队列与独立媒体生成入口都为每次图片提交持久化 `submissionRequestId` 与 `imageSubmissionAttempted`，并保存 `invocationRoute`。首次提交的 Request ID 等于 `task.id`；每次重试保持任务 ID 不变，但生成新的提交 Request ID。Tuzi 会在客户端断开后继续接收上游响应，并提供：

```text
GET /v1/images/generations/result?request_id=<submissionRequestId>
```

正式 POST 必须使用 `invocationRoute` 解析出的用户原配置 Base URL。Request ID 只作为请求头和恢复关联键，不参与提交节点选择；提交遇到网络错误或原始 `404` 时也不得跨节点重发，避免同一 Token 被送入不同的鉴权、计费和权限域。后续只读结果查询必须先访问原配置节点，再按可信 Request-ID 公网节点容错。

查询结果包含 `succeeded`、`failed` 和 `processing_or_not_found`。当前缺口在客户端：同步图片没有 `remoteId`，刷新后会被统一中断逻辑标记为失败。

## Goals / Non-Goals

- Goals:
  - 连接中断或刷新后继续接收同一图片任务的最终结果
  - 保持任务 ID、供应商身份、Token 和画布插入上下文不变，并让重试轮换提交 Request ID
  - 在公网部署、局域网和本地环境保持一致行为
  - 批量任务使用有界资源且不丢恢复任务
  - 让取消、删除、重试和迟到响应保持幂等
- Non-Goals:
  - 不新增手动找回 UI
  - 不持久化 API Key 副本
  - 不对不可信供应商猜测或探测查询接口
  - 不把 `processing_or_not_found` 当作重新提交依据

## Decisions

### 1. 持久化每次提交身份并复用现有轮询阶段

恢复条件同时满足：

- 任务类型为图片
- 当前提交 Request ID 存在；旧版 `PROCESSING` 或 `INTERRUPTED` 任务缺少字段时按迁移规则回退到任务 ID
- 持久化调用路由可解析到可信 Tuzi 节点
- `imageSubmissionAttempted === true`，即正式 POST 已经发起
- 任务仍处于图片任务 15 分钟总时限内
- 任务没有被用户取消、删除或被新一次重试替代

恢复中的任务继续使用 `TaskStatus.PROCESSING` 与现有 `TaskExecutionPhase.POLLING`。不新增 `imageRecovery` 结果实体，也不把恢复状态塞进 `task.error`。

所有图片入口都必须在正式 POST 前等待 `imageSubmissionAttempted=true` 对应的 IndexedDB 读写事务完成；仅 `put` 请求成功但事务尚未提交，不视为持久化完成。

启动恢复的入口有两个：

- 正式 POST 已尝试后，因页面生命周期、网络错误、超时或连接终止而出现模糊响应丢失
- 页面初始化发现符合条件的 `PROCESSING` 任务，或旧版本写入的 `FAILED + INTERRUPTED/INTERRUPTED_DURING_SUBMISSION` 任务

### 2. 使用查询参数传当前提交 Request ID，GET 不发送 Request-ID 头

每轮查询使用 `request_id=submissionRequestId`。请求通过原任务 `invocationRoute` 解析当前供应商配置和用户凭据，但不复制或持久化 API Key。首次提交 ID 等于任务 ID；重试生成新 ID，旧任务缺少字段时回退到任务 ID。

可信 Tuzi GET 必须清除任何大小写形式的 `X-Request-Id`。查询目标由原配置节点和预置的 Request-ID 公网节点组成；绝对 URL 和第三方地址不得继承凭据或提交 Request ID。

公网 OpenTu 不限制固定页面 Origin。跨域查询仍必须携带用户自己的认证信息，并依赖 Tuzi 后端已有的用户、Token、开放平台应用隔离。提交 Request ID 不得发送到可信列表以外的地址。

### 3. 原节点优先的多节点容错不触发重复提交

轮询仅发送只读 GET。每轮先查询正式 POST 使用的原配置节点，再查询可信 Request-ID 公网节点。单节点出现网络错误、协议中断、原始 404 或 5xx 时，本轮切换到下一个节点；只有原配置节点的 401/403 才能证明当前供应商凭据不可用，备用节点的独立鉴权失败不得覆盖原节点的处理中状态。

`processing_or_not_found` 保持非终态，并继续检查本轮剩余节点；仅当所有节点都未返回终态时才进入下一轮。系统不得因此重新发送图片生成 POST，避免重复生成和重复计费。

### 4. 使用有界调度器而不是固定数量的常驻轮询 Promise

- 每个任务任一时刻最多存在一个活动轮询
- 实际查询使用小型并发池；超出并发上限的任务进入 FIFO 等待队列，不能直接丢弃
- 一次查询结束后释放并发槽，再通过 `setTimeout` 安排下一轮
- 轮询基础间隔为 5 秒并加入小幅随机抖动；连续传输失败时逐步退避，最大间隔受限
- 所有定时器、AbortController 和队列引用在完成、失败、取消、删除、重试或服务销毁时清理
- 页面刷新后根据任务时间戳计算剩余总时限，不能重新获得完整的 15 分钟预算

这能限制公开网页上批量任务带来的请求洪峰，也避免长期 Promise 链和无界内存增长。

### 5. 终态写回必须幂等

结果状态映射：

| 上游结果                  | 本地动作                                                                       |
| ------------------------- | ------------------------------------------------------------------------------ |
| `succeeded`               | 校验图片 URL，尝试写入现有缓存，然后通过现有任务完成流程写回结果并触发画布插入 |
| `failed`                  | 使用上游 message/code 写入 `task.error` 并标记失败                             |
| `processing_or_not_found` | 保持处理中并继续轮询                                                           |
| 超过总时限                | 标记 `RECOVERY_TIMEOUT`，提示“暂未查询到上游结果，可重试”                      |

缓存写入失败不改变上游成功事实：任务仍以远程 URL 完成，并沿用现有缓存警告能力。对同一远程结果只尝试一次缓存，避免反复下载和额外内存占用。若 IndexedDB 终态写回瞬时失败，轮询器保留已取得的终态结果并有限次重试写回，不能在写回前删除恢复任务或静默吞掉异常。

任务更新前再次读取当前状态。内存写回只有 `submissionRequestId` 与本轮 `startedAt` 都仍匹配且任务仍为处理中时才能生效；IndexedDB 的完成、失败和异步 `remoteId` 写回必须在同一个 `readwrite` 事务内校验当前 Request ID 与非终态状态后再更新。原请求和轮询同时返回时，第一个合法终态生效；重试轮换 ID 后，旧提交、旧轮询及其迟到结果均被忽略。

## Risks / Trade-offs

- `processing_or_not_found` 无法区分“仍在处理”和“从未收到请求” → 在总时限内继续查询，超时后明确提示重试，但不自动重提
- 多标签页可能重复发送只读查询 → 单标签页内去重，终态写回保持幂等；不为本次能力引入新的跨标签页锁实体
- 节点版本不一致可能出现 404 → 原配置节点优先并轮换可信查询节点，把原始 404 当作节点兼容故障而不是业务失败
- 公网节点可能使用独立 Token 域 → 原配置节点的认证结果具有权威性，备用节点 401/403 不覆盖原节点已确认的处理中状态
- 当前供应商配置被删除或 Token 失效 → 停止轮询并显示可操作的配置错误，不保存旧密钥副本

## Migration Plan

1. 新版本加载任务时识别仍在 15 分钟窗口内的旧中断图片任务。
2. 旧任务缺少提交元数据时，仅对历史 `PROCESSING`、`INTERRUPTED` 或 `INTERRUPTED_DURING_SUBMISSION` 图片任务使用 `task.id` 作为提交 Request ID，并视作已尝试提交；新任务显式记录为未提交时不得恢复。
3. 符合可信 Tuzi 路由条件的任务恢复为处理中并开始轮询。
4. 超出时间窗、路由缺失或非 Tuzi 任务保持原有失败状态。
5. 回滚时不会破坏旧数据；`PROCESSING + POLLING` 仍是现有任务模型可读取的状态。

## Open Questions

- 无。轮询总时限复用现有图片任务 15 分钟常量；若上游后续提供明确的结果保留期，再单独调整。
