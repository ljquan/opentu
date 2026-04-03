# Change: 为 opentu 引入 Stitch 驱动的设计闭环工作流

## Why

当前 `opentu` 的前端页面与面板主要直接在代码中设计和实现，缺少一条稳定的“设计探索 -> 方案沉淀 -> 代码回收”的闭环。
这会带来三个直接问题：

- 新页面或复杂面板的视觉方案探索成本高，难以快速比较多个方向
- 设计稿、实现代码、页面映射关系分散，后续复用和迭代成本高
- 即使使用 Stitch，也缺少明确的仓库内落点，容易变成一次性的外部试验

我们希望把 Stitch 接入为一个受控的设计工作流：
- 先把适合的页面和面板送入 Stitch 进行方案设计
- 再通过 MCP 将 screen 与 design system 信息拉回仓库
- 最终由本地 React/业务层完成生产实现

## What Changes

- 引入仓库内的 Stitch 工作流约定，包括 `.stitch/` 目录、screen 映射文件与设计规范文档
- 定义首批适合走 Stitch 的 UI 范围，优先覆盖外围页面、抽屉、弹窗、空状态页，不直接覆盖核心白板编辑器
- 规范从 prompt 到 Stitch screen，再到 MCP 拉取与本地编码实现的标准流程
- 明确代码与设计的边界：Stitch 负责视觉方案与结构参考，仓库代码仍然是交互行为与生产实现的唯一真源
- 为后续将 Stitch screen 回收为 React 组件提供可追踪的映射关系

## Impact

- Affected specs:
  - `stitch-design-workflow`
- Affected code:
  - `.stitch/*`
  - `apps/web/src/app/*`
  - `packages/drawnix/src/components/*`
  - `packages/drawnix/src/contexts/*`
  - `packages/drawnix/src/hooks/*`
  - 未来首批接入页面对应的样式与组件文件

## Initial Rollout Scope

- 首批纳入 Stitch 设计闭环的页面/模块：
  - `CrashRecoveryDialog`
  - 设置面板 / 设置对话框
  - 项目抽屉 / 项目列表
  - 媒体库面板
  - 空状态页 / 引导页

- 首批明确不纳入 Stitch 主导设计的页面/模块：
  - 核心白板画布
  - 涉及拖拽、框选、缩放、插件联动的编辑器核心交互
  - 多标签同步、任务队列、画布操作等逻辑驱动区域

## Relationship To Existing Changes

- 本变更与现有 provider / runtime model 相关提案无直接冲突
- 本变更关注前端设计工作流与设计资产管理，不改变当前模型路由、任务执行和 SW 通信架构
