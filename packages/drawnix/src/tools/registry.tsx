import React from 'react';
import type { ToolDefinition } from '../types/toolbox.types';
import { BUILT_IN_TOOL_MANIFESTS } from './built-in-manifests';
export type { ToolPluginModule } from './types';

type InternalComponentLoader = () => Promise<{
  default: React.ComponentType<any>;
}>;

const INTERNAL_COMPONENT_LOADERS = new Map<string, InternalComponentLoader>([
  [
    'batch-image',
    () =>
      import('./tools/batch-image').then((module) => ({
        default: module.BatchImageToolComponent,
      })),
  ],
  [
    'image-inspection',
    () =>
      import('./tools/image-inspection').then((module) => ({
        default: module.ImageInspectionToolComponent,
      })),
  ],
  [
    'model-benchmark',
    () =>
      import('./tools/model-benchmark').then((module) => ({
        default: module.ModelBenchmarkToolComponent,
      })),
  ],
  [
    'prompt-history',
    () =>
      import('./tools/prompt-history').then((module) => ({
        default: module.PromptHistoryToolComponent,
      })),
  ],
  [
    'knowledge-base',
    () =>
      import('./tools/knowledge-base').then((module) => ({
        default: module.KnowledgeBaseToolComponent,
      })),
  ],
  [
    'music-player',
    () =>
      import('./tools/music-player').then((module) => ({
        default: module.MusicPlayerToolComponent,
      })),
  ],
  [
    'music-analyzer',
    () =>
      import('./tools/music-analyzer').then((module) => ({
        default: module.MusicAnalyzerToolComponent,
      })),
  ],
  [
    'video-analyzer',
    () =>
      import('./tools/video-analyzer').then((module) => ({
        default: module.VideoAnalyzerToolComponent,
      })),
  ],
  [
    'mv-creator',
    () =>
      import('./tools/mv-creator').then((module) => ({
        default: module.MVCreatorToolComponent,
      })),
  ],
  [
    'comic-creator',
    () =>
      import('./tools/comic-creator').then((module) => ({
        default: module.ComicCreatorToolComponent,
      })),
  ],
]);

class ToolRegistry {
  private readonly builtInTools = BUILT_IN_TOOL_MANIFESTS;
  private readonly internalComponentLoaders = INTERNAL_COMPONENT_LOADERS;
  private readonly internalComponents = new Map<
    string,
    React.ComponentType<any>
  >();

  getBuiltInTools(): ToolDefinition[] {
    return this.builtInTools.map((tool) => ({ ...tool }));
  }

  getBuiltInToolIds(): string[] {
    return this.builtInTools.map((tool) => tool.id);
  }

  isBuiltInTool(toolId: string): boolean {
    return this.builtInTools.some((tool) => tool.id === toolId);
  }

  getManifestById(toolId: string): ToolDefinition | null {
    const tool = this.builtInTools.find((item) => item.id === toolId);
    return tool ? { ...tool } : null;
  }

  resolveInternalComponent(
    componentId?: string
  ): React.ComponentType<any> | null {
    if (!componentId) {
      return null;
    }

    const cachedComponent = this.internalComponents.get(componentId);
    if (cachedComponent) {
      return cachedComponent;
    }

    const loader = this.internalComponentLoaders.get(componentId);
    if (!loader) {
      return null;
    }

    const LazyComponent = React.lazy(loader);
    this.internalComponents.set(componentId, LazyComponent);
    return LazyComponent;
  }
}

export const toolRegistry = new ToolRegistry();
