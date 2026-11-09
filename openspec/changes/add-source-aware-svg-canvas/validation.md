# SVG 源文件适配验证记录

## 范围与环境

- 日期：2026-11-08；macOS，Node 26.8.1，pnpm 10.21.0。
- 工作区：`/Users/lkj/Desktop/working/opentu5`；分支 `dev/gpt-image-26-result-columns`；基于 `65636cbe2203d57b8a1c555f39e41527289cd749`（v1.2.7）。
- 用户已确认按源文件实际能力适配编辑和动画。本次仅本地实现和验证；没有提交、推送、更新 PR、部署或生成图片。
- SVG 实施前的备份位于 `/Users/lkj/.codex/backups/opentu5/before-source-aware-svg-20261108T093850Z`。其内 16 个既有 2.6 多结果排版文件与实施后 SHA-256 一致。
- 7205 原有开发服务 PID 94290 仍监听，HTTP GET 返回 200；没有重启服务。此检查不代表页面验收。

## 实际自动化结果

| 检查 | 结果与边界 |
| --- | --- |
| 相关回归测试 | 41 文件、1109 项全部通过；涵盖 SVG、2.6 参数/结果、多图排版、图片加载、缓存、备份及工作区逻辑 |
| 新增 SVG 测试 | 6 文件、53 项通过；使用实际画布历史模型，显式模拟浏览器几何/原生动画 API 和缓存边界 |
| TypeScript | `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`，退出 0 |
| 构建 | `pnpm exec vite build --config apps/web/vite.config.ts`，退出 0，42.40 秒 |
| 受影响文件 lint | 28 个 TS/TSX 文件，5 个错误、190 个警告；5 个错误逐项与 HEAD 对照一致 |
| 新增 SVG lint | 14 个 TS/TSX 文件，0 错误、0 警告 |
| 差异空白检查 | `git diff --check` 通过 |
| OpenSpec | CLI 未安装，未声称严格验证通过；人工检查 3 个 SHALL requirement、6 个有效 Scenario，结构符合 delta 格式 |
| 循环依赖 | 标准命令因现有 JSONC 配置被脚本的 JSON.parse 拒绝而中止；见下文诊断边界 |

新增测试覆盖：

- 内容：静态矢量、内嵌/defs 位图、SMIL、CSS、未使用 keyframes、零时长/只有延迟的声明、未使用动画定义，以及脚本/外部资源/实体和大小限制。
- 读取：只用原始 SVG，不用缩略图冒充；缓存缺失、非 SVG 内容、远程失败/超限、取消。
- 编辑：渐变、变换、必要分组、引用保留、滤镜范围和不支持结构回退；初始视口裁切、文字变长后的边界、宽高比例和留白。
- 画布：独立节点、原图保留、一次撤销/重做、序列化、缓存失败、插入失败回滚、画板切换及卸载取消。
- 动画：仅就绪后隐藏原图片并开放控制；暂停/继续保持源内容；减少动态效果、后台/离屏暂停与恢复、加载失败、旧地址读取结果丢弃、observer 清理。
- 保存：删除原节点后，内嵌媒体导出和现有同步的本地媒体收集仍包含原文件和片段；验证导入恢复及元数据，不进行远程同步。

## 可重复测试命令

在仓库根目录运行以下测试集合（覆盖上述 41 文件）：

