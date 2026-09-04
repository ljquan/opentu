## ADDED Requirements

### Requirement: 图片生成默认使用自动最优站点

AI 图片生成页 SHALL 默认使用自动最优站点模式，并以当前启用方案中的图片路由作为提交任务的默认供应商站点。

#### Scenario: 打开图片生成页

- **GIVEN** 用户打开 AI 图片生成页
- **WHEN** 页面初始化完成
- **THEN** 站点模式 SHALL 默认为 `自动最优站点`
- **AND** 当前图片模型 SHALL 来自当前启用方案解析出的图片路由

#### Scenario: 自动模式下提交任务

- **GIVEN** 图片生成页处于 `自动最优站点` 模式
- **WHEN** 用户提交图片生成任务
- **THEN** 任务参数 SHALL 包含自动解析出的模型 ID
- **AND** 任务参数 SHALL 包含对应的 `modelRef`

### Requirement: 图片生成支持手动站点选择

AI 图片生成页 SHALL 允许用户切换到手动站点模式，并手动选择供应商站点来源与图片模型作为本次生成路径。

#### Scenario: 用户切换到手动选择

- **GIVEN** 图片生成页处于 `自动最优站点` 模式
- **WHEN** 用户切换到 `手动站点`
- **THEN** 页面 SHALL 展示可选图片模型列表
- **AND** 用户 SHALL 能选择供应商来源与图片模型

#### Scenario: 手动模式下提交任务

- **GIVEN** 用户已在 `手动站点` 模式下选择一个图片模型
- **WHEN** 用户提交图片生成任务
- **THEN** 任务参数 SHALL 使用用户手动选择的模型 ID 和 `modelRef`
- **AND** 本次选择 SHALL 不要求立即改写全局默认图片路由
