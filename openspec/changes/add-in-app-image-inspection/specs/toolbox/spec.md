## ADDED Requirements

### Requirement: 当前 OpenTu 内的生图巡检模式

系统 SHALL 在 OpenTu 左侧工具栏提供独立生图巡检图标，并 SHALL 在当前 OpenTu 页面内完成配置、运行、监控和报表查看，不启动独立浏览器或第二套 OpenTu。

#### Scenario: 用户从当前 OpenTu 启动巡检

- **GIVEN** 用户已在 OpenTu 中配置多个供应商分组和生图模型
- **WHEN** 用户点击左侧工具栏的生图巡检图标
- **THEN** 系统 SHALL 请求 Tuzi 服务端创建或返回当前巡检运行
- **AND** SHALL 直接最大化巡检报表并自动启动一次真实巡检
- **AND** SHALL 在当前工具窗口展示进度和实时结果
- **AND** SHALL NOT 启动新的 Chrome 实例或浏览器用户目录

#### Scenario: 遍历分组时仅测试指定模型

- **GIVEN** OpenTu 存在多个启用的生图分组，且分组内同时存在白名单内外的模型
- **WHEN** 系统构建生图巡检矩阵
- **THEN** 系统 SHALL 在每个分组中仅纳入指定的模型 ID
- **AND** 系统 SHALL 跳过其他所有模型
- **AND** 系统 SHALL 在运行前同步所有可发现分组的模型目录
- **AND** 任一应同步分组失败时系统 SHALL NOT 带缺口启动巡检
- **AND** 已纳入模型的尺寸、比例与报表规则 SHALL 保持不变

#### Scenario: 巡检运行中重复点击图标

- **GIVEN** 当前已有一场生图巡检正在运行
- **WHEN** 用户再次点击生图巡检图标
- **THEN** 系统 SHALL 打开并聚焦当前巡检报表
- **AND** SHALL NOT 重复创建一场巡检

### Requirement: 巡检报表

系统 SHALL 为每个实际完成的巡检用例展示分组、模型、任务 ID、耗时、请求比例/档位、实际尺寸、状态、图片预览、真实图片 URL 和尺寸计算公式。

#### Scenario: 查看实际生成结果

- **GIVEN** 一个巡检图片任务已完成并返回图片 URL
- **WHEN** 用户查看巡检报表
- **THEN** 报表 SHALL 显示真实图片和可复制/打开的 URL
- **AND** SHALL 在 URL 下方显示尺寸计算公式
- **AND** SHALL 根据实际尺寸严格标记通过或失败

#### Scenario: 巡检尚未产生结果

- **GIVEN** 巡检已启动但尚无任务完成
- **WHEN** 用户查看巡检报表
- **THEN** 报表 SHALL 只显示等待实际生成结果的状态
- **AND** SHALL NOT 展示 dry-run 计划明细列表

### Requirement: 服务端每日巡检

系统 SHALL 支持由 Tuzi 服务端按北京时间每天 07:00 于中国法定工作日自动启动巡检。OpenTu 页面关闭或休眠 SHALL NOT 影响执行；法定节假日和普通周末 SHALL 跳过，调休补班日 SHALL 照常执行；自动巡检 SHALL 使用显式配置的固定 Token 数据库 ID，未配置时 SHALL 跳过调度。

#### Scenario: OpenTu 在计划时间处于打开状态

- **GIVEN** 每日巡检已启用且服务端正常运行
- **WHEN** 本地时间到达 07:00、当天是中国法定工作日且尚未运行
- **THEN** 服务端 SHALL 幂等启动一次巡检

#### Scenario: 页面关闭时到达计划时间

- **GIVEN** 工作日 07:00 时 OpenTu 页面未打开
- **WHEN** 服务端在 07:00 触发调度
- **THEN** 系统 SHALL 正常启动后台巡检
- **AND** 用户当天稍后打开 OpenTu SHALL 能查看该运行及已有结果

#### Scenario: 多实例同时触发调度

- **GIVEN** 多个服务端实例同时检测到当天巡检尚未运行
- **WHEN** 实例在 07:00 同时触发调度
- **THEN** 系统 SHALL 通过持久幂等约束只创建一场运行
- **AND** SHALL NOT 重复创建巡检任务

### Requirement: 报表与后台任务解耦

系统 SHALL 允许 OpenTu 在不持有执行权的情况下分页查看、轮询和停止服务端巡检。

#### Scenario: 报表网络短时断开

- **GIVEN** 服务端巡检正在运行
- **WHEN** OpenTu 报表网络短时断开
- **THEN** 网络断开 SHALL 仅影响报表刷新
- **AND** 后台巡检 SHALL 继续运行
- **AND** 网络恢复后报表 SHALL 自动同步最新状态

#### Scenario: 法定节假日跳过自动巡检

- **GIVEN** 当天是中国法定节假日或普通周末
- **WHEN** 本地时间到达 07:00
- **THEN** 系统 SHALL NOT 自动启动巡检
- **AND** 调休补班日 SHALL 仍按工作日运行
