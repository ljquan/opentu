/**
 * MCP 工具共享模块统一导出
 */

// Board 管理
export { setBoard, getBoard, isBoardAvailable, requireBoard } from './board-utils';

// 插入工具
export {
  extractCodeBlock,
  calculateElementsBoundingRect,
  getInsertionPoint,
  insertElementsToCanvas,
  // 重叠检测相关
  isOverlapping,
  getAllElementBoundingBoxes,
  hasOverlapWithAny,
  findNonOverlappingPosition,
  // 插入后重叠调整相关
  getElementActualBoundingBox,
  getOtherElementBoundingBoxes,
  moveElement,
  getInitialInsertionPoint,
  adjustOverlappingElements,
} from './insert-utils';
export type { CodeBlockResult, InsertResult, BoundingBox } from './insert-utils';

// 队列任务工具
export {
  createQueueTask,
  validatePrompt,
  wrapApiError,
  toUploadedImages,
} from './queue-utils';
export type { BaseGenerationParams, QueueTaskConfig } from './queue-utils';
