## 状态与当前事实

方案已获用户批准并实施。本任务分支为 `dev/consolidate-canvas-remove-workflow-mode`，从原分支 `dev/image25-auto-prompt-size` 的 HEAD 建立，起始工作区干净，远程为 `https://github.com/ljquan/opentu.git`。不提交或推送其他任务。

代码核查入口：

- 主画布：`components/toolbar/popup-toolbar/popup-toolbar.tsx`、`image-details-button.tsx`、`components/ai-input-bar/AIInputBar.tsx`、`canvas-association-resolver.ts`、`plugins/canvas-association.ts`。
- 主画布草稿已按目标元素保存；不可将其作为缺失功能重新实现，也不可承诺当前内存草稿跨刷新持久化。
- 主画布提示词、素材、批量生成和备份分别复用现有 `prompt-history`、`media-library`、批量工具及 `services/backup-restore/`。
- 待提取交互：`workflow-mode/web/src/components/canvas/canvas-image-toolbar-settings-modal.tsx`、`canvas-node-split-dialog.tsx`、`canvas-node-upscale-dialog.tsx`、`canvas-node-angle-dialog.tsx`。
- 待删除运行边界：`WorkflowModeHost`、`use-workflow-route`、`WorkflowApp`、专属路由、Vite 的 `workflowAssetsPlugin`、`@/*` 别名及 PostCSS 作用域处理。

## 实现决定

### 一套画布、输入和任务系统

将必要的纯计算逻辑移动或重写到主画布普通工具模块，UI 使用现有主画布组件和主题，不为保留少量工具继续加载 Ant Design/Tailwind 工作流应用。生成动作进入现有输入与任务提交链；图片视角编辑只回填，手动发送后才提交。不得把本地插值放大改成隐式付费请求。

手动拆分、本地放大产生新元素，源图保留；沿用画布插入、关联和历史记录机制，失败不残留部分结果。确认前展示尺寸和数量；不静默加入新的大小、并发、重试或超时限制，需要新增边界时按项目规则确认。

### 兼容模块不保留旧模式

兼容代码仅承担旧格式读取、校验、导出和用户触发的导入，不保留旧组件、Zustand stores、生成执行器或插件运行时。

已查到 `infinite-canvas` 数据库的 `app_state`、`image_files`、`image_previews`、`image_generation_logs`、`video_generation_logs`，以及画布 `infinite-canvas:canvas_store`、素材 `infinite-canvas:asset_store` 和配置 `infinite-canvas:ai_config_store`。正式删除前补齐文件媒体、提示词、插件、聊天和配置的全部清单及 localStorage 回退；预览缓存与业务源数据分别处理，未知结构拒绝破坏性写入。

导出分为去凭据的业务备份和明确标记的不支持内容，不能把配置 store 整体序列化后声称无敏感数据。导入先预检，再通过现有导入/插入服务写入，使用旧来源标识记录转换结果，不覆盖已有画布。未知节点只保存原始资料，不模拟其执行语义。过期远程链接只能记录缺失，不能保证恢复。

### 旧链接

主画布拥有一个小型旧路径归一化入口，精确匹配 `/workflow` 或 `/workflow/` 后缀路径，保留主画布正常 query/hash 使用方式。不将 `/workflower` 等相似路径当旧入口，也不将旧项目 ID 当主画布项目 ID。旧路径进入主画布后提示按需打开数据兼容入口。

### 删除与依赖

先移植和测试，再断开路由，最后删除专用目录、脚本、资源和只被其使用的依赖。对运行代码做引用检查，并验证构建模块图与生成资源；文档中的历史引用按适用状态处理。保留旧提案的历史记录，本次 proposal 明确替代其保留独立页面的目标。

## 风险与回滚

- 两套数据格式无法全量等价转换：保留原库及去凭据导出、转换报告，停止不支持内容的自动执行。
- 主画布共享 workflow 服务误删：建立目录外引用清单，重点回归普通生成、SW、Agent、批量、音视频流程。
- 大量依赖移除导致启动或离线缓存回归：核查主入口、构建、Service Worker 和部署资源配置，不仅检查 TypeScript 引用。
- 恢复任务重复计费：导入不得调用生成 POST；恢复遵守原任务路由与请求 ID，未知结果只提示。
- Git 回滚只恢复代码；开发验证不改用户数据库，正式使用时亦不删除旧数据，迁移创建新记录并记录归属。

## 验证

使用项目既有 Vitest 配置对工具配置、拆分计算、尺寸比例、视角提示词、路径匹配、旧格式校验、媒体导出、失败回滚、重复导入和任务不重发做定向测试。回归主画布逐目标草稿、画布引用、再次生成、蒙版、批量和备份恢复。执行库与 Web 类型检查、受影响文件 lint、实际生产构建与残留资源核查。

实际测试与结果记录在 `docs/qa-canvas-consolidation.md`。OpenSpec CLI 当前既不在 PATH，也不在本地 `node_modules/.bin`；严格 CLI 校验记为未执行，格式检查不能替代 strict。

## 实施决定补充

- 分割线使用百分比输入与图上位置预览，不引入旧编辑器拖拽/缩放系统；编辑百分比即可调整分割线。
- 本地放大采用浏览器 Canvas 插值，无新增人为像素上限；尺寸和处理错误显式报告。
- 视角预览仅平面示意，生成使用主画布输入回填与手动发送。
- 旧数据兼容只转换主图及普通媒体/文本和直接连接，其他槽位、聊天、配置和插件资料保留去凭据备份。未知版本允许导出，但拒绝转换。
- 主项目没有 `docs/content/docs/progress/todo.mdx` 或 `pending-test.mdx`；不重建已删除工作流内部的待办目录，本次待办用 proposal/tasks 与 QA 维护。
