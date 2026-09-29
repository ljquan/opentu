# 工作流单一应用合并 QA

## MJ 多图结果保留（2026-09-27）

- 效果与范围：工作流画布首次生成、重试、蒙版/角度编辑和插件图片写回保留每次请求返回的全部图片；刷新恢复使用同一缓存和槽位合并逻辑。第一张沿用原槽位 ID，附加结果使用独立 ID，保留其他输出和已选主图，更新结果数量、主图元数据与整体状态。
- 上游解析：复用 OpenTu MJ 适配器的 `imageUrls` 列表，过滤无效项，兼容没有 `imageUrl` 的成功响应；列表不可用时使用有效的单张 `imageUrl`。只返回合图不自动分割，也不保证每次一定返回四张。
- 恢复边界：继续依赖原任务与渠道；缓存结束后重新校验账号、节点、槽位和尝试 ID，迟到结果不能写回已删除目标或新尝试。下载/缓存失败不写入不完整的成功图片组，保留持久任务供后续查询与缓存；不会因恢复重新 POST 生成。
- 环境：本地 Node.js 26.8.1、pnpm 10.21.0、Vitest/JSDOM，虚构 URL/凭据及模拟网络，不访问真实渠道或浏览器数据。
- 已执行：`pnpm test:workflow --run`，36 个文件、399 项通过；在 `packages/drawnix` 执行 `pnpm exec vitest run --config vitest.config.ts src/services/__tests__/mj-image-adapter.test.ts`，8 项通过；工作流 TypeScript 检查通过。
- 覆盖：四图首次 API 返回、仅列表响应、空/无效地址、单张合图回退、恢复查询零重复 POST、缓存乱序完成保持顺序、下载失败/取消、持久化快照往返、单图编辑节点转多图、已完成/待处理/失败兄弟图片保留、删除槽位不复活。
- 构建与静态检查：`pnpm exec tsc --noEmit --incremental false -p packages/drawnix/src/workflow-mode/web/tsconfig.json`、`git diff --check` 通过；`pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu4-mj-multi-build-20260927` 通过。定向 ESLint 仍有 `project.tsx` 原有 `hideNodeToolbar` 空回调错误（HEAD 同样存在）和既有警告，不能称 lint 全通过。测试有既有 IndexedDB/localStorage 初始化告警；构建保留 Sass、混合导入和大包告警。
- 未执行：浏览器页面与视觉测试、真实 MJ 生成/计费请求、用户历史任务恢复和生产部署。人工验收：生成 MJ 后通过数量入口查看全部结果，再在待生成状态刷新并核对找回数量；对某一张重试，其他图片应保留，日志不能出现恢复引起的新生成请求。
- QA/DOC：更新本 QA、工作流 CHANGELOG 和两份 pending-test；已检查 todo，无本次对应待办需迁移。无新增接口、配置、依赖、迁移或部署步骤，不另建 DOC。回滚只撤回此多图处理修复，不清空本地任务/图片或提交记录。


## 图片刷新后消失与硬截止修复

- 范围：工作流本地/原生图片恢复与画布状态投影。取消本地图片任务年龄硬截止，原生同步图片每轮恢复使用独立查询窗口，移除重复外层计时。原任务 ID、远端 ID、原路由、凭据身份及持久化提交时间保留；恢复只查询，不重发生成。
- 画布：刷新后的等待占位保留动画，暂未查到结果、网络异常不显示失败卡；旧超时卡读取到 processing 后恢复等待。每个输出独立更新，已完成结果不减少，上游明确失败保存真实原因。异步图片查询 HTTP 错误与响应中的任务失败分开处理。
- 环境和数据：本地 Vitest/JSDOM、fake-indexeddb、虚构凭据和模拟供应商响应；没有读取浏览器真实数据库或进行付费重试。
- 实际结果：工作流 8 个文件 148 项通过（最终错误类型调整后，受影响 4 文件 121 项复验通过）；共享图片恢复服务 49 项通过；工作流 TypeScript 通过；Web Vite 生产构建通过，输出到 `/tmp/opentu4-refresh-build`；`git diff --check` 通过。
- 覆盖：30 分钟旧任务继续查询、pending 后再打开存储取回 success、网络错误仍 processing、原生查询超过 10 分钟和查询窗口到期后再恢复、远端 ID 只查询、明确失败持久化、原 Key 约束、删除/新尝试不被旧回调覆盖、部分成功与等待/失败共存。
- 静态检查：本轮涉及文件 ESLint 保留 1 个已有错误（`project.tsx` 的空 `hideNodeToolbar` 回调，HEAD 同样存在）及已有警告，未改无关工具栏行为；不能称全量 lint 通过。构建保留 Sass/CSS、混合导入、大块等既有警告；测试有既有 ConfigWriter 初始化 IndexedDB 告警，断言全部通过。共享测试首次误用相对配置路径未启动，改正工作目录后 49 项通过。
- 未执行：浏览器页面/视觉测试、真实供应商请求、用户截图中历史任务找回验收、生产部署。缺少持久 ID、原渠道/Key 或上游已清理结果的请求仍不能可靠找回。
- 人工验收：保持原渠道与 Key，打开原工作流画布并刷新；等待卡应保留并自动回填，不点击“重新生成”也能恢复。多图任务应保留已完成图片，失败只影响对应输出。超过原 15 分钟的可查询任务也不应立即显示本地期限错误。
- QA/DOC：更新本 QA、既有设计、CHANGELOG 和待验收记录；没有新增配置/依赖/迁移，不另建 DOC。既有 Agent/Skill TODO 无变化。

