# Change: 图片任务按 Request ID 自动恢复轮询

## Why

同步图片请求可能已经到达 Tuzi 上游，但浏览器连接会因刷新、网络切换或页面关闭而中断。当前 OpenTu 会把这类任务直接标记为“任务被中断（页面刷新）”，导致上游稍后完成的图片无法回到原任务。

OpenTu 已为每次图片提交发送并持久化 `X-Request-Id`：首次提交使用任务 ID，每次重试生成新的提交 Request ID。Tuzi 也已提供按该 ID 查询最终结果的接口，因此应把结果找回接入现有任务队列，而不是要求用户手动复制 Request ID。

## What Changes

- 所有图片任务入口统一持久化提交 Request ID；可信 Tuzi 同步图片任务仅在正式 POST 已尝试发送后发生网络中断、超时或响应流丢失等模糊错误时进入自动恢复轮询，提交前预处理或参数错误直接失败
- 正式 POST 始终使用用户配置的原供应商节点，Request ID、网络错误或 `404` 都不得触发跨节点重复提交，避免切换 Token、计费和权限域
- 页面刷新后使用持久化的当前提交 Request ID 与调用路由继续查询；旧版 `PROCESSING`、`INTERRUPTED` 或 `INTERRUPTED_DURING_SUBMISSION` 任务缺少新字段时兼容回退到任务 ID
- 通过 `GET /v1/images/generations/result?request_id=<submissionRequestId>` 查询；GET 不携带 `X-Request-Id` 请求头
- 重试保持任务 ID 不变，但生成新的提交 Request ID，使旧轮询和旧结果自动失效，避免命中上一轮结果
- 只读结果查询先使用原任务对应的供应商节点、身份与用户 Token，再在 Request-ID 公网节点间容错；单节点“处理中或未找到”不能遮蔽其他节点已经产生的终态结果
- 使用有界并发、等待队列和带抖动的轮询间隔，批量任务不能因超过并发数而被丢弃
- 上游成功时复用现有缓存、任务完成与画布插入流程；缓存失败时保留可用远程 URL，终态写回瞬时失败时保留结果并重试
- 上游明确失败时展示真实错误；超过图片任务总时限后给出可重试提示
- 用户主动取消、删除或重试任务时停止旧轮询，防止迟到结果覆盖新状态

## Non-Goals

- 不恢复独立的“输入 Request ID 找图”面板
- 不为第三方或不可信供应商自动查询结果
- 不修改 Tuzi 后端接口或放宽用户、Token 之间的结果访问边界
- 不自动重新提交同一生图请求，避免重复计费和重复生成

## Impact

- Affected specs:
  - `image-generation`
  - `image-generation-feedback`
- Affected code:
  - `packages/drawnix/src/services/image-generation-recovery-service.ts`
  - `packages/drawnix/src/services/task-queue-service.ts`
  - `packages/drawnix/src/services/media-executor/task-storage-writer.ts`
  - `packages/drawnix/src/services/media-generation/image-generation-service.ts`
  - `packages/drawnix/src/hooks/useTaskExecutor.ts`
  - `packages/drawnix/src/hooks/useTaskStorage.ts`
  - `packages/drawnix/src/services/provider-routing/`
  - 定向测试文件
