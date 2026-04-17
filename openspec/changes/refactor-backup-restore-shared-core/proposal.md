# Change: 抽离主应用与 sw-debug 共用的备份恢复内核

## Why

当前主应用与 `/sw-debug.html` 分别维护两套备份/恢复实现，虽然数据格式相近，但实际行为已经持续漂移：

- 音频素材、任务结果、知识库的支持范围不一致
- ZIP 命名、分片、去重、统计口径不一致
- 一个地方修了 bug，另一个地方很容易继续带着旧逻辑

这类“同一能力双份实现”的问题已经直接造成数据丢失、恢复不完整和排障成本上升。

## What Changes

- 引入共享的备份/恢复核心模块，统一处理 manifest、素材命名、任务筛选、项目结构、知识库序列化、分片流程和导入编排
- 将主应用与 `sw-debug` 改为基于同一核心模块 + 各自环境适配层运行
- 明确环境适配接口，隔离 UI、存储访问、通知、进度回调等平台差异
- 要求主应用与 `sw-debug` 在同一份输入数据上产出兼容的备份结构，并能恢复相同的数据域

## Impact

- Affected code:
  - `packages/drawnix/src/services/backup-restore/*`
  - `packages/drawnix/src/services/kb-import-export-service.ts`
  - `apps/web/public/sw-debug/backup.js`
  - `apps/web/public/sw-debug/backup-restore.js`
  - `apps/web/public/sw-debug/backup-part-manager.js`
  - `apps/web/public/sw-debug/indexeddb.js`
