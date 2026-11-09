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

## 矢量部件点击准确度修复（2026-11-09）

### 问题与范围

用户截图反馈拆分 SVG 后点击不准确。代码确认：副本使用带 `svgVectorPart` 的 image 节点，Plait 默认对整个图片矩形命中；透明边角、路径内部孔洞、离散星点间的空白都会拦截下层图形。本轮针对这一确定的命中缺陷修复，没有读取截图对应的源 SVG 或操作用户画布，因此不将截图中所有位置差异都归因于该缺陷。

新增 `with-svg-vector-hit.ts`，接入 `with-common.tsx` 的现有插件链，在 3D 与锁定覆盖规则之前细化部件命中。仅在图片已按当前 URL 加载、原矩形命中时，从已挂载图片读取非透明像素；没有额外图片请求、SVG DOM 注入、原文件改写、重新生成或画布迁移。使用 WeakMap 按图片 DOM、当前源和原 URL 缓存最长边 512 的位图，每像素 1 位，最大 32 KiB；首次按需读取后不在每次鼠标移动中重复绘制。缩放与移动复用同一缓存；修改/替换源时更新，卸载后可被垃圾回收。

命中坐标跟随原有旋转逆变换、显示宽高及 Frame 的 contain 留白，保留约 2 屏幕像素的细线容差。透明区域允许点到后方部件；实际填充、描边、滤镜和裁切的像素由浏览器加载后的图片提供。既有合成分组仍作为整体选择。选中框/缩放框及框选继续使用矩形，不裁掉光晕或修改图形边界。未加载、DOM 不可用、Canvas 不可用或像素读取被拒绝时仍可按原矩形选择。

### 实际验证

环境：macOS，Node 26.8.1，pnpm 10.21.0；分支 `dev/gpt-image-26-result-columns`，基线 fef01196。保留本轮之前尚未提交的 2.6 参数及 GIF 修复。

- 新增 17 项命中测试通过。使用真实 Plait 图片命中/选择函数和画布就绪注册，显式模拟 Canvas 像素数据；覆盖圆形、三角形、离散星点、孔洞、透明部件、重叠层顺序、框选、移动、缩放、旋转、屏幕容差、Frame 留白、自然显示高度、源替换/撤销、加载与卸载、像素读取失败、普通图片、3D、锁定及缓存上限/复用。初次测试夹具缺少 Plait withOptions，补齐真实插件后通过，没有修改框架或跳过断言。
- 在 `packages/drawnix` 运行 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts`，指定 with-svg-vector-hit、svg-canvas-edit、svg-canvas-source、svg-media-persistence、svg-source、image.loading、svg-tools-button、svg-animation-overlay、image-3d-transform：**9 文件、89 项通过**。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 对新增插件、测试和 with-common.tsx 执行 ESLint：0 错误、0 警告。
- `pnpm exec vite build --config apps/web/vite.config.ts`：通过，41.70 秒；保留既有 Sass、导入与大 chunk 提示。
- `git diff --check`：通过。新导入关系为 with-common → with-svg-vector-hit → canvas-image-readiness，后者仅有外部类型导入，不引入新的模块循环；未重复执行已知受 JSONC 解析阻塞的循环脚本。
- 日志位于仓库外 `/tmp/opentu5-svg-vector-hit-*.log`。更新本目录既有 design、spec、tasks 和验证记录，不新增根目录文档。

### 限制与人工验收

未执行真实页面点击、视觉对比、截图对应 SVG 的像素验收、全仓库测试、收费生成、提交/推送或部署。Canvas 像素读取在 jsdom 中为测试桩，不能替代浏览器对具体滤镜/字体的渲染；512 像素采样对极细图形或大倍率放大存在近似误差。OpenSpec CLI 此前确认不可用，本轮未执行其严格校验。无新依赖、环境变量、数据迁移或远程操作。

刷新本地页面后，可直接在已有可编辑副本中验收：先取消整组选择，再分别点击可见月亮/山形/星点；点击部件的透明边角或空洞应能选中其后方图形。移动、缩放和旋转后再点击相同可见部位，选择应跟随图形。框选整张作品仍可选出全部部件，矩形控制框属于缩放操作的既有表现；无需重新生成或重新拆分 SVG。

## 2026-11-09 本次推送前复核

SVG 点击修复与此前 2.6 本地修改一同保存为 `19de3fb0`。成功显式拉取目标和功能分支后，`origin/develop@65636cbe` 已包含，merge 无冲突且没有代码变化。最终组合回归 18 文件 703 项全部通过（其中包含本节前述 SVG 的 9 文件 89 项），图片偏好另有 25 项通过；类型检查及 Vite 生产构建通过（38.59 秒），SVG 新增插件、测试和接入文件没有 lint 问题。完整同步、命令、全仓库旧 CI 失败与工具限制见 `../add-gpt-image-2-6-1k/validation.md` 的“最新远程同步与推送前 QA”。本次仅更新原 PR #331，不合并或部署；实际页面点击仍未执行，保留像素采样近似与读取失败回退的验收边界。
