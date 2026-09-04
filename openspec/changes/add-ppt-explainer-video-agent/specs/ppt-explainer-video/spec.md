## ADDED Requirements

### Requirement: PPT Explainer Agent SHALL Accept One Presentation Source

系统 SHALL 允许用户从主题生成或当前画布 PPT 中选择且只选择一个演示来源。

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

#### Scenario: Use selected current PPT pages

- **GIVEN** 用户在页面视图或大纲视图选择一个或多个 PPT 页面
- **WHEN** 用户从 PPT 编辑器打开讲解视频并提交
- **THEN** 对话框 SHALL 显示已选页数
- **AND** 任务 SHALL 只按 PPT 页码顺序冻结已选页面
- **AND** 未选页面 SHALL NOT 创建讲稿或视频子任务

#### Scenario: Fall back to all current PPT pages

- **GIVEN** PPT 编辑器没有选中页面
- **WHEN** 用户从 PPT 编辑器打开讲解视频并提交
- **THEN** 任务 SHALL 使用当前 PPT 的全部页面

#### Scenario: Reject stale or invalid selected page IDs

- **GIVEN** 当前 PPT 请求包含空、重复、格式错误或已不存在的页面 ID
- **WHEN** 创建服务校验请求
- **THEN** 系统 SHALL 在模型预检或任务持久化前拒绝请求

#### Scenario: Reject a missing or ambiguous source

- **WHEN** 来源为空、选择多个来源、使用不受支持的来源，或当前画板没有 PPT 页面
- **THEN** 系统 SHALL 在模型调用、缓存写入或任务持久化前停止
- **AND** SHALL 显示可操作的来源错误且不产生部分任务

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

### Requirement: PPT Explainer SHALL Support Two Presenter Modes

系统 SHALL 仅允许新建任务使用单人讲解和双人对谈两种模式，并使用结构化 speaker 配置；历史任务中的旧模式字段只允许兼容读取和恢复，不得重新暴露为创建能力。

#### Scenario: Generate single-presenter narration

- **WHEN** 用户选择单人讲解并配置一个讲解者名称
- **THEN** 每条讲稿 SHALL 归属该 speaker
- **AND** 最终视频 SHALL 包含按页同步的单人讲解音轨

#### Scenario: Generate two-presenter dialogue

- **WHEN** 用户选择双人对谈并配置两个不同 speaker
- **THEN** 讲稿 SHALL 生成仅引用这两个 speaker 的有序 turns
- **AND** 讲稿 SHOULD 优先形成一轮主讲与回应，较长页面最多两轮，避免逐句频繁切换 speaker
- **AND** 最终视频 SHALL 按连续 speaker 边界拆成单角色有声片段，再按 turns 顺序合成对谈内容

#### Scenario: Reject incomplete presenter configuration

- **WHEN** 双人模式缺少第二 speaker、讲解者名称为空或 turn 引用未知 speaker
- **THEN** 系统 SHALL 在视频模型调用前停止
- **AND** SHALL 指明需要修正的 speaker 配置

### Requirement: PPT Explainer SHALL Build A Slide-Aligned Narration Plan

系统 SHALL 按页面顺序生成结构化讲稿，以已有演讲备注为主要依据，并让讲稿长度和句子结构覆盖用户指定的页级目标时长。

#### Scenario: Prefer existing slide notes

- **GIVEN** 页面包含非空 `notes`
- **WHEN** 系统构建讲稿计划
- **THEN** 系统 SHALL 将 notes 作为该页讲稿主要输入
- **AND** SHALL NOT 无提示地丢弃用户已有备注
- **AND** notes 过短或过长时，系统 SHALL 围绕原意扩写或保留重点压缩，使讲稿接近该页目标时长

#### Scenario: Generate missing narration

- **GIVEN** 一个或多个页面缺少可讲解备注
- **WHEN** 系统构建讲稿计划
- **THEN** 文本模型 SHALL 根据页面内容补齐对应页面 turns
- **AND** 结果 SHALL 通过结构化 JSON schema 校验

#### Scenario: Follow the requested slide duration and narration direction

- **GIVEN** 用户提供正整数 `secondsPerSlide` 和可选讲解要求
- **WHEN** 系统生成或调整页级讲稿
- **THEN** 文本模型 SHALL 按自然普通话语速生成足够覆盖目标时间窗的内容
- **AND** 每页 turns 的估计时长总和 SHALL 接近该页目标时长
- **AND** turns SHALL 使用适合字幕逐句切换的自然短句
- **AND** 用户讲解要求 SHALL 适用于全部页面且不得歪曲已有 notes 的核心内容

#### Scenario: Snapshot accepted deck state

- **GIVEN** 用户已通过审核门
- **WHEN** 任务开始生成讲稿或提交供应商
- **THEN** 系统 SHALL 固化页序、快照、备注、转场和 speaker 配置
- **AND** 固化快照 SHALL 与用户可见 PPT 页面使用相同页面图和版本
- **AND** 后续画布编辑 SHALL NOT 改变已接受任务

### Requirement: PPT Explainer SHALL Use Only Configured Existing Models

