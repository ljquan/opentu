# 画布图片详情 QA 与使用说明

## 范围与环境

2026-10-05，macOS，Node 26.8.1、pnpm 10.21.0。
验证单选图片的详情入口、生成任务匹配、缺失记录与错误状态、参数投影和现有再次生成回填逻辑。最终 PR 分支为官方仓库的 `dev/canvas-image-details`，基于官方 develop 的 `0ccbe765` 实现；同步和验证在原功能分支 `dev/workflow-model-fix` 上执行，随后从相同提交建立最终 PR 分支，没有实现代码差异。
测试采用构造的本地任务和 JSDOM 组件，不调用真实生成接口。默认不执行浏览器页面测试。

## 已执行验证

PR 前最终验证：2026-10-05 已显式 fetch 官方 `ljquan/opentu` 的 develop（`0ccbe765`）并 merge 到 `dev/workflow-model-fix`，结果 Already up to date，无冲突。合并后 23 项相关测试通过（9 项详情组件、3 项偏好、7 项详情数据、4 项回填回归）；类型检查、新增模块及 storage-keys 的 ESLint、Web 应用构建、OpenSpec 严格校验、完整任务差异检查通过。QA 与使用/维护说明合并在本文件，不另建 DOC 文件。未执行页面或真实供应商验收。

```sh
cd packages/drawnix
pnpm exec vitest run --config vitest.config.ts \
  src/utils/canvas-image-details.test.ts \
  src/components/toolbar/popup-toolbar/image-details-button.test.tsx \
  src/utils/__tests__/image-task-prefill.test.ts
```

首次功能阶段共 16 项测试通过：7 项详情数据测试、5 项详情组件测试、4 项再次生成回填回归测试。

追加“点击图片自动打开详情”开关后，重新执行详情数据、详情组件和 `image-details-settings.test.ts`：17 项通过（7 项数据、7 项组件、3 项设置）。新增文件和 storage-keys 的 ESLint、最终类型检查与最终 Web 应用构建通过；更新后的 OpenSpec 严格校验通过。本地 7204 首页仍返回 HTTP 200。

```sh
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
pnpm exec eslint \
  packages/drawnix/src/utils/canvas-image-details.ts \
  packages/drawnix/src/utils/canvas-image-details.test.ts \
  packages/drawnix/src/components/toolbar/popup-toolbar/image-details-button.tsx \
  packages/drawnix/src/components/toolbar/popup-toolbar/image-details-button.test.tsx
NX_DAEMON=false pnpm exec nx run web:build-app
git diff --check
```

最终代码的类型检查、新增文件 ESLint、Web 应用构建与差异检查均通过。OpenSpec 严格校验通过。本地 7204 监听进程的目录确认为本项目 apps/web，首页 HTTP 200 且包含 OpenTu/Vite 标记；这属于服务检查，不等同页面交互验收。

对 popup-toolbar 的当前代码及修改前 HEAD 分别执行 ESLint，均复现两处既有错误：`@nx/enforce-module-boundaries`（静态引用动态加载库）和 `no-restricted-globals`（location）。本次未改变相关代码，不能宣称全量 lint 通过。
既有回填测试在 Node 26 环境输出 localStorage/IndexedDB 不可用的日志，但 4 项断言通过。构建另有已有 Sass 弃用、混合动态/静态导入和大 chunk 警告。

追加开关的悬停说明使用共享 HoverTip。执行 `node packages/drawnix/scripts/check-hover-usage.mjs`，新增详情模块没有违规；全量检查仍报告 8 个其他文件的既有原生 title 用法。这 8 个文件与 HEAD 无差异，未在本任务中修改，因此本次也不宣称全量 hover 检查通过。

## 覆盖与预期结果