本轮命令（仓库根目录，共享服务命令在 `packages/drawnix` 运行）：

```sh
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts packages/drawnix/src/workflow-mode/web/tests/native-local-recovery.test.ts packages/drawnix/src/workflow-mode/web/tests/native-task-recovery.test.ts packages/drawnix/src/workflow-mode/web/tests/native-video-log-recovery.test.ts packages/drawnix/src/workflow-mode/web/tests/native-workbench.test.ts packages/drawnix/src/workflow-mode/web/tests/native-recovery-target.test.ts packages/drawnix/src/workflow-mode/web/tests/native-image-recovery-query.test.ts packages/drawnix/src/workflow-mode/web/tests/native-workflow-storage.test.ts packages/drawnix/src/workflow-mode/web/tests/native-local-models.test.ts
pnpm exec vitest run --config vite.config.ts src/services/__tests__/image-generation-recovery-service.test.ts
pnpm exec tsc --noEmit -p packages/drawnix/src/workflow-mode/web/tsconfig.json
pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu4-refresh-build
git diff --check
```

## 图片/视频刷新找回提示补充

- 画布图片和视频恢复使用本次页面恢复时间计时，初始提示为“网页已刷新，正在找回生成结果…”。恢复查询持续 5 分钟仍未取回时，切换为“已等待 5 分钟，仍未取回生成结果，请到日志中查找。页面会继续尝试找回。”；定时扫描和在途查询也会更新该提示，不中止查询、不重新提交。
- 文本和音频继续使用各自的结果待确认文案；已完成媒体、已删除槽位、新尝试和供应商明确失败不会被计时提示覆盖。旧视频任务 ID 和工作流图片/视频任务均覆盖。
- 本地验证：`native-recovery-target.test.ts` 21 项、相关恢复/工作台测试共 77 项通过；工作流 TypeScript 通过；`git diff --check` 通过。未执行浏览器刷新、截图视觉检查和真实供应商请求。

### 加载动画补充

- 图片、视频和多图等待槽位共用 40px 旋转加载图标，颜色跟随画布主题；5 分钟日志提示仍保留图标，成功和明确失败沿用终态展示。动画采用独立 CSS Module 并限制在工作流根节点，系统开启减少动态效果时保留静态图标和提示。未改变任务、查询、计时和存储逻辑。
- 实际验证：`pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts tests/native-recovery-target.test.ts tests/native-text-recovery.test.ts` 共 45 项通过；`pnpm exec tsc --noEmit --incremental false -p packages/drawnix/src/workflow-mode/web/tsconfig.json` 通过；`canvas-node.tsx` 定向 ESLint 无错误，保留 7 条原有逗号操作符警告。
- `pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu4-recovery-animation-build` 最终生产构建通过，保留既有 Sass、混合导入和大包警告；检查生成 CSS 确认工作流作用域、40px 尺寸、持续旋转关键帧和减少动态效果规则均存在。`git diff --check` 通过。
- 未执行浏览器页面、截图视觉测试、真实渠道请求或付费生成。人工验收：刷新未完成的图片/视频及展开多图，确认加载图标持续旋转，5 分钟后文案变化但动画继续，成功和明确失败后消失，并核对浅色/深色、缩放及减少动态效果。
- QA/DOC：更新本 QA、既有 CHANGELOG 和待验收记录；无新接口、配置、依赖或迁移，不新增 DOC；已检查既有 Agent/Skill TODO，无需调整。

## 工作流提交错误与刷新恢复补充

- 明确 HTTP 4xx 拒绝（排除超时/过早响应）保存失败及上游消息；网络中断、5xx、结果未知保持 processing，不按 Key 分组预判。图片请求包装保留 cause，恢复画布不再覆盖真实错误。
- 本地验证：工作流 Vitest 的 native-local-recovery、native-task-recovery、native-tuzi-parameters 三个文件共 27 项通过；工作流 TypeScript、git diff --check 通过。
- 覆盖：价格分组拒绝持久化与重载、网络/网关超时不误判、先 pending 后成功回填、恢复端点拒绝、原渠道约束、不重复 POST。
- 未执行：页面测试、真实付费生成、截图中历史任务的线上找回。消费日志无法单独证明本地已有可恢复结果；缺少原 Request ID、原凭据或上游已经清理的记录仍可能无法找回。查询期限后续修复见上节，不自动重新生成。
- 本轮更新既有 QA、CHANGELOG 和待验收记录；未新增接口或配置，无需独立 DOC；现有 Agent/Skill TODO 无变化。

## H3 提示词增强错误定位（2026-09-26）

