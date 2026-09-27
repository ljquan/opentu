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

## 覆盖项

- 设置按钮打开面板，面板包含“任务栏跟随”和“点击图片后自动居中”。
- 两个开关使用本地偏好；读取失败时默认开启，写入失败时保留当前会话状态。
- 设置变更通过事件同步到画布工具栏。
- 单张图片普通点击触发平滑居中；多选、拖拽、滚轮、右键和工具栏区域不触发。
- 新的点击、滚轮、组件卸载会取消待执行或进行中的居中动画。

## 未覆盖项与风险

未执行真实浏览器页面点击、截图对比和生产环境验证；需要人工确认设置面板视觉位置、动画观感，以及底部输入栏覆盖时的居中位置。回滚方式为回退本 PR 提交。
