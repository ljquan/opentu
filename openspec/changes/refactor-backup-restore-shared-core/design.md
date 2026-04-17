## Context

当前备份恢复逻辑分散在主应用 TypeScript service 与 `sw-debug` 原生 JS 脚本中。两边都直接持有“读取什么、如何组装 ZIP、如何恢复”的完整流程，导致：

- 逻辑重复且长期漂移
- 修复音频、知识库或 ZIP 冲突时必须双改
- `sw-debug` 很难作为主应用的可靠验证入口

目标不是简单复制粘贴，而是把“数据语义”抽成一套共享内核，把“运行环境差异”留在适配层。

## Goals / Non-Goals

- Goals:
  - 一处定义备份恢复数据语义
  - 主应用与 `sw-debug` 共用同一导出/导入核心流程
  - 降低音频、知识库、任务结果等数据域继续漂移的风险
- Non-Goals:
  - 不重做备份 UI
  - 不改变备份格式版本，除非共享内核本身需要最小兼容补丁
  - 不把 `sw-debug` 整体迁移为 React/TypeScript 页面

## Decisions

- Decision: 采用“共享核心 + 环境适配器”模式
  - 核心层只处理纯数据流程与必要状态，不直接依赖 DOM、React、localforage 实例、主应用 service 单例
  - 适配层提供读取/写入项目、提示词、素材、任务、知识库、缓存媒体、进度通知等能力

- Decision: 共享核心按职责拆为小模块
  - `shared utils`: manifest、扩展名、命名、防冲突、任务媒体判定
  - `shared export`: 收集数据、排序、写入 ZIP、分片调度
  - `shared import`: 读取 ZIP、解析 meta/binary、调用适配层落库

- Decision: 保留环境差异，但要求结果同语义
  - UI 提示、按钮交互、通知样式仍各自保留
  - 但 ZIP 结构、知识库支持、音频/任务导出判定、导入恢复顺序必须走同一实现

## Risks / Trade-offs

- 风险: 共享内核抽取时容易把现有 service 隐式依赖漏掉
  - Mitigation: 先定义最小适配接口，再逐步替换旧逻辑

- 风险: `sw-debug` 为浏览器脚本环境，模块边界和主应用构建链不同
  - Mitigation: 优先抽纯 TS/JS 无框架依赖模块，必要时生成兼容的共享文件或通过现有构建别名接入

## Migration Plan

1. 先抽共享工具与数据收集/恢复编排接口
2. 主应用先切到共享内核，保持测试通过
3. `sw-debug` 再切到共享内核，删除重复逻辑
4. 对比两边导出结构与导入结果，确保一致

## Open Questions

- 共享模块放在 `packages/drawnix/src/services/backup-restore/shared/` 还是更上层可复用目录
- `sw-debug` 是否直接消费编译产物，还是保留一份无构建依赖的 ES module 入口