- 截图错误与 Tuzi 网关响应解析错误一致；尚未取得该次上游响应，无法确认具体原因。公开 pricing 仍描述独立 Context-IR 任务，本地 Tuzi 的 `use_context_ir` 扩展文档标记为待发布，故保留原协议。
- 本次仅补齐“提示词增强提交/查询失败”的阶段提示，保留上游消息；增强失败后不提交视频、不自动重试。上游故障未解决，仍需对应请求的脱敏网关日志。
- 工作流 H3 11 项、共享 H3 19 项测试通过；TypeScript、差异检查通过。未执行页面测试、真实生成或生产构建，本次仅修改错误文案及回归断言。

## 范围与环境

工作流并入 OpenTu 的 React 18/Vite 6 运行时；覆盖直接生成适配器、模型同步、路由、存储格式、版本回退、插件生命周期、样式隔离及生产资源路径。环境为 macOS、Node 26.8.1、pnpm 10.21.0、TypeScript 5.4.5、Vitest 3.2.4。验证均在本地进行，没有使用真实渠道凭据或发起付费生成。

## 单一应用合并阶段结果

| 检查 | 结果 |
| --- | --- |
| 工作流测试 | 合并阶段 12 个文件、67 项通过；凭据补充后的最新结果见下节 |
| 宿主定向测试 | 合并阶段 5 个文件、97 项通过；包含在下列宿主完整结果中，不重复累计；本轮不同定向集合见下节 |
| 宿主完整目录 | 206 项通过、2 项原有失败 |
| 普通画布相关回归 | 工具栏、延迟入口、PPT 恢复和渠道设置，4 个文件、13 项通过 |
| 工作流、Drawnix、Web 类型检查 | 均通过 |
| 生产应用及 Service Worker 构建 | 均通过 |
| 产物校验 | 4 种入口资源路径、1416 条工作流 CSS 规则作用域、图标、插件清单、懒加载边界均通过 |
| 启动包预算校验 | 通过，入口依赖无块循环 |
| OpenSpec strict validation | 通过 |
| 改动文件 ESLint | 8 个错误、74 个警告；错误均可在 HEAD 原始源码按同一配置复现，没有新增错误。3 个警告为仓库默认忽略根脚本/配置，脚本已实际执行 |
| Git 差异空白检查 | 通过 |
| 开发 HTTP/HMR 模块检查 | 7204 的工作流深层地址及插件清单返回 200；工作流源码响应包含 React Refresh 和 `import.meta.hot` 标记。未通过真实浏览器验证热更新后的画面 |

工作流回归覆盖成功与错误返回、空/错误类型结果、取消及迟到结果、页面关闭/退出模式、无效参数和不支持的素材、凭据错误脱敏、保留用户清空的默认模型、同步失败/卸载、路由参数和历史状态、旧格式记录读写、发布记录在线/离线回退、旧插件地址和插件退出清理。

存储回归使用 localforage 的本地存储驱动模拟旧记录，确认数据库/store 名及序列化格式不变；没有读取用户浏览器 IndexedDB，也不代表真实浏览器所有历史资产已完成验收。

## 渠道凭据自动填入补充验证

本轮仅补充本地渠道编辑器的 URL/API Key 读取和分组选择，不改变原生模型目录及宿主调用路由。前置条件为 OpenTu 设置已保存、分组已启用并填有 HTTP(S) URL/API Key；兼容范围是无额外请求头的 Bearer + OpenAI/Gemini 协议。读取无需拉取模型或发送供应商请求。保存写入既有本地渠道配置，取消不保存，宿主配置不回写。

| 检查 | 本轮结果 |
| --- | --- |
| 工作流全套 | 14 个文件、77 项通过，含新增 5 项选择逻辑和 5 项编辑器组件测试 |
| 宿主定向 | 5 个文件、98 项通过，含新增 4 项凭据读取；其余为模型、生成及宿主挂载回归 |
| 工作流、Drawnix、Web 类型检查 | 均通过 |
| 应用生产构建 | 通过，保留既有 Sass、CSS、导入及大块警告；本轮未改动或重跑 SW |
| 本轮 6 个代码/测试文件 ESLint | 0 错误，2 条已有非空断言警告 |
| OpenSpec strict validation | 通过 |
| Git 差异空白检查 | 通过 |

覆盖自动带入当前分组、同 URL 不同 Key 的独立选择、无模型目录分组、禁用或缺字段分组、特殊鉴权排除、URL 与协议不匹配时不填入、已有 Key 保护、初始化等待、手动输入优先、取消及迟到结果忽略、读取失败后仍可手填和错误脱敏。保存后的 URL/Key 已通过本地请求配置解析验证。原生模型同步的无密钥断言继续通过。

组件测试使用虚构凭据、JSDOM 和真实 Ant Design 控件，替代 JSDOM 不支持的布局测量及 ResizeObserver；不代表实际页面布局验收。第一次误用宿主测试配置运行工作流用例，因缺少工作流 storage setup 失败；改用既有工作流 Vitest 配置后通过。测试适配中发现的 JSDOM CSS/ResizeObserver 缺口和空回调 lint 问题均已修正。未读取用户浏览器配置、未发起真实供应商请求或付费生成，未进行浏览器页面测试；上一阶段全量宿主和全量改动 lint 的基线失败仍单独保留。

