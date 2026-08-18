## ADDED Requirements

### Requirement: PPT Explainer Agent SHALL Accept One Presentation Source

系统 SHALL 允许用户从主题生成、当前画布 PPT 或上传 PPTX 中选择且只选择一个演示来源。

#### Scenario: Generate a deck from a topic

- **GIVEN** 用户选择主题来源并提供非空主题
- **WHEN** 用户提交 PPT 讲解视频任务
- **THEN** 系统 SHALL 复用 PPT 大纲和 Frame 创建流程生成演示结构
- **AND** SHALL 将该演示结构绑定到本次讲解任务
- **AND** 用户明确要求总页数时，系统 SHALL 将其作为包含封面和结尾的精确页数生成

#### Scenario: Materialize the complete visible deck before narration

- **GIVEN** 主题 PPT 或当前 PPT 的一个或多个页面需要生成页面图
- **WHEN** 页面图生成完成
- **THEN** 系统 SHALL 先将页面图写回对应的用户可见 PPT Frame 并更新页面版本
- **AND** SHALL 从这些相同 Frame 冻结讲解任务快照
- **AND** SHALL NOT 使用未写回画布的隐藏页面图直接生成讲稿、音轨或视频

#### Scenario: Add a new deck beside an existing canvas PPT

- **GIVEN** 当前画板已经存在 PPT 页面且用户选择主题来源
- **WHEN** 用户创建新的 PPT 讲解任务
- **THEN** 系统 SHALL 保留现有 PPT 页面及其内容
- **AND** SHALL 在不重叠的位置创建并仅绑定本次任务的新 PPT 页面

#### Scenario: Use the current canvas PPT

- **GIVEN** 当前画板存在按页排序的 PPT Frames
- **WHEN** 用户选择当前 PPT 来源并提交
- **THEN** 系统 SHALL 按 `pageIndex` 读取页面、备注和转场
- **AND** SHALL 为本次任务冻结不可变页面快照

#### Scenario: Use an uploaded PPTX

- **GIVEN** 用户选择一个可解析的 PPTX
- **WHEN** 用户提交任务
- **THEN** 系统 SHALL 保留原始页序和页面比例
- **AND** SHALL 根据供应商能力直传 PPTX 或提交有序页面快照

#### Scenario: Reject a missing or ambiguous source

- **WHEN** 来源为空、选择多个来源、当前画板没有 PPT 页面或 PPTX 没有可用页面
- **THEN** 系统 SHALL 在供应商 submit 前停止
- **AND** SHALL 显示可操作的来源错误且不产生部分远端任务

### Requirement: PPT Explainer Workflow SHALL Require An Outline Decision

主题来源的工作流 SHALL 在继续生成前记录明确的大纲审核决定。

#### Scenario: Review and confirm the outline

- **GIVEN** 用户选择确认大纲
- **WHEN** PPT 大纲生成完成
- **THEN** 任务 SHALL 进入可恢复的 `review_pending` 状态
- **AND** 只有用户确认后才能冻结页面并提交成片任务

#### Scenario: Skip review after acknowledging the warning

- **GIVEN** 用户选择跳过大纲确认
- **WHEN** 系统展示将直接生成页面和讲解视频的警告
- **THEN** 用户 SHALL 明确确认该警告
- **AND** 系统 SHALL 保存确认时间后继续执行

#### Scenario: Agent parameters cannot forge review confirmation

- **GIVEN** Agent、Workflow 或 Service Worker 直接传入跳过审核参数
- **WHEN** 当前页面没有为同一个输入对象授予一次性确认
- **THEN** 系统 SHALL 拒绝创建任务
- **AND** JSON 布尔字段 SHALL NOT 被当作用户确认凭证

#### Scenario: Decline the skip warning

- **GIVEN** 跳过确认警告正在显示
- **WHEN** 用户取消或关闭警告
- **THEN** 系统 SHALL NOT 生成页面图或提交成片任务
- **AND** 用户输入和配置 SHALL 保持可编辑

### Requirement: PPT Explainer SHALL Support Four Presenter Modes

系统 SHALL 支持单声线、双声线对谈、单数字人和双数字人四种模式，并使用结构化 speaker 配置。

#### Scenario: Generate single-voice narration

- **WHEN** 用户选择单声线并配置一个可用声音
- **THEN** 每条讲稿 SHALL 归属该 speaker
- **AND** 最终视频 SHALL 包含按页同步的单人讲解音轨

#### Scenario: Generate two-voice dialogue

- **WHEN** 用户选择双声线并配置两个不同 speaker
- **THEN** 讲稿 SHALL 生成仅引用这两个 speaker 的有序 turns
- **AND** 最终视频 SHALL 按 turns 顺序播放对应声线

