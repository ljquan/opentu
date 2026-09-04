## ADDED Requirements

### Requirement: 巡检必须由服务端持久执行

系统 SHALL 将每个生图巡检用例作为服务端持久任务提交，并复用 Tuzi 当前分组、模型路由和图片生成链路。

#### Scenario: 巡检任务进入当前任务栏

- **GIVEN** 巡检矩阵包含一个分组、模型、比例和分辨率组合
- **WHEN** 系统开始执行该用例
- **THEN** 系统 SHALL 通过服务端持久后台任务创建真实图片任务
- **AND** 用户 SHALL 能在当前 OpenTu 报表看到该任务及其真实结果
- **AND** 关闭或刷新 OpenTu SHALL NOT 中断该任务

### Requirement: 巡检尺寸必须严格校验

系统 SHALL 按分组与模型规则校验实际图片比例与分辨率。仅 `default` 分组的 `gpt-image-2`、`gpt-image-2-vip` SHALL 忽略像素档位并按宽高最大公约数精确约分后的比例判断；其他分组的 GPT Image 2 SHALL 使用精确尺寸，Gemini SHALL 保持原比例与档位规则。

#### Scenario: default 分组 Image 2 精确约分比例通过

- **GIVEN** `default` 分组的 `gpt-image-2` 或 `gpt-image-2-vip` 请求比例为 `3x4`
- **WHEN** 实际图片尺寸为 `1086×1448`
- **THEN** 系统 SHALL 将宽高精确约分为 `3:4`
- **AND** SHALL 忽略该用例请求的 1K、2K 或 4K 像素档位并判定通过

#### Scenario: default 分组 Image 2 近似比例失败

- **GIVEN** `default` 分组的 Image 2 用例请求比例为 `3x2`
- **WHEN** 实际图片尺寸为 `1535×1024`
- **THEN** 系统 SHALL 因宽高不能精确约分为 `3:2` 而判定失败

#### Scenario: GPT Image 2 精确尺寸不匹配

- **GIVEN** GPT Image 2 用例声明期望尺寸为 1024×1024
- **WHEN** 实际图片尺寸不是 1024×1024
- **THEN** 系统 SHALL 将该用例标记为失败
- **AND** SHALL 同时展示期望尺寸与实际尺寸

#### Scenario: 4K 请求返回较低档位

- **GIVEN** 一个 Gemini 巡检用例请求 4K
- **WHEN** 实际图片长边仅达到 2K 档位
- **THEN** 系统 SHALL 将该用例标记为失败
- **AND** SHALL NOT 因比例正确而判定通过

#### Scenario: 尺寸来源互相冲突

- **GIVEN** 实际图片自然尺寸、任务元数据或 URL 尺寸编码中至少两个来源不一致
- **WHEN** 系统校验巡检结果
- **THEN** 系统 SHALL 优先使用实际图片自然尺寸
- **AND** 系统 SHALL 将尺寸来源冲突标记为失败并展示各来源尺寸

### Requirement: 巡检运行必须隔离单点异常

系统 SHALL 将单个巡检用例、报表渲染、本地存储和任务状态读取的异常限制在巡检功能内，SHALL NOT 导致 OpenTu 页面崩溃或整场巡检无记录中断。

#### Scenario: 单个用例抛出未预期异常

- **GIVEN** 一场巡检包含多个用例
- **WHEN** 其中一个用例在创建任务、等待状态或解析结果时抛出未预期异常
- **THEN** 系统 SHALL 将该用例记录为失败
- **AND** SHALL 继续执行后续用例
- **AND** SHALL NOT 导致 OpenTu 闪退

#### Scenario: 网络短时断开

- **GIVEN** 巡检尚有未执行用例
- **WHEN** 浏览器检测到离线
- **THEN** 系统 SHALL 暂停创建新任务并等待网络恢复
- **AND** 用户主动停止时 SHALL 释放等待监听器

#### Scenario: 页面中断后重新打开

- **GIVEN** 持久化报表中存在运行中会话
- **WHEN** OpenTu 重新加载巡检状态
- **THEN** 系统 SHALL 从服务端恢复已有任务 ID、进度和结果
- **AND** 服务端仍在运行的用例 SHALL 继续显示为运行中

#### Scenario: 服务端进程重启

- **GIVEN** 持久化运行中仍有未完成用例
- **WHEN** 服务端重启并恢复后台巡检
- **THEN** 系统 SHALL 继续未完成运行或明确记录无法恢复的单个用例
- **AND** SHALL NOT 丢失已完成结果或重复整场运行

#### Scenario: 单个真实任务永久排队

- **WHEN** 已提交的真实生图任务超过配置的单用例最长等待时间仍未进入终态
- **THEN** 系统 SHALL 将当前巡检用例标记为失败并继续后续用例
- **AND** 超时计时 SHALL 使用持久化的首次开始时间，服务重启不得重置
- **AND** 系统 SHALL 保留原任务 ID且不得重新提交同一真实任务

#### Scenario: 停止正在轮询的运行

- **WHEN** 用户停止包含正在轮询用例的巡检运行
- **THEN** 系统 SHALL 停止该用例的租约续期并将其标记为已停止
- **AND** 系统 SHALL 不再等待该真实任务的后续状态

#### Scenario: 报表请求形成半开连接

- **WHEN** 报表同步、启动、停止或导出请求超过客户端截止时间仍未返回
- **THEN** 系统 SHALL 取消该请求并显示可恢复错误
- **AND** 轮询 SHALL 按退避策略继续调度，不得永久停摆

#### Scenario: 关闭正在请求的报表

- **WHEN** 用户在启动、停止、导出或轮询请求完成前关闭巡检报表
- **THEN** 系统 SHALL 取消尚未完成的客户端请求和定时器
- **AND** SHALL NOT 在组件卸载后继续创建轮询或更新界面状态

#### Scenario: 提交成功后服务端进程立即退出

- **WHEN** 真实任务已提交并持久化，但巡检用例尚未写回任务 ID 时服务端退出
- **THEN** 系统 SHALL 在恢复后按稳定内部请求 ID 找回原任务
- **AND** SHALL NOT 再次提交同一真实生图任务

#### Scenario: 多 Worker 并发完成用例

- **WHEN** 多个 Worker 同时完成同一运行下的不同用例
- **THEN** 系统 SHALL 串行聚合运行状态且不得将终态回退为运行中
- **AND** 周期对账 SHALL 修复最后一次汇总失败后残留的活动运行

#### Scenario: 真实任务提交超过初始租约

- **WHEN** 内部生图路由的提交过程超过用例初始租约时间
- **THEN** 系统 SHALL 在提交期间持续续租
- **AND** 其他 Worker SHALL NOT 重复领取并提交该用例

#### Scenario: 任务对账存储短时不可用

- **WHEN** 系统按稳定内部请求 ID 查找既有任务时数据库暂时不可用
- **THEN** 系统 SHALL 释放当前租约并等待恢复
- **AND** 系统 SHALL NOT 将查询失败视为任务不存在并重新提交

#### Scenario: 已持久化请求经历多次服务重启

- **GIVEN** 巡检用例已经持久化稳定请求 ID 或真实任务 ID
- **WHEN** 服务端在任务终态前多次重启
- **THEN** 系统 SHALL 持续恢复该用例直至任务终态或持久超时
- **AND** 通用崩溃重试次数 SHALL NOT 提前终止可安全对账的用例
