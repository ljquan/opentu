import React, { lazy, Suspense, type CSSProperties } from 'react';
import type { ToolPluginModule } from '../../registry';
import { ToolCategory } from '../../../types/toolbox.types';
import { MODEL_BENCHMARK_TOOL_ID } from '../../tool-ids';

const ModelBenchmarkWorkbench = lazy(
  () => import('../../../components/model-benchmark/ModelBenchmarkWorkbench')
);

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const LoadingFallback: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: 200,
      color: '#999',
      fontSize: 14,
    }}
  >
    加载中...
  </div>
);

export const ModelBenchmarkToolComponent: React.FC<Record<string, unknown>> = (props) => (
  <div style={containerStyle}>
    <Suspense fallback={<LoadingFallback />}>
      <ModelBenchmarkWorkbench {...props} />
    </Suspense>
  </div>
);

export const modelBenchmarkTool: ToolPluginModule = {
  manifest: {
    id: MODEL_BENCHMARK_TOOL_ID,
    name: '模型测试',
    description: '批量比较图、文、视频、音频模型的速度与主观效果',
    icon: '🧪',
    category: ToolCategory.AI_TOOLS,
    component: MODEL_BENCHMARK_TOOL_ID,
    defaultWidth: 1280,
    defaultHeight: 860,
  },
  Component: ModelBenchmarkToolComponent,
};
