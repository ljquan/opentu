import React from 'react';
import { lazy, Suspense, type CSSProperties } from 'react';
import type { ToolPluginModule } from '../../registry';
import { ToolCategory } from '../../../types/toolbox.types';

const VideoAnalyzerOriginal = lazy(
  () => import('../../../components/video-analyzer/VideoAnalyzer')
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

export const VideoAnalyzerToolComponent: React.FC<Record<string, unknown>> = (props) => (
  <div style={containerStyle}>
    <Suspense fallback={<LoadingFallback />}>
      <VideoAnalyzerOriginal {...props} />
    </Suspense>
  </div>
);

export const videoAnalyzerTool: ToolPluginModule = {
  manifest: {
    id: 'video-analyzer',
    name: '爆款视频生成',
    description: 'AI 分析视频内容，提取镜头、脚本、风格等结构化数据',
    icon: '🎬',
    category: ToolCategory.AI_TOOLS,
    component: 'video-analyzer',
    supportsMultipleWindows: true,
    defaultWindowBehavior: {
      autoPinOnOpen: true,
    },
    defaultWidth: 680,
    defaultHeight: 700,
  },
  Component: VideoAnalyzerToolComponent,
};
