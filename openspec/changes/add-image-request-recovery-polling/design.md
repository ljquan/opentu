## Context

首次图片提交使用任务 ID 作为 `submissionRequestId`，重试保持任务 ID 不变并生成新的提交 Request ID。Tuzi 提供：

```text
GET /v1/images/generations/result?request_id=<submissionRequestId>
```

公网浏览器只有在用户配置节点的 CORS 放行 `X-Request-Id` 时，才能在正式 POST 中携带该请求头。直接跨域已验证兼容节点为 `bus`、`bus2`、`bus3` 和 `business.tu-zi.com`；其他配置节点保持原地址请求，但不启用该次提交的结果恢复。

## Goals / Non-Goals

- Goals:
  - 用户配置兼容节点时，在图片正式请求头中携带 Request ID。
  - 页面刷新或同页面正式提交结果未知后，找回同一次提交的结果并渲染回原卡片。
  - 不重复提交、不泄露凭据，并限制轮询并发、响应体和内存占用。
- Non-Goals:
  - 不为健康请求增加并行轮询。
  - 不猜测旧任务是否曾发送 Request ID。
  - 不延长现有图片任务 15 分钟总时限。

## Decisions

### 1. 正式 POST 只提交一次

普通可信 Tuzi 节点集合与 Request-ID-CORS 兼容节点集合分开维护。传输层始终保留用户配置的 Base URL，不使用同源代理或全局备用节点。

当图片正式请求携带 Request ID 时：

- 配置节点已兼容 CORS：保持该节点并附加 Request ID。
- 配置节点不兼容 CORS：保持该节点但不附加 Request ID，因此该次提交不进入结果恢复。
- 配置节点不可信或请求路径逃逸到第三方绝对 URL：不附加 Request ID。
- 网络错误、5xx 或 404 都不得改写地址或切换节点，避免请求偏离用户配置、重复生成和计费。

恢复资格以正式提交的最终 prepared URL 与 Header 为准，而不是只检查配置中的
provider base URL 或 submitPath 后缀。任务在 POST 前持久化实际选中的 binding；
若最终目标因绝对 URL 等原因不能携带 Request ID，则该任务不得进入固定结果查询。

共享传输层对 GET、HEAD、POST 和其他方法都只请求用户配置节点。网络错误保留原错误，HTTP 响应原样返回，不自动切换 Tuzi 节点。

GET 请求始终移除任意大小写形式的 `X-Request-Id`。

### 2. 提交身份在 POST 前完成事务持久化

所有图片入口在正式 POST 前以同一条件事务写入：

- `submissionRequestId`
- `imageSubmissionAttempted=true`
- 实际 adapter 选中的 `invocationRoute` 与 binding
- `executionPhase=SUBMITTING`

健康请求继续走原响应、下载、缓存和完成流程，不启动恢复服务。明确 HTTP/业务失败、结构闭合但格式非法的完整响应和用户主动取消仍走原终态；只有可信 Tuzi 的同步 `images/generations|edits` 正式提交（含明确映射到该端点、有效请求方法为 POST 且没有自定义轮询路径的自定义 HTTP binding；有效方法由显式配置或请求体默认规则共同决定）在 `fetch` 或成功响应体读取阶段发生网络中断时，才会被标记为“提交结果未知”。异步 `/videos`、带 `pollPathTemplate` 的自定义 HTTP、Google `generateContent` 及其他图片协议不得进入该同步恢复状态机。

### 3. 页面恢复和在线模糊失败切换到 POLLING

页面初始化恢复或同页面网络中断恢复仅识别同时满足以下条件的任务：

- 图片、`PROCESSING`、无 `remoteId`
- 显式存在 `submissionRequestId`
- `imageSubmissionAttempted === true`
- 保存了可信同步图片调用路由
- 未取消、删除、同步自远端或被新重试替代

只有可能进入图片恢复的持久化候选等待设置管理器完成敏感字段解密；无关任务运行时初始化不被图片恢复阻塞。等待期间保留任务原始 `startedAt`，仅在缺失时回退 `createdAt`，并以原 15 分钟截止时间调度单个定时器，不因设置初始化而重置或延长时限。解密后，存储恢复事务才判断资格并将任务切换为 `PROCESSING + POLLING`。在线网络中断路径先完成该条件事务，再释放当前执行锁；只读查询必须在执行锁释放后启动。延迟运行时只为这类持久化候选自动唤醒。

设置初始化在原截止时间内永久 pending 时条件写入 `RECOVERY_TIMEOUT`；初始化 reject、恢复服务无法解析原配置或实际 binding 时立即条件写入 `RECOVERY_ROUTE_UNAVAILABLE`。迟到的初始化结果必须再次校验 Request ID、原始开始时间和执行实例身份，不得复活终态或 replacement。

### 4. 只读轮询使用有界资源