人工验收：打开“工作流 → 配置 → 默认渠道 → 编辑”，空 Key 自动填入，已有值保留；用“从 OpenTu 自动填入”切换分组，确认 URL/Key 成对更新、保存后生效，取消后原配置保留。后续修改宿主 Key 时，本地副本须重新选择分组导入；特殊鉴权继续用原生托管渠道。本轮复核 TODO，Agent SDK 与 Skill 管理事项无变化；已更新既有集成说明和待验收记录，无需另建 DOC。

本轮宿主与 lint 命令（其余沿用下方命令）：

```sh
pnpm exec vitest run --config packages/drawnix/vite.config.ts src/workflow-mode/host/native-provider-credentials.test.ts src/workflow-mode/host/native-models.test.ts src/workflow-mode/host/native-models-runtime.test.ts src/workflow-mode/host/native-generation.test.ts src/workflow-mode/host/WorkflowModeHost.test.tsx
pnpm exec eslint packages/drawnix/src/workflow-mode/host/native-models.ts packages/drawnix/src/workflow-mode/host/native-provider-credentials.test.ts packages/drawnix/src/workflow-mode/web/src/integration/opentu-channel-credentials.ts packages/drawnix/src/workflow-mode/web/src/components/layout/channel-editor-drawer.tsx packages/drawnix/src/workflow-mode/web/tests/native-channel-credentials.test.ts packages/drawnix/src/workflow-mode/web/tests/native-channel-editor.test.tsx
```

## 可重复命令

在 OpenTu 仓库根目录运行：

```sh
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts
pnpm exec vitest run --config packages/drawnix/vite.config.ts src/workflow-mode/host
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config packages/drawnix/vite.config.ts src/components/toolbar/bottom-actions-section.test.tsx src/components/startup/DrawnixDeferredRuntime.ppt-recovery.test.tsx src/components/startup/DeferredAIInputBar.test.tsx src/utils/__tests__/settings-manager.test.ts
pnpm exec tsc --noEmit -p packages/drawnix/src/workflow-mode/web/tsconfig.json
pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json
pnpm exec nx run web:typecheck
pnpm exec vite build --config apps/web/vite.config.ts
pnpm exec nx run web:build-sw
node scripts/validate-workflow-runtime.cjs
node scripts/validate-startup-bundle.js
npx --yes --package @fission-ai/openspec openspec validate merge-workflow-into-opentu --strict
git diff --check
```

产物校验使用 JSDOM 执行入口中的资源基址初始化片段以及 PostCSS 解析产物；不启动浏览器、不运行应用页面、不发送网络请求。当前没有已编译本地插件，产物清单为 `[]`；实际插件 JS 导入仍待人工确认。

ESLint 使用仓库配置检查本次新增/修改的 TS、TSX、JS 文件，并通过 `ESLint.lintText` 将 `git show HEAD:<path>` 原始源码按相同路径和配置对比。剩余 8 个错误为宿主既有循环依赖/多余类型注解，以及工作流既有 `useSkill` 命名、常量循环、不规则空白、空回调；不通过关闭规则或改无关业务代码掩盖错误。

## 已知问题与未执行项

- 完整宿主目录的 `native-parameters.test.ts` 有两项原有失败：MiniMax-H3 参数缺少 consumer 映射，覆盖清单出现 `UNMAPPED`。测试和它依赖的模型目录/consumer/coverage 源码与 HEAD 一致，本次不改变供应商参数语义；不能报告全量测试通过。
- 构建有现有 Sass 弃用、CSS `:export`、Browserslist、静态/动态混合导入和大块体积警告。未给出性能或实际页面视觉保证。
- 未执行页面自动化、点击、截图、视觉回归、真实生成、真实插件下载、WebDAV 同步及生产部署。
- 自定义插件在主应用上下文中执行，部署 CSP 需允许现有插件加载方式使用的 `blob:` 脚本；仓库开发/预览及 Netlify 配置已更新，自建代理应同步核对。插件应仅安装可信来源，退出时依赖插件提供的 cleanup 清理自定义副作用。
- `/workflow/*` 要求静态服务器 SPA fallback；入口会将这些深层地址的相对资源基址设为 `/`。非根路径部署的工作流没有纳入本次验证。
- 原生生成在退出模式时取消本地等待并传递 AbortSignal，不能保证撤销供应商远端任务或计费。
- 本次没有数据迁移；跨域名/端口的旧数据受同源限制。打开宿主渠道设置会卸载工作流并取消在途原生请求，关闭后重新挂载，临时表单/弹窗状态可能重置。

## 人工验收

### MiniMax-H3 输入对齐补充验证

- 范围：工作流原生模型输入声明与 PR #275 对齐；无参考视频时支持首帧/尾帧最多 2 张，带参考视频时支持最多 9 张参考图和 3 个参考视频，参数面板显示上限，超限提示显示数量限制。
- 命令（在 `packages/drawnix`）：`../../node_modules/.bin/vitest run src/services/video-api-service.test.ts src/services/minimax-h3-video-workflow.test.ts src/workflow-mode/shared/native-parameters.test.ts src/workflow-mode/host/native-generation.test.ts src/workflow-mode/host/native-parameters.test.ts --config vitest.config.ts`。
- 结果：219 项通过、2 项失败。新增 H3 边界测试通过：空素材、首尾帧双图、参考图加三个视频允许；三图、四视频、音频拒绝。两项失败为原有 H3 参数消费者映射缺失及 UNMAPPED 断言，仍未解决；不是本次参考素材声明改动。
- Drawnix 类型检查通过。未执行页面测试、真实供应商请求或付费生成。截图中的两张图现在按首帧/尾帧发送；刷新工作流后读取新的视频能力声明。

