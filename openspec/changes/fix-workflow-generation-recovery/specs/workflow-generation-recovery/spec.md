## ADDED Requirements

### Requirement: Durable generation intent

系统 SHALL 在工作台、画布和文档批量生成的付费请求之前保存任务身份、输入快照、原路由和目标归属；持久化失败 SHALL 阻止提交。

#### Scenario: Storage fails before submission
- **WHEN** 任务或提交资格无法持久保存
- **THEN** 系统 SHALL 展示保存失败且不发出生成 POST

#### Scenario: Concurrent dispatch
- **WHEN** 两个标签页尝试启动同一任务
- **THEN** 系统 SHALL 仅允许一个执行者取得该尝试的提交资格

### Requirement: Query-only recovery

系统 SHALL 在刷新后按原任务身份恢复受支持的查询，SHALL NOT 因查询失败、刷新或受理不明自动重新提交生成请求。

#### Scenario: Reload after provider acceptance
- **WHEN** 持久记录具有远端任务 ID 或受支持的图片 Request ID
- **THEN** 系统 SHALL 查询原任务并将结果保存回原记录

#### Scenario: Submission outcome unknown
- **WHEN** 已进入提交窗口但没有可用查询契约或远端 ID
- **THEN** 系统 SHALL 保留输入和结果待确认状态，不重发 POST

#### Scenario: Unsubmitted batch work
- **WHEN** 刷新时仍有尚未提交的计划
- **THEN** 系统 SHALL 保留计划并等待用户继续

### Requirement: Original route and scope

系统 SHALL 等待账号和配置就绪，使用原作用域、原路由与原凭据身份恢复任务，不使用当前激活 Key 猜测查询。

#### Scenario: Credentials hydrate after the page
- **WHEN** 页面恢复早于原配置恢复
- **THEN** 系统 SHALL 保留任务并在原配置就绪后尝试查询

#### Scenario: Original key removed or replaced
- **WHEN** 原凭据身份不可用
- **THEN** 系统 SHALL 显示等待原配置，不删除任务、不改用其他 Key

#### Scenario: Account changes during recovery
- **WHEN** 当前账号发生变化
- **THEN** 系统 SHALL 停止旧作用域查询和结果写回

### Requirement: Incremental and idempotent results

系统 SHALL 独立保存每个输出并幂等回填历史和画布，媒体缓存失败 SHALL NOT 丢弃已获得的结果 URL。

#### Scenario: Reload after partial success
- **WHEN** 多输出生成中部分结果完成后刷新
- **THEN** 已保存结果 SHALL 保留，未完成项 SHALL 显示各自恢复状态

#### Scenario: Target deleted or attempt replaced
- **WHEN** 旧任务结果在目标删除或新尝试开始后到达
- **THEN** 系统 SHALL 不复活已删除目标且不覆盖新尝试

#### Scenario: Concurrent completion
- **WHEN** 多个输出同时完成或同一完成事件重复到达
- **THEN** 系统 SHALL 不遗漏兄弟结果且不重复插入同一输出

### Requirement: Honest interruption states

系统 SHALL 区分供应商确认失败、查询中断、配置不可用和无查询契约的中断，不以永久生成中或自动重试掩盖未知状态。

#### Scenario: Query transport failure
- **WHEN** 查询网络失败或到达现有查询期限
- **THEN** 系统 SHALL 保留任务身份及原因，且不宣称上游未受理

#### Scenario: Synchronous or scripted request interrupted
- **WHEN** 无恢复契约的同步文本、音频、图片或脚本执行被刷新中断
- **THEN** 系统 SHALL 保留已保存输入和结果，展示结果待确认；重新生成 SHALL 创建明确的新尝试
