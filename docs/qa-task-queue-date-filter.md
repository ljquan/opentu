# 任务队列日期筛选 QA

## 2026-10-31：筛选区显示优化

- 根据用户截图，修正类型按钮被搜索/日期整体高度垂直居中的布局。类型与搜索/操作使用同一行，日期独占下一行；起止日期合并为有“至”分隔的统一输入组，减少重复可见标签，保留原生日期操作、无障碍标签和橙色焦点提示。统一 32px 控件高度与细边框；使用抽屉容器宽度调整窄布局，历史页沿用全宽搜索。筛选、分页及数据逻辑不变。
- 实际验证：复跑上方 5 文件共 34 项测试全部通过；Drawnix/Web TypeScript、Web 应用构建（1 分 43 秒）和 `git diff --check` 通过。两份修改组件 ESLint 为 1 项原有模块边界错误、15 条原有警告，TaskQueuePanel 与此前 HEAD 基线逐条一致，新筛选组件无诊断。构建保留已有 Sass、Browserslist、混合导入及大 chunk 提示。
- 构建输出 `/tmp/opentu5-task-filter-layout-build-20261031`，日志 `/tmp/opentu5-task-filter-layout-{tests,build}.log`。7205 开发服务的最新组件响应包含本次范围输入结构，未做页面点击/截图/视觉测试。人工验收需确认宽抽屉下第一行对齐、日期单行分组，拖窄抽屉后合理分行且控件可操作。
- 本次仅显示调整，更新现有 QA，不新增 DOC；未提交、推送或调用生成服务，前几轮本地改动保留。

## 效果与范围

2026-10-31 在任务队列搜索区增加“创建日期”的开始/结束日期。“历史”页也提供搜索和日期，可组合筛选，支持同一天和单侧日期；按本机时区，包含结束日全天，以创建时间为准。清除日期保留关键词，切换页签保留筛选。历史标签的数量仍表示全部归档任务数，不是筛选后的匹配数。

最近任务仍使用现有最近 100 条记录，历史查询直接使用本地 IndexedDB 的 `createdAt` 索引范围，匹配关键词、归档状态和用户可见性后才计算分页。每页 30 条，只有确认存在下一条匹配记录才显示“加载更多”。筛选变化从第一页开始，丢弃之前查询和加载更多的迟到结果。读取请求失败时保留已加载结果并允许重试。

没有新增服务器接口、依赖、配置、数据库版本或数据迁移。只读任务记录，不修改归档状态、结果和任务操作。日期控件使用原生日期输入和关联标签，搜索沿用 TDesign；原生日期选择器的外观由操作系统/浏览器决定。设置仅存在当前组件会话，不写入本地偏好。使用说明更新在任务队列手册，不另建 DOC。

## 环境与实际验证

- 目录：`/Users/lkj/Desktop/working/opentu5`，分支 `develop`，HEAD `5ef5e7da`。保留前两轮参考图入画布及多图排列的本地修改，未提交、推送或创建 PR。
- macOS、Node v26.8.1、pnpm 10.21.0、Vitest 3.2.4/JSDOM 与 fake-indexeddb。使用合成数据，不读取实际用户浏览器数据库。
- 日期/关键词辅助函数、归档存储、历史列表和实际父组件接线共 5 文件、34 项通过。覆盖超过 100 条近期记录之前的旧日期、起止边界/单日/单侧日期、关键词组合、匹配后分页、准确 `hasMore`、内部任务排除、清除筛选、初始/加载更多失败重试、连续滚动防重复、快速切换筛选后丢弃旧响应、角色视图进入历史及当前任务日期过滤。

```sh
# 在 packages/drawnix 执行
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/utils/task-queue-filters.test.ts \
  src/services/task-storage-reader.test.ts \
  src/components/task-queue/ArchivedTaskList.test.tsx \
  src/components/task-queue/TaskQueueSearchFilters.test.tsx \
  src/components/task-queue/TaskQueuePanel.filters.test.tsx --silent
```

- `TZ=America/Los_Angeles NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts src/utils/task-queue-filters.test.ts --silent` 6 项通过，补查 2026-11-01 夏令时结束日的下一本地午夜边界，避免按固定 24 小时计算漏掉末尾记录。
- 根目录 `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 和 `pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit` 通过。
- 本次源码及测试 ESLint 中 2 errors、29 warnings 均与 HEAD 同路径 stdin 基线逐条一致，无新增诊断。两项既有错误为 TaskQueuePanel 与 task-storage-reader 静态导入 `@aitu/utils` 触发 Nx lazy-loaded library 规则。未修改规则或进行无关重构；新组件、辅助函数及新测试无诊断。
- Web 应用构建通过（48.12 秒）：`pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu5-task-date-build-20261031`。保留既有 Sass、Browserslist、混合导入及大 chunk 提示。测试/工具有 `.npmrc` 占位变量、Node 弃用提示。

## 未覆盖项与人工验收

按用户规范未执行页面点击、视觉/截图或真实浏览器 E2E；未执行真实供应商、全仓库测试、Service Worker 独立构建、Windows/跨浏览器与大规模历史性能基准。父组件测试执行实际状态/筛选/展示分支，但替换了重型媒体运行时，不视为页面验收。日期索引可跳过范围外记录；大量关键词匹配仍需遍历选定范围内的历史记录。

人工验收：打开任务队列进入“历史”，选择一个较早日期（同一天可填相同起止日期），应直接显示该日任务；再输入提示词片段，只保留同时匹配的记录。点击“加载更多”检查仍在所选范围，快速换日期不应混入旧结果。“清除日期”应保留关键词，切回“全部/已完成”应保留筛选。只清除筛选不会删除任何任务。回滚可撤销本次代码，不需要清理数据库。
