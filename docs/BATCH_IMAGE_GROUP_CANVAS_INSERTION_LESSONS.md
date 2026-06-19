# 批量出图按提交批次分组插入画布

## 背景

批量出图工具生成的图片插入画布后随机分布，用户无法直观区分不同批次提交的图片。需要让同一次提交产出的图片在画布上自动分组排列，不同批次之间有明显分隔。

## 方案

### 分组键传递

在批量出图组件 `batch-image-generation.tsx` 的 `executeSubmit` 中，为每个任务添加 `batchGroupId` 参数，值为 `batch-submit-${globalBatchTimestamp}`。同一批次提交的所有任务共享相同的时间戳，因此共享相同的分组键。

### 分组键识别

在 `image-generation-anchor-task.ts` 的 `getImageGenerationTaskInsertGroupKey` 函数顶部新增判断：

```typescript
if (typeof task.params.batchGroupId === 'string') {
  return `batch-row:${task.params.batchGroupId}`;
}
```

该判断在所有其他分组逻辑之前执行，确保批量出图任务优先按批次分组。

### 画布排列

`executeCanvasInsertion` 已内置 `precalculateGroupedGridLayout` 逻辑：
- 同 `groupId` 的图片在网格中水平排列，超出画布宽度自动换行
- 不同 `groupId` 的图片组之间垂直分隔（默认 50px 间距）

## 影响范围

- **仅影响批量出图工具**：`batchGroupId` 只有该工具设置，其他功能（AI 对话出图、PPT 出图、单张出图等）完全不受影响
- 所有现有测试用例（13 个）通过，无回归

## 涉及文件

| 文件 | 改动 |
|------|------|
| `packages/drawnix/src/components/ttd-dialog/batch-image-generation.tsx` | 任务参数新增 `batchGroupId` |
| `packages/drawnix/src/utils/image-generation-anchor-task.ts` | `getImageGenerationTaskInsertGroupKey` 新增 `batchGroupId` 判断 |