#### Scenario: Generate one-avatar presentation

- **WHEN** 用户选择单数字人并配置声音和数字人来源
- **THEN** 供应商请求 SHALL 包含该 speaker 的 voice 与 avatar 身份
- **AND** 最终视频 SHALL 包含与讲稿同步的单数字人画面

#### Scenario: Generate two-avatar conversation

- **WHEN** 用户选择双数字人并为两个 speaker 配置声音和数字人来源
- **THEN** 供应商请求 SHALL 保留每个 turn 的 speaker 身份
- **AND** 最终视频 SHALL 支持两个数字人出镜和交替对谈

#### Scenario: Reject incomplete presenter configuration

- **WHEN** 双人模式缺少第二 speaker、声音不可用、数字人模式缺少 avatar 或 turn 引用未知 speaker
- **THEN** 系统 SHALL 在远端 submit 前停止
- **AND** SHALL 指明需要修正的 speaker 配置

### Requirement: PPT Explainer SHALL Build A Slide-Aligned Narration Plan

系统 SHALL 按页面顺序生成结构化讲稿，并优先复用已有演讲备注。

#### Scenario: Prefer existing slide notes

- **GIVEN** 页面包含非空 `notes`
- **WHEN** 系统构建讲稿计划
- **THEN** 系统 SHALL 将 notes 作为该页讲稿主要输入
- **AND** SHALL NOT 无提示地丢弃用户已有备注

#### Scenario: Generate missing narration

- **GIVEN** 一个或多个页面缺少可讲解备注
- **WHEN** 系统构建讲稿计划
- **THEN** 文本模型 SHALL 根据页面内容补齐对应页面 turns
- **AND** 结果 SHALL 通过结构化 JSON schema 校验

#### Scenario: Snapshot accepted deck state

- **GIVEN** 用户已通过审核门
- **WHEN** 任务开始生成讲稿或提交供应商
- **THEN** 系统 SHALL 固化页序、快照、备注、转场和 speaker 配置
- **AND** 固化快照 SHALL 与用户可见 PPT 页面使用相同页面图和版本
- **AND** 后续画布编辑 SHALL NOT 改变已接受任务

### Requirement: PPT Explainer SHALL Use Existing Audible Video Models Without Voice Cloning

系统 SHALL 在现有模型模式中直接使用用户选择的有声视频模型，不展示或伪造 TTS、voice ID、参考音频及声音克隆配置。

#### Scenario: Configure speakers without voice samples

- **WHEN** 用户选择单人或双人讲解模式
- **THEN** 系统 SHALL 只要求讲解者名称
- **AND** 双人差异 SHALL 通过角色顺序和不同声线的提示词表达
- **AND** SHALL 提示实际音色和朗读一致性由视频模型决定

### Requirement: PPT Explainer Provider Binding SHALL Expose A Complete Async Lifecycle

PPT 讲解任务 SHALL 仅通过声明最终成片能力的 provider binding 执行 submit、poll 和可选 cancel。

#### Scenario: Submit a supported job

- **GIVEN** binding 支持所选来源、presenter mode 和最终成片
- **WHEN** 系统完成预检并持久化幂等键
- **THEN** 系统 SHALL 使用原 provider route 提交版本化 manifest 和演示输入
- **AND** SHALL 立即保存返回的 remoteId

#### Scenario: Poll to final video

- **GIVEN** 任务已保存 remoteId
- **WHEN** 系统轮询供应商状态
- **THEN** 系统 SHALL 标准化进度和终态
- **AND** 只有 completed 且包含可用最终视频 URL 时才完成根任务

#### Scenario: Cancel through a supported endpoint

- **GIVEN** binding 声明远端 cancel
- **WHEN** 用户取消任务
- **THEN** 系统 SHALL 先持久化本地取消状态
- **AND** SHALL 使用原 route 对 remoteId 发起幂等 cancel
- **AND** 同时发生的 cancel SHALL 合并为一个远端请求，成功后去重，失败时保留脱敏错误并允许重试

#### Scenario: Cancel without a remote endpoint

- **GIVEN** binding 没有远端 cancel
- **WHEN** 用户取消任务
- **THEN** 系统 SHALL 停止本地轮询和后续阶段并忽略迟到结果
- **AND** SHALL 提示远端任务可能继续执行和计费

#### Scenario: Required provider capability is absent

- **WHEN** 任一必需模型、binding、API key、presenter 能力或最终成片能力缺失
- **THEN** 系统 SHALL 在任何远端 submit 和计费副作用前失败
- **AND** SHALL NOT 回退到浏览器实时录制合成器

