## 1. Contracts And Routing

- [x] 1.1 定义版本化的 PPT 讲解配置、来源、speaker turn、根任务阶段和无密钥持久化类型
- [x] 1.2 复用现有文本、图片和视频模型路由，不新增专用 PPT provider 协议
- [x] 1.3 增加能力预检，确保缺模型、凭据或可执行路由时零写入/计费副作用
- [x] 1.4 历史 provider 任务保留读取、恢复和取消兼容，但新建 DTO 与 UI 不再暴露该路径

## 2. Presentation Sources

- [x] 2.1 复用现有 PPT Frames 实现当前 PPT 的有序来源解析和不可变快照
- [x] 2.2 复用 `generate_ppt` 实现主题来源，并接入确认大纲/警告后跳过两条路径
- [x] 2.3 引入固定版本且按需加载的 PPTX 渲染依赖，并在 Worker 中实现安全解析、notes 提取和逐页快照
- [x] 2.4 将 PPTX 统一解析为有序页图后进入现有模型链路
- [x] 2.5 实现空主题、空 PPT、缺页图、损坏/加密/空 PPTX 和逐页渲染错误校验

## 3. Narration Planning

- [x] 3.1 根据页面 notes 和文本模型生成结构化页级讲稿
- [x] 3.2 实现单人讲解和双人对谈 speaker 配置与 schema 校验
- [x] 3.3 保存文本/图片/成片模型及原 `ModelRef`，避免恢复时路由漂移
- [x] 3.4 确保讲稿和成片总时长不经过普通视频 60 秒 `duration` 字段

## 4. Persistent Orchestration

- [x] 4.1 用标准 `VIDEO` 根任务实现专用状态机和阶段进度，不新增 TaskType 或数据库 store
- [x] 4.2 在生成前持久化幂等键和阶段，并保存内部媒体任务引用
- [x] 4.3 实现刷新恢复、跨标签锁内重读与 executionAttempt 校验、阶段重试、重复完成幂等和迟到回写隔离
- [x] 4.4 实现 AbortController、executionToken、本地取消，以及远端 cancel single-flight、成功去重和失败重试
- [x] 4.5 支持同一 PPT 多任务并发，确保快照、事件和取消互不影响

## 5. Agent And UI

- [x] 5.1 注册 `generate_ppt_explainer_video` MCP 工具、SW/main-thread capability 和工作流解析入口
- [x] 5.2 新增内置「PPT 讲解视频」Skill，复用 Agent 多媒体模型选择与任务发布
- [x] 5.3 增加来源、审核方式、单/双人讲解控件及完整 disabled/error/loading 状态
- [x] 5.4 为跳过大纲增加明确二次提示，并记录用户确认时间
- [x] 5.5 在 PPT 大纲确认路径提供继续生成讲解视频的幂等入口
- [x] 5.6 复用 PPT 页面/大纲多选，仅提交已选页面；无选择时回退全部页面并校验页面 ID

## 6. Result Delivery

- [x] 6.1 增加显式 internal/user 结果可见性，确保中间产物不进入素材库、提示词历史或画布
- [x] 6.2 将最终成片标准化为一个 VIDEO result，并复用缓存警告与素材库投影
- [x] 6.3 将最终视频插入任务创建时所属画板，支持切板后的延迟幂等插入
- [x] 6.4 使用 `boardId + taskId` 交付锁和锁内权威读取，保证素材成功但画布失败时只重试画布，不重复保存或提交成片

## 7. Resource And Security

- [ ] 7.1 PPTX 解压、页图生成和上传采用 Worker、逐页处理、背压和及时资源释放
  - 剩余：Worker 仍需一次完整 `Blob.arrayBuffer()`，单次 `FormData` 上传仍可能持有全部页 Blob
- [x] 7.2 验证 File/Blob/base64/API key/Authorization/完整响应不会进入任务、日志或缓存元数据
- [x] 7.3 验证内部媒体任务恢复、轮询和取消使用原 route，且不向不可信目标泄漏凭据
- [x] 7.4 保留 OOXML 结构安全检查和实际运行环境配额错误，不加入固定产品大小/页数/时长上限

## 8. Automated Verification

- [x] 8.1 覆盖三种来源、两种审核路径、两种讲解模式和最终双写正常流程
- [x] 8.2 覆盖空数据、非法 speaker、损坏 PPTX、缺 capability/key、401/403/429/5xx 和完成无 URL
- [x] 8.3 覆盖 21+ 页、61+ 秒发言、20+ 分钟总时长、较大 Blob 元数据和同 PPT 双任务不被 OpenTu 预拒绝或截断
- [x] 8.4 覆盖刷新恢复、幂等 submit、取消与迟到 poll、重复完成、乱序回调和原画板切换
- [x] 8.5 覆盖 internal 中间结果不进入素材库/画布，最终结果只出现一次
- [ ] 8.6 覆盖 Chromium、Firefox、WebKit 的 PPTX Worker、上传、轮询、取消和资源释放兼容性

