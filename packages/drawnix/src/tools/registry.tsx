import React from 'react';
import type { ToolDefinition } from '../types/toolbox.types';
import { bananaPromptTool } from './tools/banana-prompt';
import { poseLibraryTool } from './tools/pose-library';
import { chatMjTool } from './tools/chat-mj';
import { batchImageTool, BatchImageToolComponent } from './tools/batch-image';
import { knowledgeBaseTool, KnowledgeBaseToolComponent } from './tools/knowledge-base';
import { musicPlayerTool, MusicPlayerToolComponent } from './tools/music-player';
import {
  modelBenchmarkTool,
  ModelBenchmarkToolComponent,
} from './tools/model-benchmark';
import { musicAnalyzerTool, MusicAnalyzerToolComponent } from './tools/music-analyzer';
import { videoAnalyzerTool, VideoAnalyzerToolComponent } from './tools/video-analyzer';
import { mvCreatorTool, MVCreatorToolComponent } from './tools/mv-creator';

export interface ToolPluginModule {
  manifest: ToolDefinition;
  Component?: React.ComponentType<any>;
}

const BUILT_IN_TOOL_PLUGINS: ToolPluginModule[] = [
  bananaPromptTool,
  poseLibraryTool,
  chatMjTool,
  batchImageTool,
  modelBenchmarkTool,
  knowledgeBaseTool,
  musicPlayerTool,
  musicAnalyzerTool,
  videoAnalyzerTool,
  mvCreatorTool,
];

const INTERNAL_COMPONENTS = new Map<string, React.ComponentType<any>>([
  ['batch-image', BatchImageToolComponent],
  ['model-benchmark', ModelBenchmarkToolComponent],
  ['knowledge-base', KnowledgeBaseToolComponent],
  ['music-player', MusicPlayerToolComponent],
  ['music-analyzer', MusicAnalyzerToolComponent],
  ['video-analyzer', VideoAnalyzerToolComponent],
  ['mv-creator', MVCreatorToolComponent],
]);

class ToolRegistry {
  private readonly builtInToolPlugins = BUILT_IN_TOOL_PLUGINS;
  private readonly internalComponents = INTERNAL_COMPONENTS;

  getBuiltInTools(): ToolDefinition[] {
    return this.builtInToolPlugins.map((tool) => ({ ...tool.manifest }));
  }

  getBuiltInToolIds(): string[] {
    return this.builtInToolPlugins.map((tool) => tool.manifest.id);
  }

  isBuiltInTool(toolId: string): boolean {
    return this.builtInToolPlugins.some((tool) => tool.manifest.id === toolId);
  }

  getManifestById(toolId: string): ToolDefinition | null {
    const plugin = this.builtInToolPlugins.find((tool) => tool.manifest.id === toolId);
    return plugin ? { ...plugin.manifest } : null;
  }

  resolveInternalComponent(componentId?: string): React.ComponentType<any> | null {
    if (!componentId) {
      return null;
    }
    return this.internalComponents.get(componentId) || null;
  }
}

export const toolRegistry = new ToolRegistry();