### 页面验收清单

- 工作流主按钮（如“新建画布”、生成按钮）在未悬停状态下应保持白色文字；主应用全局样式不得覆盖按钮文字颜色。

1. 在普通画布编辑内容和视口，进入工作流再返回，确认内容、视口、快捷键、主题和原 URL。
2. 在工作流切换画布、工作台、素材和配置，验证前进/后退与深层地址刷新；修改工作流源码后确认当前开发页面热更新。
3. 检查深浅主题、各类弹层、已有画布/素材/历史的读取与导入导出；不清空浏览器数据。
4. 使用已确认可调用的渠道人工验收生成与取消，核对供应商真实任务状态。启用一个可信插件，退出并重新进入工作流，确认插件恢复且普通画布无残留样式。

运行方式、接口和维护说明见 `packages/drawnix/src/workflow-mode/OPENTU-INTEGRATION.md`。由于涉及运行方式与跨模块回归，本次更新既有集成文档并新增本 QA；没有另建根目录 DOC.md。未提交、未推送、未创建 PR、未部署。

## 刷新恢复修复验证（2026-09-26）

本轮针对“生成中刷新后任务丢失”和灰色说明框完成本地修复。图片、视频、画布和文档批次均在提交前保存稳定任务身份；刷新后仅按原任务 ID 查询，账号或 Key 变化时保留“结果待确认/等待原配置”，不自动重发。画布关键快照改为可等待写入，并校验节点、输出槽位和尝试 ID，删除或新尝试不会被迟到结果复活。Ant Design 信息/警告说明框使用明确的浅色和深色背景、边框及文本颜色。

验证结果：工作流 Vitest 27 个文件、152 项通过（含本地恢复 4 项、目标校验 5 项）；随后新增原生生命周期 4 项单独通过；工作流和 Drawnix TypeScript 检查通过；应用 Vite 生产构建通过；`git diff --check` 通过；图片恢复服务 49 项测试单独通过。未执行浏览器页面测试、真实渠道查询或付费生成。宿主服务组合测试在并行构建时曾出现一个 5ms 超时用例不稳定；单独重跑图片恢复文件 49 项通过，四个服务文件以 `--maxWorkers=1` 重跑 121 项全部通过。未执行宿主全仓库测试。

覆盖项：同一 ID 并发 claim 只能成功一次；重开 IndexedDB 不恢复提交资格；写入暂停/回调异常阻断和回滚；换 Key 后零查询；同步中断不重发；恢复成功结果可再次读取而不重复 GET；删除节点/输出、旧尝试、换账号均拒绝回填。存储测试使用 fake-indexeddb，协议测试使用虚构 Key 和模拟网络。

限制：未完成所有入口的组件卸载/重挂故障注入矩阵，也未模拟真实多浏览器进程。普通同步文本、无查询契约的第三方接口和脚本中断只能保留待确认状态。图片/媒体 URL 可能由上游过期；清除站点存储后无法恢复。自动查询有原任务期限，不会因为超时重新提交。灰色说明框仅完成主题代码、类型及构建检查，未宣称视觉验收。

补充：最终生产构建再次通过（1m27s）；新恢复服务及目标校验 ESLint 为 0 错误、3 条非空断言警告。OpenSpec CLI 不在当前 PATH 中，严格验证未执行，未将旧文档验证结果充作本次通过。

## 工作流模型来源统一（2026-09-26）

根据用户确认，工作流只使用渠道页配置的本地渠道及 Tuzi 固定渠道。修复原先渠道页隐藏宿主渠道、模型下拉却继续合并宿主模型的问题。初始化不再读取宿主模型目录；旧持久配置和导入配置中的托管渠道在工作流配置中清理。本地模型列表、Key 和手工清空的默认值保留；旧托管默认模型仅在同名且同能力的本地渠道唯一匹配时迁移，否则清空，不猜测渠道。

验证：工作流 Vitest 28 文件、160 项通过；其中模型来源专项 7 项覆盖无自动获取、本地凭据/模型保留、能力过滤、唯一匹配迁移、歧义/缺失清空、空列表刷新和幂等。工作流 TypeScript 与 `git diff --check` 通过。未执行浏览器、真实 Tuzi 拉取、付费请求或本轮生产构建。

## 图片记录计时与待确认状态（2026-09-26）

未完成记录按创建时间实时显示“已等待”，刷新后不依赖初始 `durationMs=0`；完成记录显示保存的耗时。恢复发现结果时保存从创建到本地确认结果的时长（并非供应商计算耗时），清理旧失败数量，已打开的历史预览随恢复结果更新。请求异常保留待确认卡片和呼吸动画，不推断供应商失败；待确认记录不显示“成功 0”或失败数量。

