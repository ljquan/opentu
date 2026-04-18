import React, { lazy, Suspense, type CSSProperties } from 'react';
import type { ToolPluginModule } from '../../registry';
import { ToolCategory } from '../../../types/toolbox.types';
import { DiscAlbum } from 'lucide-react';

const MusicAnalyzerOriginal = lazy(
  () => import('../../../components/music-analyzer/MusicAnalyzer')
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

export const MusicAnalyzerToolComponent: React.FC<Record<string, unknown>> = (props) => (
  <div style={containerStyle}>
    <Suspense fallback={<LoadingFallback />}>
      <MusicAnalyzerOriginal {...props} />
    </Suspense>
  </div>
);

export const musicAnalyzerTool: ToolPluginModule = {
  manifest: {
    id: 'music-analyzer',
    name: '爆款音乐生成',
    description: '分析音频、改写歌词，并一键送入 Suno 生成音乐',
    icon: <DiscAlbum size={18} strokeWidth={1.75} />,
    category: ToolCategory.AI_TOOLS,
    component: 'music-analyzer',
    supportsMultipleWindows: true,
    defaultWindowBehavior: {
      autoPinOnOpen: true,
    },
    defaultWidth: 520,
    defaultHeight: 700,
  },
  Component: MusicAnalyzerToolComponent,
};
