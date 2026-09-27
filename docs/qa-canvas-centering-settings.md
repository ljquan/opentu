# 画布图片居中与任务栏设置 QA

## 范围

验证 AI 任务栏设置入口、任务栏跟随开关、点击图片后自动居中开关，以及图片点击动画的边界行为。

## 验证环境

2026-09-27，macOS，Node 26.8.1、pnpm 10.21.0。未执行页面自动化测试。

## 已执行检查

```sh
pnpm exec nx run drawnix:typecheck
cd packages/drawnix
pnpm exec vitest run --config vitest.config.ts \
  src/components/ai-input-bar/canvas-view-settings.test.ts \
  src/components/ai-input-bar/target-bound-taskbar-state.test.ts \
  src/components/ai-input-bar/canvas-association-state.test.ts
cd ../..
pnpm exec nx run web:build
git diff origin/develop...HEAD --check
```

结果：类型检查通过，Web 构建通过，121 项相关测试通过，Git 差异检查通过。

## 自动测试覆盖

5 项新测试验证居中偏好的默认值、持久化及模块重载恢复、读取失败降级、写入失败时通知消费者和存储访问被禁止时的会话保留；另有 31 项任务栏绑定状态测试和 85 项画布联想状态回归通过。上述测试不覆盖 DOM 点击或动画流畅度。

文件级 ESLint 检查：新增设置模块和测试无错误、无警告；AIInputBar 无错误、18 条原有警告；popup-toolbar 有 2 处原有错误（`@nx/enforce-module-boundaries` 与 `no-restricted-globals`）和 34 条警告。对本次功能提交前的 HEAD 源码执行相同检查已复现这两处错误，未因本 PR 引入，不能宣称全量 lint 通过。

## 使用说明与实现范围（非页面验证结果）

- 选中图片等支持跟随的目标后，点击输入框右侧设置按钮打开面板，面板包含“任务栏跟随”和“点击图片后自动居中”。
- 两个开关使用本地偏好；读取失败时默认开启，写入失败时保留当前会话状态。
- 设置变更通过事件同步到画布工具栏。
- 单张图片普通点击触发平滑居中；多选、拖拽、滚轮、右键和工具栏区域不触发。
- 新的点击、滚轮、组件卸载会取消待执行或进行中的居中动画。

居中默认开启，保持当前缩放比例，约 280ms 平移到整个画布容器中心。设置键为 `aitu_ai_center_image_on_click_enabled`，任务栏跟随沿用原有键；没有服务端接口、依赖、环境变量或数据迁移变化。存储被禁止时偏好仅在本页面会话内有效。此文同时记录使用方式与维护边界，不另增 DOC 文件。

上游同步：本次提交后显式 fetch 并 merge `origin/develop`（`76d61ba0`），结果 Already up to date，无冲突。随后 Web 构建通过（包含 Web 类型检查、应用和 Service Worker 构建）。

## 未覆盖项与风险

未执行真实浏览器页面点击、截图对比和生产环境验证；需要人工确认设置面板视觉位置、动画观感，以及底部输入栏覆盖时的居中位置。回滚方式为回退本 PR 提交。

人工验收待执行：开关关闭后点击图片应保持视口；重新开启后单击单图应平滑居中且缩放不变；拖拽、右键、多选和滚轮应保持原有操作；刷新应恢复两个开关的已保存值。布局测量次数已减少，但未做性能基准，不保证所有大画布均无掉帧。
