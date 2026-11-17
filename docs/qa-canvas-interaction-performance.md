# 画布交互性能优化 QA

## 范围与维护边界

首轮优化于 2026-11-16 基于 `215bae8c`（v1.2.13）进行，包含重复保存、填充扫描和输入栏目标查询；随后同步到 v1.2.14，并与图片操作图标调整一起提交至 PR #344。2026-11-17 确认该 PR 已合并。下方原始验证记录对应首轮实现，追加验证另列。

- 内容、主题及混合操作继续即时保存；纯选区变化不写入画板，纯视口变化沿用既有 500ms 防抖保存。内容保存会取消旧视口定时器，切板会取消旧定时器且保存前检查画板 ID。视口变更仍标记待保存，保留页面离开快照、保存失败保护和跨标签页通知。
- 填充元素按画板建立 ID 索引，消除每个 SVG 图形重复遍历元素数组的开销。日常属性/尺寸修改只修复受影响元素；初始化、主题、结构、快照替换和宿主重新挂载继续全量修复。DOM 变更观察器仍负责渲染器重置填充后的恢复，并按画板与宿主隔离。
- 输入栏复用同一选择、内容快照与提示词下的目标查询及未完成请求。纯鼠标悬停不重复发布状态；平移、缩放、窗口/可视视口变化继续刷新定位。实际点击、选择刷新和提示词修改仍重新查询；缺失元数据只缓存 500ms，失败查询会失效，切板/卸载仍阻止旧异步结果发布。

没有新增用户配置、接口、依赖声明或存储格式变化。QA 与维护边界集中在本文件，不另建重复 DOC 或 OpenSpec 功能提案；本次修复重复工作，不引入新操作能力。

## 首轮环境与实际结果

macOS，Node v26.8.1、pnpm 10.21.0、Vitest 3.2.4、JSDOM。当前 worktree 使用独立依赖，通过 `pnpm install --frozen-lockfile --ignore-scripts` 按锁文件安装，没有修改依赖声明/锁文件或其他工作区。

| 验证 | 结果 |
| --- | --- |
| App 保存与跨标签页竞态、PendingPersistence | 2 个文件，22 项通过 |
| 填充、选择监听器、关联线、生成节点、重新生成、草稿、预填、定位、选择工具、工作区缓存 | 16 个文件，288 项通过 |
| Web / Drawnix 生产源码 TypeScript | 均通过 |
| Web Vite 生产构建 | 通过，最终构建 44.08 秒 |
| 7 个本次源码/测试文件 ESLint | 新增问题为 0；`app.tsx` 有 2 个原有 `no-inferrable-types` 错误，原始 HEAD 同命令复现；其余文件 0 errors。AIInputBar 原有 21 warnings 保持，新增填充测试 0 warnings |
| 最终差异检查 | `git diff --check` 通过 |

关键回归：

- 120 次纯视口变更只在防抖结束后保存 1 次，保存最终视口及原有元素；120 次纯选区变更保存 0 次。
- 新增、删除、移动、属性、主题与混合变更仍即时保存；内容保存接替视口保存、旧视口不写入新画板、保存失败保留待恢复快照、读取期间新插入不被旧同步覆盖均通过。
- 渐变/图片填充初始化、尺寸变化、撤销/重做对应属性回写、渲染器重置与替换 DOM、同 ID 快照替换、多画板观察器和宿主重新挂载均通过。
- 1000 个普通填充元素的全量修复，元素 ID 读取量不超过 `3 × 元素数`；不再逐个 SVG 图形线性搜索整板。这是复杂度断言，不是实际页面耗时测量。
- 同一绑定目标经历 120 次悬停帧，不重复查询目标；平移、缩放及 resize 继续触发定位。共享未完成查询、缺失元数据过期重查、查询失败重试、点击恢复提示词、新选择/新视口胜出、异步选择内容不被移动取消均通过。

## 可复现命令

仓库根目录：

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  apps/web/src/app/app-sync.spec.ts \
  apps/web/src/app/pending-persistence.spec.ts --environment jsdom
pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vite build --config apps/web/vite.config.ts
git diff --check
```

`packages/drawnix` 目录：

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/components/ai-input-bar/AIInputBar.selection.test.tsx \
  src/components/ai-input-bar/AIInputBar.canvas-input-clicks.test.tsx \
  src/plugins/with-gradient-fill.test.ts \
  src/plugins/canvas-association.test.ts \
  src/plugins/with-generation-node.test.ts \
  src/components/ai-input-bar/AIInputBar.prompt-history.test.tsx \
  src/components/ai-input-bar/AIInputBar.toolbar-draft.test.ts \
  src/components/ai-input-bar/AIInputBar.prefill-images.test.ts \
  src/components/ai-input-bar/AIInputBar.reroll.test.ts \
  src/components/ai-input-bar/canvas-association-state.test.ts \
  src/components/ai-input-bar/canvas-association-picking.test.ts \
  src/components/ai-input-bar/__tests__/bound-taskbar-layout.test.ts \
  src/components/ai-input-bar/target-bound-taskbar-state.test.ts \
  src/components/ai-input-bar/BoundImageContentPreview.test.tsx \
  src/utils/__tests__/selection-utils.test.ts \
  src/services/__tests__/workspace-cache.test.ts
```

