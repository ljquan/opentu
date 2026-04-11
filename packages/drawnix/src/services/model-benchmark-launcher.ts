import { atom } from 'jotai';
import { getDefaultStore } from 'jotai/vanilla';
import { toolWindowService } from './tool-window-service';
import { toolRegistry } from '../tools/registry';
import { MODEL_BENCHMARK_TOOL_ID } from '../tools/tool-ids';
import type { ToolDefinition } from '../types/toolbox.types';
import type { ModelBenchmarkLaunchRequest } from './model-benchmark-service';

/**
 * 全局 atom：从设置等外部入口传递给 ModelBenchmarkWorkbench 的启动请求。
 * 使用 jotai 绕过 componentProps → React props 的时序问题。
 */
export const benchmarkLaunchAtom = atom<ModelBenchmarkLaunchRequest | null>(null);

function createFallbackTool(): ToolDefinition {
  return {
    id: MODEL_BENCHMARK_TOOL_ID,
    name: '模型测试',
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

  // 写入全局 atom，Workbench 通过 useAtomValue 订阅
  if (initialRequest) {
    getDefaultStore().set(benchmarkLaunchAtom, {
      ...initialRequest,
      launchedAt: Date.now(),
    });
  }

  toolWindowService.openTool(tool, { autoMaximize: true });
  return true;
}