## 9. Validation And Handoff

- [ ] 9.1 运行相关 Vitest、drawnix typecheck/lint 与三浏览器 Playwright 用例
  - 本次清理复验：17 个 Vitest 文件 / 202 个测试全部通过；`drawnix:typecheck`、Prettier、`git diff --check` 通过；增量 ESLint 0 error，仅保留 20 条原文件 warning
  - 局域网服务：`5188` 从当前功能工作树启动并返回 HTTP 200；内置浏览器在服务重启间进入本地错误页后被安全策略阻止自动重载，未冒充完成界面复验
  - 本轮模型入口调整：4 个 Vitest 文件 / 56 个测试、`drawnix:typecheck`、Prettier、`git diff --check`、增量 ESLint 0 error 和 OpenSpec strict 全部通过；局域网界面确认旧音轨能力空态已移除
  - 本次文生视频链路回归修复：PPT 模块 12 个 Vitest 文件 / 182 个测试、`drawnix:typecheck`、Prettier 和 `git diff --check` 通过；本地依赖未提供 OpenSpec CLI，strict 校验未执行
  - 本次限制：当前浏览器配置没有已勾选视频模型，有配置候选展示由运行时模型测试覆盖；Firefox/WebKit 专项 E2E 仍未完成
- [ ] 9.2 使用真实已配置的视频模型验证逐页有声片段、固定 PPT 合成及单/双人模式
- [x] 9.3 记录无远端 cancel、PPTX 渲染差异、供应商限制和跨域缓存等剩余风险
- [x] 9.4 更新 Navigator 的资源、verify、version、PR 和完成事件

## 10. 已废弃方案清理

- [x] 10.1 删除新建入口、MCP schema 和 Skill 中未接入的专用 Agent、音频模型、声音样本与数字人配置
- [x] 10.2 新任务拒绝历史 execution/provider 与额外 speaker 字段，且在缓存、网络和持久化前失败
- [x] 10.3 历史任务 DTO 与 provider 适配器仅保留读取/恢复兼容，不允许新任务进入
- [x] 10.4 PPT 模型选择器只展示启用供应商实际获取并勾选的视频模型实例，不混入静态目录模型
- [x] 10.5 覆盖隐藏旧入口、schema 收口、畸形输入、无能力模型和零副作用拒绝

## 12. 逐页有声视频生成

- [x] 12.1 移除 PPT 新建入口中的未接入语音与身份配置
- [x] 12.2 使用已选视频模型按页生成带语音片段，并保留 internal 子任务所有权、取消和恢复信息
- [x] 12.3 将有声片段强制缓存为同源 internal 媒体，只取音轨并以原 PPT 快照固定画面本地合成
- [x] 12.4 更新 UI 和任务进度，明确最终画面保持原 PPT，生成式模型只决定朗读、音色和时长
- [x] 12.5 覆盖单/双人提示词、固定 PPT 画面、逐页音轨、缓存/解码失败、取消、兼容降级和资源释放测试
- [x] 12.6 复验最终素材库与原画板幂等交付，确认模型重绘片段保持 internal 且不直接展示
- [x] 12.7 主题生成新增独立 PPT，保留已有页面并按 jobId 隔离本次页面集合
- [x] 12.8 移除 PPT 讲解底栏的音频模型及创建输入路由（原方案已废弃）
- [x] 12.9 将生成页图先写回用户可见 PPT，再从同一页面冻结快照；传递精确页数并修正任务卡阶段展示
- [x] 12.10 取消静态音轨标签准入，PPT 入口直接使用真实已配置视频模型，并保留运行时音轨失败诊断

## 13. 页级目标时间轴与讲解质量

- [x] 13.1 配置与根任务保存每页目标秒数和通用讲解要求，旧任务缺省字段保持兼容
- [x] 13.2 讲稿规划器按页目标时长估算内容量，备注过短/过长时基于原意调整，并输出自然短句 turns
- [x] 13.3 复用模型真实时长选项，将每页目标拆为一个或多个合法内部视频片段
- [x] 13.4 本地合成按分配时间窗裁切片段并逐句切换字幕，不再整页常驻完整讲稿
- [x] 13.5 增加可解码音轨、前导静音、有效语音覆盖和时长偏差门禁及有界重试
- [x] 13.6 覆盖 7 秒目标映射到 10 秒合法片段、30 秒多片段、短备注扩写、逐句字幕和末尾才有声音的失败场景