系统 SHALL 分别展示当前启用供应商已获取、勾选且具有可执行路由的图片与视频模型；图片模型 SHALL 复用既有 PPT 页面生图链路，视频模型 SHALL 用于生成讲解音轨。系统不得追加供应商未获取或无路由的静态目录模型，也不得把静态标签包装成音轨能力保证。

#### Scenario: Configure speakers without voice samples

- **WHEN** 用户选择单人或双人讲解模式
- **THEN** 系统 SHALL 只要求讲解者名称
- **AND** 双人 turns SHALL 按连续角色拆成独立的单角色视频请求
- **AND** 主讲人与嘉宾 SHALL 使用稳定角色身份和互斥的成年男声/女声提示约束，不得因 speaker 数组顺序变化而互换
- **AND** SHALL 提示该约束不是供应商 voice ID，实际音色和朗读一致性仍由视频模型决定

#### Scenario: Reject an unavailable model or invented configuration

- **WHEN** 所选模型没有当前可执行路由、缺少凭据，或输入包含界面未提供的执行/讲解者字段
- **THEN** 系统 SHALL 在任何模型调用、缓存写入和任务持久化前失败
- **AND** SHALL NOT 构造模型、声音、数字人或专用成片服务

#### Scenario: List executable video models for PPT narration

- **GIVEN** 启用供应商已获取并勾选一个或多个具有可执行路由的视频模型
- **WHEN** 用户打开 PPT 讲解视频模型选择器
- **THEN** 系统 SHALL 展示这些真实配置的视频模型
- **AND** SHALL NOT 因缺少静态音轨标签而隐藏模型
- **AND** 供应商禁用、模型取消勾选、路由失效或凭据缺失后，对应模型 SHALL 从候选中移除

#### Scenario: List configured image models for PPT generation

- **GIVEN** 启用供应商已获取并勾选一个或多个具有可执行路由的图片模型
- **WHEN** 用户打开 PPT 讲解配置
- **THEN** 系统 SHALL 展示这些图片模型并允许用户选择
- **AND** 主题来源 SHALL 使用所选图片模型复用既有 PPT 页面生成链路
- **AND** 供应商禁用、模型取消勾选、路由失效或凭据缺失后，对应模型 SHALL 从候选中移除

#### Scenario: Preserve provider identity for duplicate model IDs

- **GIVEN** 两个供应商暴露相同的图片或视频模型 ID
- **WHEN** 用户选择其中一个供应商实例并创建任务
- **THEN** 系统 SHALL 以 `profileId + modelId` 保存和执行所选模型路由
- **AND** 所选实例失效后 SHALL 禁止新建任务，恢复时 SHALL 保留原路由错误
- **AND** SHALL NOT 仅按模型 ID 静默切换到另一个供应商

#### Scenario: Reuse complete current PPT images without regeneration

- **GIVEN** 当前 PPT 的所有已选页面都已有可冻结的页面图
- **WHEN** 用户创建 PPT 讲解视频任务
- **THEN** 系统 SHALL 复用这些页面图且 SHALL NOT 调用图片模型
- **AND** 文本与视频模型仍 SHALL 在任务持久化前通过预检

#### Scenario: Generate only missing current PPT images

- **GIVEN** 当前 PPT 的部分已选页面缺少页面图但具有页面提示词
- **WHEN** 用户使用所选图片模型创建任务
- **THEN** 系统 SHALL 只为缺图页调用既有 PPT 页面生图链路
- **AND** SHALL 在冻结快照和生成讲解前将结果写回对应的用户可见 Frame

### Requirement: PPT Explainer SHALL Support Local Composition With Existing Models

系统 SHALL 复用已有文本、图片和用户已配置的视频模型完成任务。

#### Scenario: Generate a narrated slide video locally

- **GIVEN** 用户选择一个已配置且具有可执行路由的视频模型
- **WHEN** 用户选择单人或双人讲解
- **THEN** 系统 SHALL 按页面把 speaker turns 通过普通文生视频链路提交为有声视频片段，不得携带页面参考图
- **AND** 各角色片段的输出窗口总和 SHALL 等于该页目标时长，供应商请求时长 SHALL 只使用模型实际声明的合法选项
- **AND** 系统 SHALL 只使用片段音轨，不得把模型重绘画面作为最终 PPT 视觉
- **AND** 系统 SHALL 按页序固定绘制原 PPT 快照并合成音轨、字幕和转场
- **AND** 最终用户可见视频的每一页 SHALL 与已接受的 PPT 页面视觉一致

#### Scenario: Split a slide into model-supported durations

- **GIVEN** 用户页目标时长不能由所选视频模型的一个合法时长直接覆盖
- **WHEN** 系统规划该页内部视频子任务
- **THEN** 系统 SHALL 仅使用模型当前暴露的合法时长选项拆成一个或多个片段
- **AND** 最后一段超过剩余页时间窗时，最终合成 SHALL 只使用分配给该段的最长播放窗口
- **AND** 片段提前结束时，最终合成 SHALL 直接使用实际时长，不补静音或延长页面
- **AND** 系统 SHALL NOT 把页目标或整部成片总时长作为模型不支持的单段时长提交

