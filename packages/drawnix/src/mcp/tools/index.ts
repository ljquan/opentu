/**
 * MCP 工具统一导出
 */

export { imageGenerationTool, generateImage, createImageTask } from './image-generation';
export type { ImageGenerationParams } from './image-generation';

export { videoGenerationTool, generateVideo, createVideoTask } from './video-generation';
export type { VideoGenerationParams } from './video-generation';

export { audioGenerationTool, generateAudio } from './audio-generation';
export type { AudioGenerationParams } from './audio-generation';

export { aiAnalyzeTool, analyzeWithAI } from './ai-analyze';
export type { AIAnalyzeParams, AIAnalyzeResult } from './ai-analyze';

export { mermaidTool, insertMermaid, setMermaidBoard, getMermaidBoard } from './mermaid-tool';
export type { MermaidToolParams } from './mermaid-tool';

export { mindmapTool, insertMindmap } from './mindmap-tool';
export type { MindmapToolParams } from './mindmap-tool';

export { pptGenerationTool, generatePPT } from './ppt-generation';
export type { PPTGenerationParams } from '../../services/ppt';

export { knowledgeBaseTools, kbSearchNotesTool, kbGetNoteTool, kbCreateNoteTool, kbListDirectoriesTool } from './knowledge-base-tool';

// 共享模块导出
export { setBoard, getBoard, isBoardAvailable, requireBoard } from './shared';
export { extractCodeBlock, getInsertionPoint, insertElementsToCanvas } from './shared';
export type { CodeBlockResult, InsertResult } from './shared';
