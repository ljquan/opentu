/**
 * MCP 模块统一导出
 */

// 导出类型
export * from './types';

// 导出注册中心
export { mcpRegistry, MCPRegistry } from './registry';

// 导出工具
export { imageGenerationTool, getCurrentImageModel } from './tools/image-generation';
export { videoGenerationTool, getCurrentVideoModel } from './tools/video-generation';
export { audioGenerationTool, getCurrentAudioModel } from './tools/audio-generation';
export { textGenerationTool, getCurrentTextModel } from './tools/text-generation';
export {
  canvasInsertionTool,
  setCanvasBoard,
  getCanvasBoard,
  quickInsert,
  insertImageGroup,
  insertAIFlow,
} from './tools/canvas-insertion';
export type { ContentType, InsertionItem, CanvasInsertionParams } from './tools/canvas-insertion';
export { mermaidTool, insertMermaid, setMermaidBoard, getMermaidBoard } from './tools/mermaid-tool';
export type { MermaidToolParams } from './tools/mermaid-tool';
export { mindmapTool, insertMindmap } from './tools/mindmap-tool';
export type { MindmapToolParams } from './tools/mindmap-tool';
export { gridImageTool, createGridImageTask } from './tools/photo-wall-tool';
export type { GridImageToolParams } from './tools/photo-wall-tool';
export { inspirationBoardTool, createInspirationBoardTask } from './tools/creative-photo-wall-tool';
export type { InspirationBoardParams } from './tools/creative-photo-wall-tool';
export { splitImageTool } from './tools/split-image-tool';
export type { SplitImageToolParams } from './tools/split-image-tool';
export { svgTool, insertSvg } from './tools/svg-tool';
export type { SvgToolParams } from './tools/svg-tool';
export { longVideoGenerationTool, createLongVideoTask } from './tools/long-video-generation';
export type { LongVideoGenerationParams } from './tools/long-video-generation';
export { pptGenerationTool, generatePPT } from './tools/ppt-generation';
export type { PPTGenerationParams } from '../services/ppt';
export { knowledgeBaseTools } from './tools/knowledge-base-tool';
export { videoAnalyzeTool } from './tools/video-analyze';
export type { VideoAnalyzeParams, VideoAnalysisData, VideoShot } from './tools/video-analyze';

// 共享模块导出
export { setBoard, getBoard } from './tools/shared';

// 初始化函数：注册所有内置工具
import { mcpRegistry } from './registry';
import { imageGenerationTool } from './tools/image-generation';
import { videoGenerationTool } from './tools/video-generation';
import { audioGenerationTool } from './tools/audio-generation';
import { textGenerationTool } from './tools/text-generation';
import { canvasInsertionTool } from './tools/canvas-insertion';
import { aiAnalyzeTool } from './tools/ai-analyze';
import { mermaidTool } from './tools/mermaid-tool';
import { mindmapTool } from './tools/mindmap-tool';
import { gridImageTool } from './tools/photo-wall-tool';
import { inspirationBoardTool } from './tools/creative-photo-wall-tool';
import { splitImageTool } from './tools/split-image-tool';
import { svgTool } from './tools/svg-tool';
import { longVideoGenerationTool } from './tools/long-video-generation';
import { pptGenerationTool } from './tools/ppt-generation';
import { knowledgeBaseTools } from './tools/knowledge-base-tool';
import { videoAnalyzeTool } from './tools/video-analyze';

/** 标记 MCP 是否已初始化 */
let mcpInitialized = false;

/**
 * 初始化 MCP 模块，注册所有内置工具
 * 多次调用只会执行一次
 */
export function initializeMCP(): void {
  if (mcpInitialized) {
    return;
  }
  mcpInitialized = true;

  mcpRegistry.registerAll([
    imageGenerationTool,
    videoGenerationTool,
    audioGenerationTool,
    textGenerationTool,
    longVideoGenerationTool,
    canvasInsertionTool,
    aiAnalyzeTool,
    mermaidTool,
    mindmapTool,
    gridImageTool,
    inspirationBoardTool,
    splitImageTool,
    svgTool,
    pptGenerationTool,
    ...knowledgeBaseTools,
    videoAnalyzeTool,
  ]);
  // console.log('[MCP] Initialized with built-in tools');
}