```bash
cd packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/services/__tests__/gpt-image-26-integration.test.ts \
  src/services/__tests__/gpt-image-26-output.test.ts \
  src/services/__tests__/default-image-adapter.test.ts \
  src/components/ai-input-bar/ParametersDropdown.test.tsx \
  src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  src/services/__tests__/gpt-image-adapter.test.ts \
  src/services/__tests__/tuzi-gpt-image-adapter.test.ts \
  src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts \
  src/components/ai-input-bar/SvgWriterModelSelect.test.tsx \
  src/services/__tests__/media-executor.test.ts \
  src/utils/__tests__/runtime-model-classification.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/services/provider-model-catalog.test.ts \
  src/services/__tests__/provider-routing.test.ts \
  src/hooks/__tests__/useAutoInsertToCanvas.test.ts \
  src/utils/__tests__/image-generation-anchor-insertion.test.ts \
  src/plugins/components/image.loading.test.tsx \
  src/services/canvas-operations/canvas-insertion.test.ts \
  src/utils/__tests__/gpt-image-26-result-layout.test.ts \
  src/utils/__tests__/canvas-insertion-layout.test.ts \
  src/utils/__tests__/image-generation-lineage-placement.test.ts \
  src/components/ai-input-bar/AIInputBar.image-lineage.test.ts \
  src/components/task-queue/TaskQueuePanel.filters.test.tsx \
  src/components/ttd-dialog/batch-image-generation.import.test.ts \
  src/utils/__tests__/canvas-media-preview.test.ts \
  src/data/image.test.ts \
  src/services/canvas-operations/canvas-insertion-timeout.test.ts \
  src/services/media-executor/fallback-utils.test.ts \
  src/services/version-model-refresh.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts \
  src/components/toolbar/canvas-resources-button.test.tsx \
  src/components/svg-animation-overlay.test.tsx \
  src/components/toolbar/popup-toolbar/svg-tools-button.test.tsx \
  src/services/__tests__/svg-canvas-edit.test.ts \
  src/services/__tests__/svg-canvas-source.test.ts \
  src/services/__tests__/svg-media-persistence.test.ts \
  src/utils/__tests__/svg-source.test.ts \
  src/services/unified-cache-service.test.ts \
  src/services/backup-restore/backup-utils.test.ts \
  src/services/__tests__/workspace-cache.test.ts
```

其他检查在仓库根目录执行：

```bash
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
pnpm exec vite build --config apps/web/vite.config.ts
git diff --check
```

Lint 对本次所有已修改 TS/TSX 与新增 SVG TS/TSX 文件执行 ESLint，JSON 结果位于本机临时文件 `/tmp/opentu5-svg-lint.json`。新增 SVG 文件无诊断；剩余错误为：

- DialogTaskList、TaskQueuePanel、popup-toolbar 各一处 `@nx/enforce-module-boundaries`，共三处。
- popup-toolbar 一处已有 `no-restricted-globals`。
- canvas-insertion.test 一处已有 `import/first`。

上述四个文件分别使用 `git show HEAD:<path>` 送入 ESLint stdin，并保持原文件名解析配置；错误规则和信息逐项一致。

## 检查限制与已知问题

- 标准 `node scripts/check-cycles.js` 使用 JSON.parse 读取带尾逗号的 tsconfig.base.json，执行报错。脚本与配置均与 HEAD 相同。本次没有修改这些无关文件。
- 另在内存中将该脚本的配置读取替换为 TypeScript JSONC 解析后诊断，发现两组现有运行时循环：layer-decomposition 以及 tuzi-embedded-config/postmessage/provider-reuse。涉及文件均未修改，新 SVG 模块没有出现在诊断循环中；该诊断不等同于标准命令通过。
- 构建仍输出动态/静态 import 混用及大分包提示；运行环境提示未设置 NPM_TOKEN 占位符和 Browserslist 数据较旧。测试的既有模拟环境输出部分 IndexedDB 未提供日志，但没有断言失败。
- 按用户项目规则未执行真实页面点击、截图、浏览器自动化、视觉回归或 E2E。jsdom 不证明 SVG 真实几何、CSP 样式加载、动画流畅度、复杂字体或任意渠道文件的保真。
- 没有调用生图端点、读取测试凭据或实际验证截图对应原文件。渠道目录明确 GIF/SVG 格式用途，不承诺 SVG 动画生成；本地实现不能扩大该结论。
- 当前编辑为独立 SVG 片段移动/缩放、适用的统一填充/描边和简单文字修改，不是路径锚点编辑。动画文件当前保留整体播放，不拆分静态编辑。复杂样式、位图、外部资源、旋转/3D、裁切式宽高比等按 design.md 限制回退。
- 2 MB、2000 源节点、200 部件、读取 20 秒和几何 10 秒为本次客户端边界；缺失的本地原文件需重新导入，不能从缩略图恢复矢量。

## 人工验收方法（尚未执行）

1. 在 7205 选中静态 SVG，打开“SVG 工具”，确认显示静态且无播放按钮；点击“转为可编辑副本”，原图应保留，副本部件可单独拖动、缩放，适用部件可改色或改简单文字。
2. 对有原生 SMIL/CSS 动画的安全 SVG，等待原文档就绪后确认出现播放/暂停；静态文件和动画加载失败文件不能出现虚假的可用控制。切到后台或移出可见区域应暂停，回到可见区域按用户选择恢复。
3. 撤销/重做转换和修改，导出并重新导入 .drawnix，检查原图/部件及元数据；对含位图、外部资源或复杂结构的文件确认提示限制并保留完整原图。