- 每个任务最多一个轮询条目。
- 使用小型并发池、FIFO 等待队列、请求超时和有上限退避。
- 并发槽覆盖查询、终态远程图片下载与任务写回；取消、删除、重试或卸载会中止仍在进行的缓存下载。
- 只查询原配置节点；网络错误或可重试 HTTP 状态仅在后续轮询中重试同一地址。
- 任一节点返回 `processing_or_not_found` 后结束本轮，等待下一轮，避免无效扫完所有节点。
- 恢复查询响应体限制为 256 KiB，结果 URL 只接受无凭据的 HTTP(S) 地址。
- 通过受控 reader 读取的非流式 provider 响应使用渐增单字节缓冲区：成功体最多 64 MiB，错误体最多 1 MiB；超过声明或实际字节上限立即取消流。
- 受控响应在 2xx 或错误 Header 已返回后仍受原硬超时和用户取消约束，即使流不响应 Abort 也必须及时结束。只有可信同步图片 2xx 的模糊流中断可转为结果未知；错误响应、其他协议和正常 EOF 后的非法 JSON 保留原错误语义。
- 未声明使用受控 reader 的响应在返回后立即释放 transport 超时与监听资源，避免原生 reader 调用把资源保留到长超时。
- 完成、失败、取消、删除、重试或卸载时清理定时器、队列引用和 AbortController。
- 总截止时间复用现有图片任务 15 分钟时限，到期明确失败。

### 5. 终态写回与卡片渲染

恢复成功先校验响应中的 Request ID（字段存在时必须与当前提交一致），再尝试复用
现有图片缓存；缓存失败仍使用远程 URL 完成任务。完成结果通过现有任务队列事件同步到批量预览和原卡片。

IndexedDB 写回在同一事务内校验当前 Request ID 和非终态状态。原请求、恢复轮询、取消和新重试发生竞态时，第一个合法终态生效；旧 Request ID 的迟到结果被忽略。

删除操作等待同任务已串行化写入完成后才释放 tombstone；同 ID replacement 建立前，旧执行的迟到写入始终被拒绝。批量清空完成后保持写入暂停，避免清空期间排队的旧写入复活任务。

共享任务队列为每个内存任务实例维护不持久化的生命周期令牌。新建、重试、较新同 ID 对象覆盖、显式删除后恢复和删除失败回滚都会换代；删除、归档和全部清空释放令牌。hook 等待队列保存任务快照与当时令牌，出队时重新读取当前任务并校验令牌与状态；取消会移除等待项，同 ID replacement 会替换等待快照并取消旧执行。内部执行器同时以 AbortController 所有权校验，hook 执行槽与 fallback 视频轮询槽以令牌/attempt 所有权校验。旧回调、模拟进度、缓存写回、终态写回和 `finally` 只能操作自己的实例，不能覆盖 replacement 或释放新实例的槽位。

备份导入和 GitHub 同步属于允许恢复 tombstone 的显式入口。较新的同 ID 对象覆盖现有任务前必须立即停止旧图片恢复条目并中止旧执行，避免旧轮询继续占用并发槽。运行期恢复的 `PROCESSING + remoteId` 视频由延迟运行时订阅接管；令牌失效会停止旧轮询继续发请求，保存的调用路由不可用时写入明确失败而不是永久处理中。

终态写回失败时使用有界 watchdog 和退避重试；每个任务最多一个在途超时写回 Promise。截止时间到达时，已经观测到的成功或失败终态优先于超时；缓存下载失败或超时时使用已验证的远程 URL 完成任务，不复制大图片数据或创建无界 Promise/定时器。

### 6. Custom HTTP multipart 文件读取受信且有界

Custom HTTP 表单文件字段在 provider 正式提交前读取，因此不得继承 provider Token、Cookie、Referer 或任意重定向。文件来源仅允许：

- 有效图片 data URL；
- 与当前页面同源的相对/绝对 HTTP(S) 或 blob URL；
- 无用户名密码、且主机不是 localhost、私网、链路本地地址的跨源 HTTP(S) URL。

跨源下载固定使用 `credentials=omit`、`referrerPolicy=no-referrer` 和 `redirect=error`，并要求响应 MIME 为 `image/*`。单文件最多 20 MiB，整张表单最多 16 个文件、64 MiB 文件数据和 1 MiB 文本数据；每个文件读取前下传剩余总预算，同时校验声明长度与实际流字节。流式读取初始缓冲最多 64 KiB 并按需增长；文件按顺序处理，任务 AbortSignal 会取消当前下载并阻止正式 provider POST。

## Risks / Trade-offs

- `processing_or_not_found` 不能证明请求一定存在，因此只读等待到原 15 分钟截止，不自动重提。
- 原配置节点短暂不可用时，恢复查询只能等待后续轮询，不会切换到其他节点。
- 配置或 Token 在刷新后已失效时无法继续查询，任务会得到明确配置/鉴权失败，而不是永久处理中。