验证：工作台定向测试 7 项通过，其中新增 3 项覆盖刷新等待计时、完成耗时固定、部分结果保留及待确认投影。工作流 TypeScript、差异检查通过；ESLint 无错误，保留已有未使用常量和 Hook 依赖警告。未做页面测试或真实生成。

## 本地渠道四类模型参数对齐（2026-09-26）

- 范围：工作流本地渠道复用 OpenTu 内置模型定义、参数校验和适配器契约；101 个内置模型（36 个视频、65 个其他类型）逐项检查。只使用渠道页配置的 URL/Key，不导入隐藏宿主渠道，不改变手动获取模型行为。
- 视频：MiniMax-H3 使用 V2 和可选提示词增强；Kling、Seedance 1/2、HappyHorse 复用专属提交器；Sora/Veo/Omni 沿用 OpenTu 通用视频字段与别名规则。模式切换使用 OpenTu 条件参数，Kling 保留首尾帧输入。
- 图片：按当前渠道推断兼容协议，区分官方与 Tuzi GPT Image；编辑时选择对应绑定。Gemini 使用对应 OpenAI/Google 协议，Seedream、MJ、Flux 使用专属适配器。专属协议优先于通用图片绑定。上游不支持的字段在提交前拒绝。
- 音频：Suno 使用现有音乐/歌词/续作字段及提交查询逻辑，保留全部有效音频片段。文字复用 OpenTu 参数定义，将 temperature/top_p/max_tokens 映射到工作流既有 Responses 或 Google 请求；未替换为宿主聊天执行器。
- 参数按渠道/模型/能力保存。MJ/Flux/Suno 获得远程 ID 后持久化，刷新只查询原任务；切换当前模型后恢复仍使用保存的原渠道与 Key。未知/脚本模型维持原逻辑；Kling O1/O1 Edit 缺少适配器时明确不可用。无原生 TTS 新增实现，不按模型名后缀自动开启异步图片协议。
- 测试环境：macOS，Node 26，模拟 fetch/axios、fake-indexeddb；不使用真实密钥、不产生付费请求。
- 实际验证：工作流全套 31 文件 302 项通过；共享适配器/参数/Gemini 定向 11 文件 250 项通过。追加 video-binding-utils 17 项中 16 项通过、1 项原有失败：Sora web 模式测试期待 10/15 秒，当前模型目录仅返回 10 秒；将该模块替换为 HEAD 原码在临时副本中重跑仍复现同一失败，未改变此处产品规则。覆盖参数默认值、无效参数零提交、专属请求路径/字段、官方与 Tuzi 编辑差异、原生 Google 路径、MJ/Flux 轮询、歌词/多结果、素材数量和原渠道恢复。
- 工作流 TypeScript、生产 Web/Service Worker 构建和 git diff --check 通过。定向 ESLint：3 个错误、65 个警告；3 个错误在 HEAD 原文件同配置复现（两处既有静态/懒加载模块边界、async-image 的 prefer-const），本轮未新增错误。
- 命令：`pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts`；`pnpm exec tsc --noEmit -p packages/drawnix/src/workflow-mode/web/tsconfig.json`；`pnpm exec nx build web --skip-nx-cache`。共享 Vitest 在 packages/drawnix 下执行，覆盖本节列出的适配器和参数模块。
- 未执行：页面测试、真实供应商生成及计费/输出效果验收。目录和模拟请求通过不代表渠道已开通全部模型。既有环境变量、IndexedDB、Sass、sourcemap、包体与混合导入警告仍存在。
- 人工验收：同一工作流切换图片、视频、音频、文字模型应显示各自参数；切回保留选择；官方/Tuzi GPT 字段不同；不支持的协议或字段应明确提示。付费验收须使用已开通的渠道。
- QA/DOC：更新本 QA、既有待验收记录及 CHANGELOG，无新增独立文档。未提交、推送或发布。

## 文本、视频和音频中断恢复补齐

范围：工作流画布文本生成与重试、视频工作台和画布恢复、本地 Suno 音频、原生媒体恢复桥。环境为当前 macOS 工作区、fake-indexeddb、模拟 fetch/axios；只做本地修改和非浏览器测试。7204 监听进程的 cwd 核对为本仓库 `apps/web`，未重启服务，未提交或推送。

实现与验收边界：

- 本地文本流先持久保存片段再显示；Responses 记录响应 ID，刷新只按原路由和原 Key 读取。流被截断不当作成功；完成、明确失败/取消/不完整、查询不可用分别处理。文本多结果保留全部槽位、部分内容及主文本选择，未完成内容仍显示状态。
- 视频查询网络错误保持 pending，占位继续显示状态；持久任务统一走画布恢复扫描，旧视频 ID 保留查询入口；原生视频/音频查询超时保留 processing，明确上游失败才写 failed。
- 本地音频和文本不再按原任务年龄停止查询；歌词恢复为文字，不误当音频 URL。原 Key/账号不匹配不发查询，旧账号的迟到查询结果不回填。
- 查询没有重复生成 POST。未改变模型、Key 分组、Responses 的 store/background 设置或新增后端。没有远端标识或查询契约的同步文本、同步音频、脚本不能保证取回未收到的结果；Gemini 和原生同步文本尤其适用这一限制。上游断开即取消、响应保留期、查询接口可用性仍需真实渠道确认。