#### Scenario: Display sentence-aligned subtitles

- **GIVEN** 一页讲稿包含多个自然句或双人 turns
- **WHEN** 系统合成该页音轨和字幕
- **THEN** 字幕 SHALL 按当前讲稿 cue 依次切换
- **AND** 同一时刻 SHALL NOT 将整页完整讲稿长期覆盖在 PPT 画面上

#### Scenario: Selected model does not produce usable speech

- **WHEN** 所选视频模型生成结果没有可用音轨或未按讲稿朗读
- **THEN** 系统 SHALL 停止最终合成并保留供应商真实结果或错误
- **AND** SHALL 提示改用明确支持有声视频的模型，不得伪造音频模型

#### Scenario: Reject undecodable narration media and accept shorter output

- **WHEN** 片段没有可解码、可播放的音轨
- **THEN** 系统 SHALL 在最终录制和交付前拒绝该片段并保留明确诊断
- **AND** 片段短于分配的最长播放窗口时，系统 SHALL 直接使用实际时长
- **AND** SHALL NOT 用静音填充或无限延长 PPT 页面来补足计划时长

#### Scenario: Cache generated narration media before composition

- **GIVEN** 视频模型返回远程有声片段 URL
- **WHEN** 系统准备本地合成
- **THEN** 系统 SHALL 将片段缓存为同源 internal 媒体并逐页加载
- **AND** 缓存或媒体解码失败 SHALL 明确失败，不得静默输出无声或跨域受限视频
- **AND** 系统 SHALL NOT 同时把全部源片段读入 JS 内存

#### Scenario: Compose on LAN HTTP when Cache Storage is unavailable

- **GIVEN** 用户从局域网 HTTP 地址运行工作台且浏览器不提供 Cache Storage
- **WHEN** 系统缓存页面图或逐页讲解媒体
- **THEN** 系统 SHALL 使用既有 IndexedDB Blob 降级路径并保持轻量 URL 引用
- **AND** SHALL NOT 将大媒体转换为 base64 写入任务状态
- **AND** 同源代理或跨域策略失败时 SHALL 保留实际错误，不得将 HTML 响应当作媒体继续合成

#### Scenario: Cancel local composition

- **GIVEN** 本地任务正在生成旁白或合成视频
- **WHEN** 用户取消任务
- **THEN** 系统 SHALL 中止未完成的请求和录制
- **AND** SHALL 释放媒体轨道、媒体元素、Web Audio 节点、Object URL 和未登记的临时产物

### Requirement: PPT Explainer Tasks SHALL Persist Recoverable State

系统 SHALL 使用标准 VIDEO 根任务持久化轻量阶段、内部子任务引用、模型来源和结果交付状态。

#### Scenario: Resume an in-progress task after refresh

- **GIVEN** 非终态根任务包含已持久化阶段和内部子任务引用
- **WHEN** 应用恢复任务
- **THEN** 系统 SHALL 从最后成功阶段重试
- **AND** SHALL NOT 重复已完成的内部任务或切换模型来源

#### Scenario: Keep legacy PPTX tasks compatible without exposing a new entry

- **GIVEN** IndexedDB 中已经存在来源为 `pptx` 的历史 PPT 讲解任务
- **WHEN** 应用读取或恢复该历史任务
- **THEN** 系统 SHALL 使用已有兼容路径继续读取、恢复或显示终态结果
- **AND** 新建 UI、MCP schema 和创建服务 SHALL NOT 展示或接受 `pptx` 来源

#### Scenario: Ignore duplicate or late completion

- **GIVEN** 任务已完成、失败、取消或已被新的 executionToken 替代
- **WHEN** 重复、乱序或迟到结果到达
- **THEN** 系统 SHALL 忽略不属于当前执行尝试的写回
- **AND** SHALL NOT 重复完成任务、保存素材或插入画布

#### Scenario: Coordinate one task across browser tabs

- **GIVEN** 同一任务在多个标签页中同时恢复
- **WHEN** 任一标签页获得执行锁并尝试生成、轮询内部任务或 finalize
- **THEN** 锁持有者 SHALL 在锁内重读当前任务状态，并以预期 executionAttempt 原子接管本次执行
- **AND** 未获锁或接管失败的标签页 SHALL NOT 使用加锁前快照产生远端副作用
- **AND** 其他标签页 SHALL 观察后续持久化状态且不得重复交付结果

### Requirement: PPT Explainer SHALL Avoid Fixed OpenTu Product Caps

系统 SHALL NOT 使用固定页数、单条发言时长、总成片时长或同 PPT 活跃任务数作为 OpenTu 产品拒绝条件。

#### Scenario: Submit work beyond former suggested thresholds

- **GIVEN** 输入超过 20 页、单条 60 秒或总计 20 分钟中的任一建议阈值
- **WHEN** 本地结构校验、运行环境和所选模型仍可处理
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

系统 SHALL 将页面快照、讲稿和供应商中间结果标记为 internal，并只把最终根任务视频投影为用户素材。

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
