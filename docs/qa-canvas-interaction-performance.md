# 画布交互性能优化 QA

## 范围与维护边界

2026-11-16，基于 `215bae8c`（v1.2.13），本地分支 `Jerry-George-Liang/north-apple-e2082d6c`。本次只优化重复保存、填充扫描和输入栏目标查询；没有提交、推送或部署。

- 内容、主题及混合操作继续即时保存；纯选区变化不写入画板，纯视口变化沿用既有 500ms 防抖保存。内容保存会取消旧视口定时器，切板会取消旧定时器且保存前检查画板 ID。视口变更仍标记待保存，保留页面离开快照、保存失败保护和跨标签页通知。
- 填充元素按画板建立 ID 索引，消除每个 SVG 图形重复遍历元素数组的开销。日常属性/尺寸修改只修复受影响元素；初始化、主题、结构、快照替换和宿主重新挂载继续全量修复。DOM 变更观察器仍负责渲染器重置填充后的恢复，并按画板与宿主隔离。
- 输入栏复用同一选择、内容快照与提示词下的目标查询及未完成请求。纯鼠标悬停不重复发布状态；平移、缩放、窗口/可视视口变化继续刷新定位。实际点击、选择刷新和提示词修改仍重新查询；缺失元数据只缓存 500ms，失败查询会失效，切板/卸载仍阻止旧异步结果发布。

没有新增用户配置、接口、依赖声明或存储格式变化。QA 与维护边界集中在本文件，不另建重复 DOC 或 OpenSpec 功能提案；本次修复重复工作，不引入新操作能力。

## 环境与实际结果

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

## 未执行项、风险与人工验收

按用户默认规则未执行页面测试、浏览器操作、视觉回归或端到端测试。未测生产 FPS、长任务、真实 IndexedDB 写入耗时、跨浏览器或完整仓库测试；不能将调用量减少换算成页面提速比例。App 测试运行实际回调并模拟存储，填充测试使用 JSDOM 和渲染器桩，不能证明真实 SVG 布局效果。已有测试的 IndexedDB 缺失日志、构建的大 chunk/混合导入及工具废弃提示仍存在。

人工验收建议：在原有多图画板选择/框选、拖动与缩放，确认输入栏持续跟随；编辑后立即刷新、缩放后立即离开再返回，确认内容和视口恢复；修改渐变/图片填充并撤销、重做、切换画板，确认显示与原操作一致。此流程尚未执行。

没有迁移、配置或部署顺序要求。需要回滚时只撤销本次三个源码文件的优化，不清理画板、缓存或用户数据；测试与本 QA 可随同回滚。

## 发布前浏览器复核（2026-11-17）

真实 Chromium 导入渐变画板时发现：内容快照已替换，但操作列表只有 `set_selection` 或 `set_viewport`，会误走空增量修复路径，导致渐变退回纯色。相同用例在 PR 环境 v1.2.14 正常。增量路径现要求至少包含一次 `set_node`；替换快照继续完整修复。新增两个针对导入快照的回归测试。

同一导入流程的刷新恢复验证还发现保存过滤忽略了新内容快照。保存回调现仅在 children/theme 与最近快照相同且所有操作均为瞬态操作时跳过保存。新增两个导入内容持久化测试；真实浏览器验证同时覆盖选区零写入、视口保存、内容修改及刷新恢复。

刷新后的真实 DOM 复核也暴露旧观察器仅识别 `g[id]`，而 Plait 画布节点实际使用 `plait-data-id`。观察器、全量扫描和 DOM 查询回退现支持实际标识，并保留旧 id 兼容；新增真实属性结构下的填充重置和子节点替换测试。