实际验证：

| 检查 | 结果 |
| --- | --- |
| 工作流恢复/协议/目标测试 | 6 文件首次最终回归 88 项通过；补充 JSON 明确失败场景后，文本文件 16 项通过，其余 73 项已通过，共 89 个唯一用例 |
| 共享视频/音频服务 | 2 文件 22 项通过，包括恢复首查失败、轮询中明确失败不重试 |
| 工作流 TypeScript | 通过；最后的文本终态处理及空值收窄后再次通过 |
| Vite 生产构建 | 通过，输出 `/tmp/opentu4-text-video-build`；保留 Sass/CSS/大块及混合导入警告 |
| 定向 ESLint | 1 个原有错误、84 个警告；错误为画布空回调，在 HEAD 的同一实现中存在，本轮未修改 |
| 空白检查 | `git diff --check` 通过；新增/未跟踪文件另行检查 |
| OpenSpec strict | 本轮无法重跑：本机和 pnpm 环境没有 openspec 命令；仅更新既有已批准方案的 design/tasks，未改变 spec 格式 |

工作流命令：

```sh
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts packages/drawnix/src/workflow-mode/web/tests/{native-text-recovery,native-task-recovery,native-local-recovery,native-recovery-target,native-video-log-recovery,native-api}.test.ts
pnpm exec tsc --noEmit -p packages/drawnix/src/workflow-mode/web/tsconfig.json
pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu4-text-video-build
git diff --check
```

共享服务命令（工作目录 `packages/drawnix`）：`pnpm exec vitest run --config vite.config.ts src/services/video-api-service.test.ts src/services/__tests__/audio-api-service.test.ts`。

已覆盖：部分文本与全文、流结束缺少终态、JSON 响应、失败/取消/不完整、查询 404/503、错误响应 ID、换 Key、换账号及迟到结果、原任务超过旧等待期限、媒体查询超时后成功、音频明确失败与歌词、多输出保留及不重复 POST。JSDOM 模块初始化仍有既有 ConfigWriter/IndexedDB 提示，测试中的任务库使用独立 fake-indexeddb。初次视频成功恢复用例遗漏媒体下载 mock，触发保留域名 example.test 的失败下载；已补齐模拟错误，最终测试不访问该地址。

未执行：真实浏览器点击/刷新、视觉验收、真实供应商查询及付费生成、部署。不能用本地测试证明用户之前的具体任务已找回。人工验收：在文本收到一部分、多个文本仅部分完成、视频或音频尚未完成时刷新原页面，确认任务和已有内容仍在；支持查询的渠道在完成后应回填原位置；不支持查询的文本应保留片段并明确提示限制。

QA/DOC：更新本 QA、现有恢复 design/tasks、两份待验收文档和 CHANGELOG；复核 TODO，Agent SDK/Skill 事项无变化，不另建 DOC。回滚应仅撤回本次逻辑，保留 IndexedDB 任务与已保存片段，不能清空提交标记或重新发送旧任务。

## 文本查询不可用时持续转圈修复

用户截图显示 `Invalid URL (GET …/responses/…)`。已确认之前把这类明确不支持查询的响应也作为暂时错误，每次恢复扫描重复 GET 并显示 loading。修复只影响文本查询错误分类、持久恢复标记及画布状态投影，不改变生成协议、Key 分组或请求超时。

- `Invalid URL (GET …/responses/…)` 的 200 错误体/4xx 响应，以及 405/501，保存该任务的 `textRecoveryUnavailable` 标记；重复扫描和重建存储连接后均不再 GET，不自动生成新 POST。画布改为静态说明，已收到文本、原任务和已完成兄弟项保留。原任务不标 failed，原执行者迟到保存的完成结果仍能读取。
- 普通 404、503、网络错误仍保留原有查询行为；账号切换后的响应不能写入不可恢复标记。无查询标识的文本也以静态说明显示。界面不再把长接口地址挤在加载框中。
- 非浏览器验证：`native-text-recovery` 22 项、`native-recovery-target` 17 项、`native-local-recovery` 18 项，共 57 项通过；工作流 TypeScript 通过。测试覆盖截图错误、再次刷新零重复 GET、零额外生成 POST、部分文字与兄弟结果保留、迟到完成结果、普通查询错误兼容和账号隔离。
- 命令：`pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts packages/drawnix/src/workflow-mode/web/tests/{native-text-recovery,native-recovery-target,native-local-recovery}.test.ts`；`pnpm exec tsc --noEmit -p packages/drawnix/src/workflow-mode/web/tsconfig.json`。Vite 构建通过，输出 `/tmp/opentu4-text-query-build`，保留原有 Sass/CSS、混合导入及包体警告。定向 lint 为 1 个原有错误、76 个警告；错误是画布的空回调，同一实现在 HEAD 存在。`git diff --check` 及新增/未跟踪文件空白检查通过。
- 未读取用户浏览器任务库，未执行页面/真实渠道验收或付费生成，不能宣称截图中未返回的全文已找回。服务仍由本工作区 `apps/web` 的原 Vite 进程提供，未切换分支或重启。
- 已更新现有恢复设计、待验收文档及 CHANGELOG；TODO 中 Agent SDK/Skill 事项无变化，无需新建 DOC。人工验收：打开原画布，首次识别该查询错误后应停止转圈，再次刷新应保持静态说明；若此前收到文字应继续可见。


