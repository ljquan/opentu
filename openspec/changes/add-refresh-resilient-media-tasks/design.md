## Context

异步媒体生成包含三个需要持久化的边界：本地任务创建、供应商接受请求并返回远程任务 ID、供应商任务完成。当前实现主要依赖 `remoteId` 恢复轮询，但部分回调使用 fire-and-forget 写入，刷新可能发生在远程 ID 返回和 IndexedDB 落盘之间。

另一个风险窗口是请求已经到达供应商、但页面在收到提交响应前刷新。若客户端直接重新提交，可能创建两个远程任务并重复计费。

## Goals / Non-Goals

### Goals

- 刷新后继续追踪已经提交的异步媒体任务
- 恢复任务完成后继续缓存结果并按原配置自动插入画布
- 保证同一任务不会因为恢复流程重复轮询、重复提交或重复插入
- 在无法证明原请求未提交时避免自动重复计费

### Non-Goals

- 不承诺在供应商既不返回远程 ID、也不支持请求 ID 查询时无条件找回任务
- 不将同步、不可恢复的第三方接口伪装为可恢复接口
- 不改变用户主动取消任务的语义

## Decisions

### 1. 持久化恢复凭据

为异步任务保存：

- `clientRequestId`：提交前生成的稳定请求标识
- `remoteId`：供应商返回的任务标识
- `executionPhase`：`submitting`、`polling`、`downloading`
- `invocationRoute`：原供应商、模型和协议路由快照

写入顺序为：先持久化 `clientRequestId + submitting`，再发送请求；收到远程 ID 后原子写入 `remoteId + polling + invocationRoute`，写入完成后才开始轮询。

### 2. 分阶段恢复

| 持久化状态 | 恢复行为 |
|---|---|
| `remoteId` 存在 | 使用原路由恢复轮询，不重新提交 |
| 仅有 `clientRequestId`，供应商支持查询 | 通过请求日志找回提交响应或最终结果 |
| 仅有 `clientRequestId`，供应商不支持查询 | 标记为需要用户确认重试，不自动重新提交 |
| 已有 `result` 但未插入 | 继续缓存校验与自动插入 |
| 已有 `insertedToCanvas` | 不重复插入 |

### 3. 单一恢复执行者

同一任务只能由一个恢复执行者占用。内存中的恢复集合负责当前页面去重，持久化状态负责跨刷新去重。视频恢复统一通过媒体执行器完成，避免 `useTaskExecutor` 和媒体执行器同时轮询。

### 4. 完成与画布插入解耦

任务恢复完成后先持久化标准 `TaskResult`，再发送完成事件。现有 `useAutoInsertToCanvas` 扫描已完成且 `autoInsertToCanvas=true`、`insertedToCanvas=false` 的任务并插入画布。插入成功后持久化 `insertedToCanvas=true`。

刷新后如果原画布仍存在，任务使用持久化的画布/锚点元数据恢复原位置；元数据失效时安全降级到当前画布的默认插入位置。

## Risks / Trade-offs

- 供应商请求日志查询能力并不统一：通过能力标记启用，无法查询时不自动重提。
- IndexedDB 写入失败会阻止进入轮询阶段：任务保留为可诊断状态，并提示本地存储异常。
- 多标签页可能同时恢复：复用现有任务状态同步与执行中集合，后续可与 Service Worker 任务所有权机制合并。

## Migration Plan

1. 新字段全部可选，旧任务继续按 `remoteId` 逻辑恢复。
2. 新创建任务开始写入 `clientRequestId`。
3. 对历史 `submitting` 且无任何恢复凭据的任务保持现有失败提示。
4. 通过刷新集成测试验证提交、轮询、下载和插入阶段。