## QA / DOC 与兼容性

- 本变更涉及文件解析、画布历史、动画隔离和保存链路，因此在现有 OpenSpec 变更目录提供本 QA 与 design.md，更新 proposal/spec/tasks；不新增根目录 QA.md 或 DOC.md。
- 没有新依赖、配置、权限或数据库迁移。新元数据可选，原节点保留；禁用工具和动画覆盖层即可恢复旧图片显示路径，已生成片段仍可作为 SVG 图片显示。
- 本次无 GitHub 或生产操作，已有未提交改动保持原样。

## 2026-11-08 截图反馈：SVG 工具浮层样式

- 用户截图显示“SVG 原文件”文字和转换操作直接铺在画布上。源代码确认 SVG 工具浮层缺少背景、边框、阴影及明确的按钮样式；共用 Popover 只负责定位，不提供这些外观。
- 仅修改 `svg-tools-button.scss`：补齐不透明背景、边框、圆角和项目浮层阴影；统一按钮/输入框、悬停和键盘焦点样式，约束高度并允许滚动。SVG 识别、转换、动画和弹层定位逻辑未修改。
- `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts src/components/toolbar/popup-toolbar/svg-tools-button.test.tsx`（在 packages/drawnix）通过，1 文件、6 项。
- `pnpm exec sass --no-source-map packages/drawnix/src/components/toolbar/popup-toolbar/svg-tools-button.scss /tmp/opentu5-svg-panel-style.css` 通过，检查编译结果确认上述浮层声明存在。
- `pnpm exec vite build --config apps/web/vite.config.ts` 通过，33.13 秒；`git diff --check` 通过；7205 HTTP GET 返回 200。
- 本次仅样式调整，没有新增重复实现的单元测试，也未重复运行不受影响的完整测试集合。按项目规则未执行页面测试；用户截图证明修复前的问题，修复后实际页面外观仍待刷新验收。

## 2026-11-09 PR 前同步与冲突验证

- 用户授权与上游比较、解决冲突并仅提交本任务修改到 PR。提交范围为 40 文件：2.6 多结果任务列排版 16 文件；SVG 识别、编辑、播放、浮层及 QA/DOC 24 文件。没有依赖、配置、构建产物或其他 PR 功能进入差异。
- 本轮备份 `/Users/lkj/.codex/backups/opentu5/before-svg-layout-pr-20261109T045519Z` 保存完整归档、SHA-256 清单和补丁，40 个文件逐项校验通过。
- 分别创建功能提交 `ba7883f4`（2.6 任务列排版）和 `e0d78a05`（SVG 编辑与已有动画播放）。显式执行 `git fetch origin` 后，`origin/develop` 为 `65636cbe2203d57b8a1c555f39e41527289cd749`；`git merge --no-edit origin/develop` 返回 Already up to date，无目标分支冲突。
- 同时只读获取未合并 #330 的 `457ec074eff0be57077a11637526914152b08471` 进行 `git merge-tree --write-tree` 预演。初次在 `useAutoInsertToCanvas.ts` 相邻 import 处发生文本冲突；将本次新增排版 import 移到独立位置后，组合树 `b7c54cac71bbbdc57a34550828156ad816f407d9` 无文本冲突。没有把 #330 合并到功能分支。
- 本分支最终相关回归：41 文件、1109 项通过；生产构建通过（45.69 秒）；类型检查通过。import 位置调整后，自动插图 68 项和类型检查再次通过，该文件 lint 0 错误、34 个既有警告。
- 隔离目录 `/tmp/opentu5-pr330-compatibility` 仅用于组合验证：同一 41 文件集合共 1131 项通过，类型检查通过。其额外用例来自 #330；这些结果不能代表 #330 的全部测试或线上部署通过。
- 本任务 30 个 TS/TSX 文件 lint 共 5 错误、190 警告；全部 5 错误的规则与消息逐项对照 `origin/develop` 一致。新增 SVG 与任务排版模块没有 lint 错误。本轮不扩大处理已有模块边界、location 或 import/first 问题。
- `git diff origin/develop...HEAD --check`、工作区差异检查和未合并索引检查在交付前执行。没有页面自动化、真实生图、额外收费、数据库迁移或生产操作。原有 OpenSpec CLI/循环检查工具限制继续适用，QA/DOC 复用当前两个变更目录。