### Requirement: PPT Explainer SHALL Support Local Composition With Existing Models

当没有专用 PPT 最终成片 binding 时，系统 SHALL 允许用户显式选择现有模型模式，并复用已有文本、图片和有声视频模型完成任务。

#### Scenario: Generate a narrated slide video locally

- **GIVEN** 用户选择的视频模型支持生成有声视频
- **WHEN** 用户选择单人或双人讲解
- **THEN** 系统 SHALL 按页面把快照和 speaker turns 提交为有声视频片段
- **AND** 系统 SHALL 只使用片段音轨，不得把模型重绘画面作为最终 PPT 视觉
- **AND** 系统 SHALL 按页序固定绘制原 PPT 快照并合成音轨、字幕和转场
- **AND** 最终用户可见视频的每一页 SHALL 与已接受的 PPT 页面视觉一致

#### Scenario: Use an ordinary video model for avatar segments

- **GIVEN** 用户选择数字人模式且普通视频模型支持所需参考输入
- **WHEN** 本地编排器生成数字人片段
- **THEN** 视频模型 SHALL 只负责片段生成
- **AND** SHALL NOT 被声明或持久化为完整 `ppt-explainer` 供应商

#### Scenario: Selected model does not produce usable speech

- **WHEN** 所选普通视频模型不支持音频输出或生成结果未按讲稿朗读
- **THEN** 系统 SHALL 停止最终合成并保留供应商真实结果或错误
- **AND** SHALL 提示改用明确支持有声视频的模型，不得伪造音频模型

#### Scenario: Cache generated narration media before composition

- **GIVEN** 视频模型返回远程有声片段 URL
- **WHEN** 系统准备本地合成
- **THEN** 系统 SHALL 将片段缓存为同源 internal 媒体并逐页加载
- **AND** 缓存或媒体解码失败 SHALL 明确失败，不得静默输出无声或跨域受限视频
- **AND** 系统 SHALL NOT 同时把全部源片段读入 JS 内存

#### Scenario: Cancel local composition

- **GIVEN** 本地任务正在生成旁白或合成视频
- **WHEN** 用户取消任务
- **THEN** 系统 SHALL 中止未完成的请求和录制
- **AND** SHALL 释放媒体轨道、媒体元素、Web Audio 节点、Object URL 和未登记的临时产物

### Requirement: PPT Explainer Tasks SHALL Persist Recoverable State

系统 SHALL 使用标准 VIDEO 根任务持久化轻量阶段、幂等键、remoteId、原路由和结果交付状态。

#### Scenario: Resume polling after refresh

- **GIVEN** 非终态根任务包含 remoteId 和原 invocation route
- **WHEN** 应用刷新并恢复任务
- **THEN** 系统 SHALL 使用原 route 继续 poll
- **AND** SHALL NOT 重复 submit 或切换到当前默认供应商

#### Scenario: Resume a pre-submit stage

- **GIVEN** 根任务已持久化幂等键但尚未保存 remoteId
- **WHEN** 应用恢复任务
- **THEN** 系统 SHALL 从最后成功阶段重试
- **AND** submit SHALL 使用相同幂等键

#### Scenario: Ignore duplicate or late completion

- **GIVEN** 任务已完成、失败、取消或已被新的 executionToken 替代
- **WHEN** 重复、乱序或迟到结果到达
- **THEN** 系统 SHALL 忽略不属于当前执行尝试的写回
- **AND** SHALL NOT 重复完成任务、保存素材或插入画布

#### Scenario: Coordinate one task across browser tabs

- **GIVEN** 同一任务在多个标签页中同时恢复
- **WHEN** 任一标签页获得执行锁并尝试 submit、poll 或 finalize
- **THEN** 锁持有者 SHALL 在锁内重读当前任务状态，并以预期 executionAttempt 原子接管本次执行
- **AND** 未获锁或接管失败的标签页 SHALL NOT 使用加锁前快照产生远端副作用
- **AND** 其他标签页 SHALL 观察后续持久化状态且不得重复交付结果

### Requirement: PPT Explainer SHALL Avoid Fixed OpenTu Product Caps

系统 SHALL NOT 使用固定页数、文件字节数、单条发言时长、总成片时长或同 PPT 活跃任务数作为 OpenTu 产品拒绝条件。

#### Scenario: Submit work beyond former suggested thresholds

- **GIVEN** 输入超过 20 页、20 MiB、单条 60 秒或总计 20 分钟中的任一建议阈值
- **WHEN** 本地结构校验、运行环境和供应商 binding 仍可处理
- **THEN** OpenTu SHALL NOT 截断、降级或仅因该固定阈值拒绝任务

