# 画布图片选中状态锁定优化经验

## 问题描述

当用户在画布中选中一张图片并在对话框中编辑修改提示词时，如果此时有其他之前生成失败的图片刚好生成完成并自动插入画布，选中的图片会被意外切换为刚插入的图片。这导致用户可能在发送修改提示词时，实际修改的是另一张图片。

## 根本原因

在 `insertImageFromUrl` 函数中，图片插入后会自动选中新插入的图片：

```typescript
const newElement = board.children[childrenCountBefore];
if (newElement) {
  clearSelectedElement(board);
  addSelectedElement(board, newElement);
}
```

这种行为在自动插入场景（如 AI 生成完成后自动插入）会覆盖用户当前的选中状态。

## 解决方案

### 方案设计

在 `insertImageFromUrl` 函数中添加 `skipSelect` 参数，控制插入后是否自动选中新图片：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `skipSelect` | `boolean` | `false` | 如果为 `true`，插入图片后不自动选中，避免覆盖用户当前选中状态 |

### 修改的文件

1. **`packages/drawnix/src/data/image.ts`**
   - 在 `insertImageFromUrl` 函数中添加 `skipSelect` 参数
   - 插入图片后，仅当 `skipSelect` 为 `false` 时才选中新图片

2. **自动插入场景调用处**（传入 `skipSelect: true`）：
   - `packages/drawnix/src/services/canvas-operations/canvas-insertion.ts` - 批量插入场景
   - `packages/drawnix/src/mcp/tools/canvas-insertion.ts` - MCP 批量插入场景
   - `packages/drawnix/src/services/canvas-operations/media-quick-insert.ts` - 快速插入场景
   - `packages/drawnix/src/hooks/useWorkflowSubmission.ts` - 工作流自动插入场景
   - `packages/drawnix/src/services/sw-capabilities/handler.ts` - Service Worker 自动插入场景

### 保持原有行为的场景

以下用户主动操作场景保持原有行为（插入后选中新图片）：

- 剪贴板粘贴图片
- 用户从工具栏插入图片
- 用户从媒体库选择图片
- 用户从任务队列点击插入按钮

## 架构变更说明

### 变更类型

**非破坏性变更** - 添加新参数，默认行为保持不变

### 影响范围

- **新增**：`insertImageFromUrl` 函数新增 `skipSelect` 参数
- **修改**：5 处自动插入场景调用点传入 `skipSelect: true`
- **兼容**：所有现有调用不受影响（默认选中新图片）

### 设计原则

1. **最小侵入性**：仅添加一个可选参数，不修改现有函数签名
2. **向后兼容**：默认行为保持不变，不影响现有功能
3. **场景分离**：区分自动插入和用户主动操作场景，分别处理

## 测试验证

### 测试场景

1. **选中图片后自动插入不应切换选中**：
   - 选中画布中的图片 A
   - 在对话框中编辑提示词
   - 触发另一张图片 B 的自动插入
   - 预期：图片 A 保持选中状态

2. **用户主动插入仍应选中新图片**：
   - 从媒体库选择图片插入
   - 预期：新插入的图片被选中

3. **批量插入不应影响选中状态**：
   - 选中图片 A
   - 触发批量图片生成
   - 预期：图片 A 保持选中状态

## 经验总结

1. **状态隔离原则**：自动操作不应干扰用户当前的交互状态
2. **参数化控制**：通过可选参数提供灵活的行为控制
3. **场景区分**：区分自动操作和用户主动操作，提供不同的默认行为
4. **最小变更**：在解决问题的同时，尽量减少对现有代码的影响

## 相关文件

- `packages/drawnix/src/data/image.ts` - 核心图片插入逻辑
- `packages/drawnix/src/services/canvas-operations/canvas-insertion.ts` - 批量插入服务
- `packages/drawnix/src/hooks/useWorkflowSubmission.ts` - 工作流提交钩子