| 场景 | 预期及实际结果 |
| --- | --- |
| 图片绑定任务 ID，结果 URL 已变化 | 优先读取绑定任务，测试通过 |
| 绑定任务缺失或类型不符 | 回退到结果 URL 查询，测试通过 |
| 历史图片未绑定任务 | 按结果 URL 查询，测试通过 |
| 上传图片或没有历史记录 | 保留已有尺寸/提示词；时间、模型、参数显示未记录，测试通过 |
| 生成参数为 0、false 或嵌套配置 | 正确保留可展示值，测试通过 |
| 配置包含凭据、认证字段和参考图 URL | 从展示参数中移除，递归过滤测试通过 |
| 读取失败后重试 | 显示错误而非缺失记录，重试成功后展示详情，测试通过 |
| 查询期间换选另一张图片 | 旧组件卸载、忽略旧响应，新图片不显示旧模型，测试通过 |
| 关闭或 Escape | 面板关闭；Escape 后焦点返回入口，组件测试通过 |
| 再次生成回填 | 既有 4 项测试通过 |

## 使用方式与维护边界

选中一张图片，点击顶部工具栏删除按钮右侧的信息图标“查看图片详情”。面板显示任务创建时间作为生成时间、已记录的完成时间、模型、图片原始尺寸、提示词和模型参数。时间按浏览器所在时区显示。

详情标题右侧的开关控制“点击图片自动打开详情”，默认开启。普通单击图片会打开详情，同一张图片关闭后再点击也会打开；关闭开关后不会自动打开，但工具栏信息图标仍可手动打开。拖拽、修饰键点击、右键、多选、工具栏和弹层操作不触发自动打开。开关使用本地键 `aitu_ai_image_details_on_click_enabled`；读取失败时默认开启，写入失败时保留当前会话选择。没有记录该键的旧版本用户无需迁移。

自动打开请求在现有画布 pointerUp 处理之后读取单张图片选择，并绑定图片 ID、URL 与任务 ID，避免图片替换后复用旧点击请求。组件测试覆盖点击请求、同图再次打开、关闭偏好后切图仍关闭及手动打开；偏好测试覆盖默认值、持久化读取/写入和存储异常。实际画布点击、拖拽排除等父级事件边界仅代码审查，未执行页面验证。

单选位图及 SVG 图片均可显示详情入口；多选、视频、工具元素和文字编辑态不显示。此入口条件经代码审查确认，未进行真实画布点击验证。现有 SVG 不支持的编辑/再次生成操作保持原条件。

数据来自已有任务记录：优先 `getCompleteTask(generationTaskId)`，再用 `findImageTaskByResultUrl` 查询历史记录。模型优先使用任务保存的调用路由模型，缺失时使用任务模型。没有记录时不读取当前模型设置或推测生成时间。

仅投影常见顶层生成字段和 `params.params` 中的配置；不展示整个任务或路由对象。参数递归过滤凭据、认证字段、参考图以及 URL/data/blob 内容，嵌套深度超过四层的内容不显示。面板不改写图片，不发送生成请求，没有新增依赖、环境变量、接口或数据迁移。

本文件同时提供 QA 与使用/维护说明，不另建 DOC 文件。

## 未执行项、风险与人工验收

用户追加面板位置调整：面板从图片边界定位，优先在图片右侧留出 12px 间隔；右侧不足 240px 时使用有足够空间的左侧；两侧都不足时放在图片上/下方，限制高度并滚动。复用工具栏现有选区屏幕矩形，未修改共享 Popover 的行为。新加两项组件测试覆盖右侧位置与左侧回退不覆盖图片。19 项相关测试及类型检查、详情组件 ESLint、最终 Web 应用构建与 OpenSpec 严格校验已通过，本地首页 HTTP 200。布局数字断言属于 JSDOM 验证，不是截图或页面视觉验收。图片几乎占满整个视口时，图片外空间可能不足，需要缩小画布或调整图片位置。

- 未执行浏览器页面点击、截图、移动端视觉检查、真实 IndexedDB 历史数据验收、真实供应商生成或生产验证。
- 已清理的任务记录无法恢复未单独保存的模型、时间和参数；旧图只保留 URL 而且 URL 已变时，也可能无法匹配。
- 人工验收：普通点击生成图片应自动打开详情；关闭开关后重新点击应保持关闭，信息图标应仍可打开；重新开启开关后再点击恢复自动打开；刷新后应保留开关选择。对上传图片核对“未记录”；拖拽、右键、多选不应自动打开；关闭详情后确认画布选择不变；检查长提示词、参数与窄屏滚动。
- 回滚：移除工具栏新增详情入口及新增详情组件/数据模块；本次没有持久化变更。
