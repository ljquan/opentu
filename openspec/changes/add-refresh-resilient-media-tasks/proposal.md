# Change: 页面刷新后恢复 AI 媒体生成任务

## Why

当前异步视频、音频和部分图片任务虽然会保存远程任务 ID，但任务提交、远程 ID 落盘、刷新恢复轮询和结果自动插入之间仍存在竞态。用户在生成过程中刷新页面时，任务可能被标记为中断、丢失远程任务 ID，或完成后只停留在任务历史而没有回到原画布。

## What Changes

- 在异步媒体请求提交前持久化稳定的客户端请求 ID、执行阶段和供应商路由快照
- 远程任务 ID 返回后，必须等待任务恢复信息成功写入 IndexedDB，再开始后续轮询
- 页面刷新后自动恢复拥有远程任务 ID 的视频、音频和异步图片轮询
- 对“请求可能已提交、但远程任务 ID 尚未落盘”的任务，优先通过供应商请求日志或幂等查询找回任务，不盲目重复提交
- 恢复完成的任务继续执行本地媒体缓存和现有自动插入画布流程，并防止重复插入
- 对供应商不支持请求找回的场景，明确显示“无法安全自动恢复”，由用户选择重试，避免重复扣费

## Impact

- Affected specs:
  - `async-media-task-recovery`（新增）
- Affected code:
  - `packages/drawnix/src/types/shared/core.types.ts`
  - `packages/drawnix/src/services/task-queue-service.ts`
  - `packages/drawnix/src/services/media-executor/task-storage-writer.ts`
  - `packages/drawnix/src/services/media-executor/fallback-executor.ts`
  - `packages/drawnix/src/services/media-executor/fallback-adapter-routes.ts`
  - `packages/drawnix/src/services/media-api/video-api.ts`
  - `packages/drawnix/src/services/video-api-service.ts`
  - `packages/drawnix/src/hooks/useTaskStorage.ts`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - related task recovery tests
