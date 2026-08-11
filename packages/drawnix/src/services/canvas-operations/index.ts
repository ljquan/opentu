/**
 * Canvas Operations - 画布操作服务
 *
 * 提供各种画布操作的核心逻辑，供 SW Capabilities Handler 调用
 */

export { createGridImageTask } from './grid-image';
export type { GridImageParams } from './grid-image';

export { createInspirationBoardTask } from './inspiration-board';
export type { InspirationBoardParams } from './inspiration-board';

export { analyzeWithAI } from './ai-analyze';
export type { AIAnalyzeParams, AIAnalyzeResult } from './ai-analyze';

export {
  createLongVideoTask,
  createLongVideoSegmentTask,
} from './long-video';
export type {
  LongVideoGenerationParams,
  LongVideoMeta,
  VideoSegmentScript,
} from './long-video';

export {
  quickInsert,
  insertImageGroup,
  insertGeneratedImageFlow,
  insertAIFlow,
  executeCanvasInsertion,
  setCanvasBoard,
  getCanvasBoard,
} from './canvas-insertion';
export { parseSizeToPixels } from '../../utils/size-ratio';
export type {
  ContentType,
  InsertionItem,
  CanvasInsertionParams,
  CanvasInsertionResultData,
  CanvasInsertionResultItem,
  MediaFlowResult,
} from './canvas-insertion';