## 代码审查修复与边界回归

- 范围：已受理请求的本地保存失败与重发保护；工作流/批量任务不被普通队列重复执行；原账号/渠道校验；空结果、部分图片缓存失败、历史图片恢复；中文组合输入与外部更新冲突；Gemini 异常结束保留末段文本；插件加载/停用竞态、临时视频持久化、路由 state 及返回画布状态。文档批量保护见同目录 `qa-document-batch-generation.md`。
- 关键决定：收到远端 ID 后的存储回调失败标记为 `SUBMISSION_PERSISTENCE_FAILED`，保留待确认与已知 ID，禁止同任务自动重发；这不保证供应商侧撤销或零计费。缺失可查询标识/原渠道时明确提示无法安全恢复，不伪造成功结果。
- 环境：本地 macOS、Node 26.8.1、pnpm 10.21.0、Vitest/JSDOM/fake-indexeddb，模拟供应商和虚构凭据；保留工作区原有未提交改动与运行服务。
- 实际结果：工作流全套 37 文件、455 项通过（`--maxWorkers=2`）；共享服务与宿主定向 9 文件、252 项通过。最终媒体执行器完整 24 项通过，含视频回调等待保存的成功/失败 2 项；这些用例与整体集合重叠，不相加。工作流与 Drawnix TypeScript 检查通过；Vite 应用生产构建通过，输出 `/tmp/opentu4-ocr-fix-build`；差异空白检查通过。
- 覆盖：已受理后保存失败、取消/凭据切换发生在持久化 claim 期间、原 ID 只查询、错误与未知结果分类、MJ 无效主 URL、多图缓存部分失败/目标删除清理、IME 期间外部内容替换、同 URL 不同 history state、音频轮询取消后的定时器释放、Gemini STOP 与异常结束原因。新增容量限制及导出失败清单有独立边界断言。
- 测试修正与环境：MJ 测试不再推进所有后台定时器，仅推进所需轮询时间。高并发与构建同时运行时出现超时及后续模拟污染；降低测试并发后全套通过，未增加产品或测试超时。测试仍有既有 IndexedDB/localStorage 初始化警告。生产构建有 Sass/CSS、混合导入与大块警告。
- 静态检查：修改代码定向 ESLint 共 8 错误、239 警告；8 个错误均在修复前快照以同配置复现（模块边界、prefer-const、既有空回调/空白字符/正则规则）。未为此次修复重构无关代码，不能称 lint 全通过。
- 审查边界：既有 OCR 报告含 59 条建议，147 文件完成审查、10 文件审查失败，不代表完整无遗漏审计。React 18 ref 类型、已存在的 H3 参考素材映射、刻意隐藏的宿主导航等建议未确认缺陷，不按建议机械改动；弹层裁剪仍需真实页面验证。没有扩大本地可信插件脚本的权限边界。
- 未执行：浏览器页面/真实输入法/视觉测试、真实供应商或付费生成、生产部署、完整跨标签页崩溃窗口及最大内存压力测试。缺少 ID、上游结果过期、存储持续不可用仍可能无法找回；异步取消不能保证撤回供应商任务。插件生命周期和返回画布快照没有专门页面验收。
- 人工验收：使用测试渠道生成后刷新，确认仍绑定原任务；切换 Key 后旧任务应提示等待原配置。多图恢复不能覆盖其他已完成槽位，组合输入时切换节点不应回写旧文字；插件快速开关、返回画布和主题位置另行检查。
- QA/DOC：更新现有两份 QA、批量使用说明、CHANGELOG 和双语待验收清单；已检查 Agent SDK/Skill TODO，无需变更。不新增依赖、数据库版本或部署步骤，无提交、推送、PR 或上线操作。回滚应仅撤回本次增量，保留用户数据及未知受理任务，不清空缓存/数据库。

本轮复现命令（共享测试在 `packages/drawnix` 目录运行）：

```sh
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts --maxWorkers=2
pnpm exec tsc -p packages/drawnix/src/workflow-mode/web/tsconfig.json --noEmit
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu4-ocr-fix-build
# 以下在 packages/drawnix 运行
pnpm exec vitest run --config vitest.config.ts src/services/__tests__/async-image-api-service.test.ts src/services/__tests__/audio-api-service.test.ts src/services/__tests__/mj-image-adapter.test.ts src/services/__tests__/seedance2-adapter.test.ts src/services/__tests__/task-queue-service-image-retry.test.ts src/services/__tests__/document-batch-task-storage.test.ts src/services/__tests__/media-executor.test.ts src/services/video-api-service.test.ts src/workflow-mode/host/native-generation.test.ts
pnpm exec vitest run --config vitest.config.ts src/services/__tests__/media-executor.test.ts
```
