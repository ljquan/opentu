# Change: 工作流画布模式

## Why

现有图片和视频生成以单次结果为中心，当前新增的工作流原型又只是独立 DOM 卡片，无法让用户在完整白板能力中把提示词、图片和视频按节点组织、连接和继续编辑。

## What Changes

- 增加与普通白板相互隔离、均可恢复的工作流画布模式
- 把工作流节点定义为可容纳文字、绘图、图片和视频的空白 Drawnix Frame
- 增加自动增长的多输入口、单输出口、重连替换和无环连接约束
- 允许选择节点内元素或区域作为输出，并将其作为下游节点输入引用
- 复用底部 AI 输入栏，把生成内容写入目标节点并按来源文档路由异步结果
- 将所有工作流专属实现集中在 `packages/drawnix/src/workflow-mode/`

## Impact

- Affected specs: `workflow-canvas-mode`
- Affected code:
  - `packages/drawnix/src/workflow-mode/`
  - `packages/drawnix/src/drawnix.tsx`
  - existing application-menu and toolbar integration files
  - minimal AI input integration required by the generation bridge

## Non-Goals

- 不实现第二套迷你画布或同时挂载两个 Drawnix 实例
- 不改变普通白板已有内容或默认行为
- 不允许节点自连接或循环依赖
- 不复制上游大型媒体到下游节点