#### Scenario: Provider rejects its actual limit

- **WHEN** 供应商因真实配额、模型限制或请求体限制拒绝任务
- **THEN** 系统 SHALL 保留供应商来源和可读错误
- **AND** SHALL NOT 将其描述为 OpenTu 产品限制

#### Scenario: Run concurrent jobs for the same deck

- **GIVEN** 同一 PPT 已有一个非终态讲解任务
- **WHEN** 用户再次提交另一套有效配置
- **THEN** 系统 SHALL 接受第二个独立任务
- **AND** 两个任务 SHALL 使用不同 jobId、快照、取消令牌和结果交付状态

#### Scenario: Runtime resource exhaustion

- **WHEN** 浏览器存储、内存、网络或结构安全检查无法继续处理输入
- **THEN** 系统 SHALL 停止当前阶段、释放临时资源并保留可重试状态
- **AND** SHALL 显示实际运行环境原因而不是伪造固定产品上限

### Requirement: Only The Final Video SHALL Be User-Visible Media

系统 SHALL 将页面快照、讲稿、上传缓存和供应商中间结果标记为 internal，并只把最终根任务视频投影为用户素材。

#### Scenario: Final video completes

- **GIVEN** 根任务获得可用最终视频 URL
- **WHEN** 系统完成结果持久化
- **THEN** 素材库 SHALL 显示一个标准视频素材
- **AND** 原画板 SHALL 插入一个视频节点
- **AND** 中间结果 SHALL NOT 出现在素材库或画布

#### Scenario: Canvas insertion is temporarily unavailable

- **GIVEN** 最终素材已保存但用户切换了画板或插入失败
- **WHEN** 原画板再次可用或用户重试
- **THEN** 系统 SHALL 只重试画布插入
- **AND** SHALL NOT 重复提交、保存素材或创建第二个视频节点

#### Scenario: Coordinate final canvas delivery across browser tabs

- **GIVEN** 多个标签页同时打开原画板并观察到同一任务已完成
- **WHEN** 任一标签页获得该画板和任务的交付锁
- **THEN** 锁持有者 SHALL 在锁内重读持久化任务并仅在尚未插入时创建视频节点
- **AND** `insertedToCanvas` SHALL 在释放交付锁前完成持久化
- **AND** 插入失败 SHALL 释放锁并允许后续标签页只重试画布交付

#### Scenario: Remote media cache fails

- **GIVEN** 最终视频 URL 可播放但浏览器缓存失败
- **WHEN** 素材库或任务队列展示结果
- **THEN** 系统 SHALL 复用现有缓存警告语义
- **AND** SHALL 保留原远端 URL 并提示签名链接可能过期

### Requirement: PPT Explainer SHALL Preserve Credential And Board Boundaries

系统 SHALL 仅在 Provider Transport 发送请求时使用解密凭据，并把最终结果限定到任务创建时所属画板。

#### Scenario: Persist task state without credentials

- **WHEN** 系统保存根任务、日志、缓存元数据或错误
- **THEN** 数据 SHALL NOT 包含 API key、Authorization header 或完整 provider context
- **AND** 原 route SHALL 只包含恢复所需的无密钥身份与 binding 快照

#### Scenario: Original route becomes unavailable

- **GIVEN** 任务恢复时原 profile 已删除、停用或缺少凭据
- **WHEN** 系统尝试 poll、cancel 或 retry
- **THEN** 系统 SHALL 显示原 route 不可用错误
- **AND** SHALL NOT 静默切换供应商或把凭据发往其他目标

#### Scenario: Rotate credentials without changing the original destination

- **GIVEN** 原 profile 仍可用且 canonical Base URL 未变化，但 API key 已轮换
- **WHEN** 系统恢复、poll、cancel 或 retry
- **THEN** 系统 SHALL 使用该 profile 的当前运行时凭据和原无密钥 binding snapshot
- **AND** SHALL NOT 把新凭据写回任务状态

#### Scenario: Reject an original destination change

- **GIVEN** 原 profile 的 Base URL host 或 path 已改变
- **WHEN** 系统尝试恢复、poll、cancel 或 retry
- **THEN** 系统 SHALL 拒绝使用已改变的目标并显示原路由不可恢复错误
- **AND** SHALL NOT 把 remoteId、幂等键或凭据发送到新目标

#### Scenario: User switches boards before completion

- **GIVEN** 任务绑定到画板 A
- **WHEN** 用户切到画板 B 后任务完成
- **THEN** 系统 SHALL NOT 把视频插入画板 B
- **AND** SHALL 在画板 A 可用时幂等完成插入