## 首轮未执行项、风险与人工验收

首轮按用户默认规则未执行页面测试、浏览器操作、视觉回归或端到端测试；后续用户明确要求的 Ego 验证见追加记录。未测生产 FPS、长任务、真实 IndexedDB 写入耗时、跨浏览器或完整仓库测试；不能将调用量减少换算成页面提速比例。App 测试运行实际回调并模拟存储，填充测试使用 JSDOM 和渲染器桩，不能证明真实 SVG 布局效果。已有测试的 IndexedDB 缺失日志、构建的大 chunk/混合导入及工具废弃提示仍存在。

人工验收建议：在原有多图画板选择/框选、拖动与缩放，确认输入栏持续跟随；编辑后立即刷新、缩放后立即离开再返回，确认内容和视口恢复；修改渐变/图片填充并撤销、重做、切换画板，确认显示与原操作一致。此流程尚未执行。

没有迁移、配置或部署顺序要求。需要回滚时只撤销本次三个源码文件的优化，不清理画板、缓存或用户数据；测试与本 QA 可随同回滚。

## 2026-11-17：生成期间占位卡渲染修复

用户反馈从生成开始持续卡顿，直到图片显示后数秒才恢复。源码确认占位卡在 SVG foreignObject 内持续执行整卡阴影、背景位置和滤镜动画，显图阶段又对大图进行多级模糊过渡。完成卡片还有既有的 1600ms 移除延迟；时间上的对应不足以证明这是全部卡顿原因。

本轮仅修改占位卡 SCSS：将大面积光效改为静态，移除预览图模糊与缩放过渡及角标背景模糊，保留短暂透明度淡入、完成退出、小进度环、百分比、状态及操作按钮。不修改请求、插入/就绪校验、进度逻辑、1600ms 移除时序或画板数据。无新增接口、依赖、配置和存储变化，不另建 DOC。

### Ego 测量与状态回放

环境为本 worktree 的 `http://localhost:7205`、Ego Chromium、61% 画布缩放。在专用测试板的 SVG 宿主中挂载真实 `ImageGenerationAnchorGenerator`，单张逻辑尺寸 400×400 的占位卡，固定生成阶段与 6% 进度。节点未加入 `board.children`，`taskIds` 为空，不创建任务或提交请求。移除诊断时使用的临时暂停样式后，使用 `Performance.getMetrics` 对同一可见卡片各采样 3 秒：

| 指标 | 修改前 | 修改后第一轮 | 修改后第二轮 |
| --- | --- | --- | --- |
| LayoutCount 增量 | 0 | 0 | 0 |
| RecalcStyleCount 增量 | 68 | 0 | 0 |
| RecalcStyleDuration 增量 | 53.987ms | 0ms | 0ms |
| TaskDuration 增量 | 152.562ms | 20.380ms | 13.946ms |

这是单卡固定进度的开发环境短采样，说明持续动画产生的样式重算已消除，不是实际生成全流程、生产 FPS、GPU 耗时或整板流畅度的证明。

本地回放提交、排队、80% 生成、显影、插入、失败和完成状态，以及四图占位：进度文字、等待时的小环旋转、失败的查看详情/重试/关闭按钮仍显示；预览图计算样式 `filter: none`，只做透明度过渡；大面积图层与四图槽位伪元素均无持续动画。检查生成、插入及四图占位截图。此为状态渲染验证，未在浏览器点击重试或模拟新任务。结束时销毁临时节点和 React 根；测试板仍为原有 3 张图片。

本轮修复前已有两次用户授权的 Seedream 5.5 真实请求（各 1 张、1.5K）完成并插入测试板：重新生成蓝杯、调整提示词生成红杯。另一次“继续编辑”因历史模型配置不可用被前置校验阻止，未提交；该问题未混入本次 CSS 修复。修复后没有再次发送收费请求，完整真实生成期间的操作流畅度仍需后续验证。

### 本轮本地回归

- 生成卡片内容、占位同步、自动插入、视图模型与图片就绪：5 个文件、112 项通过。
- Web Vite 生产构建通过，耗时 50.41 秒；既有 Sass、Browserslist、混合导入及大 chunk 提示仍存在。
- `git diff --check` 通过。SCSS 修复未改变 TypeScript；未重复运行全仓库测试或 lint。

在 `packages/drawnix` 执行：

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/components/image-generation-anchor/ImageGenerationAnchorContent.test.tsx \
  src/hooks/__tests__/useImageGenerationAnchorSync.test.ts \
  src/hooks/__tests__/useAutoInsertToCanvas.test.ts \
  src/utils/__tests__/image-generation-anchor-view-model.test.ts \
  src/utils/__tests__/image-generation-anchor-readiness.test.ts
```

构建命令同前。人工补验可在原有大画板生成期间拖动画布、缩放和选择元素，直到结果显示后数秒，确认响应保持正常；本轮没有宣称该场景已完全消除卡顿。回滚本轮修复只需恢复占位卡 SCSS，无需删除图片、任务、缓存或其他数据。
