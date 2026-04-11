import { toolWindowService } from './tool-window-service';
import { toolRegistry } from '../tools/registry';
import { MODEL_BENCHMARK_TOOL_ID } from '../tools/tool-ids';
import type { ToolDefinition } from '../types/toolbox.types';
import type { ModelBenchmarkLaunchRequest } from './model-benchmark-service';

function createFallbackTool(): ToolDefinition {
  return {
    id: MODEL_BENCHMARK_TOOL_ID,
    name: '模型选型工作台',
    description: '批量测试图、文、视频、音频模型，快速比较速度与主观效果',
    icon: '🧪',
    category: 'ai-tools',
    component: MODEL_BENCHMARK_TOOL_ID,
    defaultWidth: 1280,
    defaultHeight: 860,
  };
}

export function openModelBenchmarkTool(
  initialRequest?: ModelBenchmarkLaunchRequest
): boolean {
  const tool =
    toolRegistry.getManifestById(MODEL_BENCHMARK_TOOL_ID) || createFallbackTool();
  toolWindowService.openTool(tool, {
    autoMaximize: true,
    componentProps: initialRequest
      ? {
          initialRequest: {
            ...initialRequest,
            launchedAt: Date.now(),
          },
        }
      : undefined,
  });
  return true;
}
