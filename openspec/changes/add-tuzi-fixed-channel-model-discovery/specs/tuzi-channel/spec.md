## ADDED Requirements

### Requirement: 固定 Tuzi 渠道

系统 SHALL 提供固定 Tuzi 渠道，接口地址和协议由系统维护，用户 SHALL NOT 修改为其他供应商地址。

#### Scenario: 创建固定渠道

- **WHEN** 用户新增 Tuzi 固定渠道
- **THEN** 系统 SHALL 使用 `https://api.tu-zi.com` 和 OpenAI 协议
- **AND** SHALL 显示固定渠道标识

### Requirement: 多 API Key 的明确选择

系统 SHALL 允许固定 Tuzi 渠道保存多个 API Key，并 SHALL 要求用户明确选择当前使用 Key。

#### Scenario: 发送新请求

- **WHEN** 用户选择一个 Key 后发起新请求
- **THEN** 系统 SHALL 使用该 Key
- **AND** SHALL NOT 自动轮换到其他 Key

#### Scenario: 已提交任务恢复

- **WHEN** 用户切换当前 Key 后恢复已提交任务
- **THEN** 系统 SHALL 使用原任务路由快照查询
- **AND** SHALL NOT 使用新选择的 Key 重发原请求

### Requirement: 按需获取模型列表

系统 SHALL 只有在用户明确点击获取操作后请求 Tuzi pricing，并 SHALL 提供热门前 200 和全部模型两种范围。

#### Scenario: 获取热门模型

- **WHEN** 用户点击获取热门 200
- **THEN** 系统 SHALL 请求 pricing 并按有效 `hot_rank` 升序选择最多 200 个模型
- **AND** SHALL 将结果放入待保存模型列表

#### Scenario: 获取全部模型

- **WHEN** 用户点击获取全部模型
- **THEN** 系统 SHALL 请求 pricing 并显示完整有效模型列表
- **AND** SHALL 在请求前提示可能的列表规模

#### Scenario: 未点击获取

- **WHEN** 用户仅打开渠道编辑器或配置页
- **THEN** 系统 SHALL NOT 请求 pricing
- **AND** SHALL 保留当前模型列表

#### Scenario: 获取失败

- **WHEN** pricing 请求超时、返回非法结构或认证失败
- **THEN** 系统 SHALL 显示可理解的错误
- **AND** SHALL 保留已有模型列表，不清空配置
