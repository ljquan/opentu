## ADDED Requirements

### Requirement: 图片生成站点模式必须保留执行路径

Provider routing SHALL expose enough route information for AI image generation to distinguish automatic preset site routing from manual per-session site routing.

#### Scenario: 自动最优站点解析

- **GIVEN** 当前启用方案配置了图片模型路由
- **WHEN** AI 图片生成页请求自动最优站点
- **THEN** provider routing SHALL return the resolved provider profile, model ID, base URL, and credential availability metadata

#### Scenario: 手动站点覆盖

- **GIVEN** 用户为图片生成手动选择了供应商站点来源与模型
- **WHEN** 系统创建图片生成任务
- **THEN** provider routing SHALL accept the manual `modelRef` as the requested route
- **AND** SHALL preserve that route for async execution and retry
