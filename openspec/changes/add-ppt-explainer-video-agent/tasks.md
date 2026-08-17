## 1. Contracts And Routing

- [x] 1.1 定义版本化的 PPT 讲解配置、来源、speaker turn、根任务阶段和无密钥持久化类型
- [x] 1.2 为 video provider binding 增加 `ppt-explainer` capability、submit/poll/optional-cancel 和字段映射
- [x] 1.3 增加能力预检，确保缺模型、binding、凭据或 presenter 能力时零远端副作用
- [x] 1.4 增加 provider submit/poll/cancel 适配与状态、进度、错误和最终 URL 标准化

## 2. Presentation Sources

- [x] 2.1 复用现有 PPT Frames 实现当前 PPT 的有序来源解析和不可变快照
- [x] 2.2 复用 `generate_ppt` 实现主题来源，并接入确认大纲/警告后跳过两条路径
- [x] 2.3 引入固定版本且按需加载的 PPTX 渲染依赖，并在 Worker 中实现安全解析、notes 提取和逐页快照
- [x] 2.4 支持 binding 声明 PPTX 时原文件直传，否则提交有序页图
- [x] 2.5 实现空主题、空 PPT、缺页图、损坏/加密/空 PPTX 和逐页渲染错误校验

## 3. Narration Planning

- [x] 3.1 根据页面 notes 和文本模型生成结构化页级讲稿
- [x] 3.2 实现单声线、双声线、单数字人和双数字人 speaker 配置与 schema 校验
- [x] 3.3 保存文本/图片/成片模型及原 `ModelRef`，避免恢复时路由漂移
- [x] 3.4 确保讲稿和成片总时长不经过普通视频 60 秒 `duration` 字段

## 4. Persistent Orchestration

- [x] 4.1 用标准 `VIDEO` 根任务实现专用状态机和阶段进度，不新增 TaskType 或数据库 store
- [x] 4.2 在 submit 前持久化幂等键，submit 后立即持久化 remoteId 和原 route snapshot
- [x] 4.3 实现刷新恢复、跨标签锁内重读与 executionAttempt 校验、阶段重试、重复完成幂等和迟到回写隔离
- [x] 4.4 实现 AbortController、executionToken、本地取消，以及远端 cancel single-flight、成功去重和失败重试
- [x] 4.5 支持同一 PPT 多任务并发，确保快照、事件和取消互不影响

## 5. Agent And UI

- [x] 5.1 注册 `generate_ppt_explainer_video` MCP 工具、SW/main-thread capability 和工作流解析入口
- [x] 5.2 新增内置「PPT 讲解视频」Skill，复用 Agent 多媒体模型选择与任务发布
- [x] 5.3 增加来源、审核方式、讲解模式、声音和数字人选择控件及完整 disabled/error/loading 状态
- [x] 5.4 为跳过大纲增加明确二次提示，并记录用户确认时间
- [x] 5.5 在 PPT 大纲确认路径提供继续生成讲解视频的幂等入口

## 6. Result Delivery

- [x] 6.1 增加显式 internal/user 结果可见性，确保中间产物不进入素材库、提示词历史或画布
- [x] 6.2 将最终成片标准化为一个 VIDEO result，并复用缓存警告与素材库投影
- [x] 6.3 将最终视频插入任务创建时所属画板，支持切板后的延迟幂等插入
- [x] 6.4 使用 `boardId + taskId` 交付锁和锁内权威读取，保证素材成功但画布失败时只重试画布，不重复保存或提交成片

## 7. Resource And Security

- [ ] 7.1 PPTX 解压、页图生成和上传采用 Worker、逐页处理、背压和及时资源释放
  - 剩余：Worker 仍需一次完整 `Blob.arrayBuffer()`，单次 `FormData` 上传仍可能持有全部页 Blob
- [x] 7.2 验证 File/Blob/base64/API key/Authorization/完整响应不会进入任务、日志或缓存元数据
- [x] 7.3 验证恢复、poll、cancel 始终使用原 route，且不向不可信目标泄漏凭据
- [x] 7.4 保留 OOXML 结构安全检查和实际运行环境配额错误，不加入固定产品大小/页数/时长上限

## 8. Automated Verification

- [x] 8.1 覆盖三种来源、两种审核路径、四种讲解模式和最终双写正常流程
- [x] 8.2 覆盖空数据、非法 speaker、损坏 PPTX、缺 capability/key、401/403/429/5xx 和完成无 URL
- [x] 8.3 覆盖 21+ 页、61+ 秒发言、20+ 分钟总时长、较大 Blob 元数据和同 PPT 双任务不被 OpenTu 预拒绝或截断
- [x] 8.4 覆盖刷新恢复、幂等 submit、取消与迟到 poll、重复完成、乱序回调和原画板切换
- [x] 8.5 覆盖 internal 中间结果不进入素材库/画布，最终结果只出现一次
- [ ] 8.6 覆盖 Chromium、Firefox、WebKit 的 PPTX Worker、上传、轮询、取消和资源释放兼容性

## 9. Validation And Handoff

- [ ] 9.1 运行相关 Vitest、drawnix typecheck/lint 与三浏览器 Playwright 用例
  - 已完成：31 个相关 Vitest 文件 / 360 个测试、drawnix typecheck、增量 ESLint（0 error）、OpenSpec strict、Node 20 Service Worker/隔离 PPTX Worker 构建，以及 GitHub CI 的 Node 20 web/drawnix 构建
  - 基线说明：CI 的 10 个失败测试文件在 `origin/develop@0e7c242e` 上同样为 55 项失败；上一个已合并 PR #229 也因 11 个测试文件和既有 size-limit 债务失败
  - 剩余：内置浏览器 URL 策略阻止本轮完成桌面/移动端复验；本机 8 GiB 环境整站构建在默认约 2 GiB old-space 下 OOM
- [ ] 9.2 使用真实供应商 binding 验证 submit、poll、cancel（若支持）及四种 presenter mode
- [x] 9.3 记录无远端 cancel、PPTX 渲染差异、供应商限制和跨域缓存等剩余风险
- [x] 9.4 更新 Navigator 的资源、verify、version、PR 和完成事件
