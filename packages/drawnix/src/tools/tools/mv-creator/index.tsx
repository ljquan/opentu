import React, { lazy, Suspense, type CSSProperties } from 'react';
import type { ToolPluginModule } from '../../registry';
import { ToolCategory } from '../../../types/toolbox.types';

const MVCreatorOriginal = lazy(
  () => import('../../../components/mv-creator/MVCreator')
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

export const MVCreatorToolComponent: React.FC<Record<string, unknown>> = (props) => (
  <div style={containerStyle}>
    <Suspense fallback={<LoadingFallback />}>
      <MVCreatorOriginal {...props} />
    </Suspense>
  </div>
);

export const mvCreatorTool: ToolPluginModule = {
  manifest: {
    id: 'mv-creator',
    name: '爆款MV生成',
    description: '输入创意，AI 生成音乐和分镜视频，一站式 MV 创作',
    icon: '🎥',
    category: ToolCategory.AI_TOOLS,
    component: 'mv-creator',
    supportsMultipleWindows: true,
    defaultWindowBehavior: {
      autoPinOnOpen: true,
    },
    defaultWidth: 520,
    defaultHeight: 700,
  },
  Component: MVCreatorToolComponent,
};
