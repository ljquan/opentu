## ADDED Requirements

### Requirement: 工具箱必须支持插件式工具注册
系统 SHALL 通过统一注册中心加载内置工具，并允许每个工具以独立目录形式提供 manifest 与运行时入口。

#### Scenario: 加载内置工具
- **WHEN** 应用初始化工具箱
- **THEN** 系统从注册中心返回可用工具列表
- **AND** 每个工具定义都来自其独立目录导出的 manifest

### Requirement: iframe 与内部工具必须共享统一运行时协议
系统 SHALL 允许 `iframe` 工具和内部 React 工具通过同一工具定义模型被打开、最小化和嵌入画布。

#### Scenario: 打开内部工具
- **WHEN** 用户从工具箱打开内部工具
- **THEN** 系统根据注册中心解析对应内部组件

#### Scenario: 打开 iframe 工具
- **WHEN** 用户从工具箱打开 URL 工具
- **THEN** 系统根据工具定义渲染 iframe

### Requirement: 自定义 URL 工具必须兼容插件运行时
系统 SHALL 保留自定义 URL 工具能力，并将其作为 iframe 型工具纳入统一工具运行时。

#### Scenario: 添加自定义 URL 工具
- **WHEN** 用户保存自定义工具
- **THEN** 工具箱可像其他 iframe 工具一样打开、最小化和嵌入画布
