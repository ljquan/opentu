## ADDED Requirements

### Requirement: Shared Backup Restore Core
系统 SHALL 提供一套由主应用与 `sw-debug` 共用的备份恢复核心逻辑，用于统一备份格式、导出筛选、导入恢复顺序与去重规则。

#### Scenario: Main App and sw-debug export the same data semantics
- **GIVEN** 主应用与 `sw-debug` 访问的是同一份项目、素材、任务、提示词与知识库数据
- **WHEN** 用户分别从主应用与 `sw-debug` 执行备份
- **THEN** 两边都必须产出兼容的 manifest 与 ZIP 目录结构
- **AND** 音频、任务结果、知识库、项目目录和素材元数据的导出语义必须一致

#### Scenario: Shared core fixes apply to both environments
- **GIVEN** 共享备份恢复核心修复了素材命名冲突或音频任务筛选问题
- **WHEN** 主应用或 `sw-debug` 执行备份恢复
- **THEN** 两边都必须同时继承同一修复行为
- **AND** 不允许再出现仅一端生效、另一端仍保留旧逻辑的情况

### Requirement: Environment Adapter Boundary
系统 SHALL 将备份恢复中的环境相关能力限制在适配层，以隔离核心逻辑与平台依赖。

#### Scenario: Core stays independent from app-specific services
- **GIVEN** 共享备份恢复核心需要读取或写入数据
- **WHEN** 核心执行导出或导入
- **THEN** 核心只能通过适配接口访问项目、素材、任务、提示词、知识库与缓存能力
- **AND** 核心不得直接依赖主应用 UI、React 状态或 `sw-debug` DOM 节点

### Requirement: Knowledge Base Parity
系统 SHALL 保证主应用与 `sw-debug` 在共享内核接入后，对知识库备份与恢复采用同一数据结构与导入顺序。

#### Scenario: Knowledge base backup is available in both environments
- **GIVEN** 知识库中存在目录、笔记、标签和图片
- **WHEN** 用户从主应用或 `sw-debug` 执行备份恢复
- **THEN** 两边都必须使用同一份知识库序列化结构
- **AND** 导入后笔记数量、目录映射和标签关联必须保持一致
