import React, { type CSSProperties } from 'react';
import { ImageInspectionReport } from '../../../components/model-benchmark/ImageInspectionReport';
import { ImageInspectionIcon } from '../../../components/icons';
import { IMAGE_INSPECTION_TOOL_ID } from '../../tool-ids';
import { ToolCategory } from '../../../types/toolbox.types';
import type { ToolPluginModule } from '../../types';

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

export interface ImageInspectionToolProps {
  autoRunToken?: number;
}

interface ImageInspectionErrorBoundaryState {
  error: Error | null;
}

class ImageInspectionErrorBoundary extends React.Component<
  React.PropsWithChildren,
  ImageInspectionErrorBoundaryState
> {
  state: ImageInspectionErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ImageInspection] Report render failed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          padding: 24,
          color: '#344054',
          background: '#fff',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <h2 style={{ marginTop: 0 }}>巡检报表显示异常</h2>
        <p>已隔离异常，不会导致 OpenTu 闪退。服务端后台巡检仍会继续运行。</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{
            border: '1px solid #175cd3',
            borderRadius: 8,
            padding: '8px 14px',
            background: '#175cd3',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          重新加载报表
        </button>
      </div>
    );
  }
}

export const ImageInspectionToolComponent: React.FC<
  ImageInspectionToolProps
> = ({ autoRunToken }) => (
  <div style={containerStyle}>
    <ImageInspectionErrorBoundary>
      <ImageInspectionReport autoRunToken={autoRunToken} />
    </ImageInspectionErrorBoundary>
  </div>
);

export const imageInspectionTool: ToolPluginModule = {
  manifest: {
    id: IMAGE_INSPECTION_TOOL_ID,
    name: '生图巡检报表',
    description: '自动测试各分组生图模型的比例与尺寸，并汇总真实图片 URL',
    icon: <ImageInspectionIcon size={18} />,
    category: ToolCategory.AI_TOOLS,
    component: IMAGE_INSPECTION_TOOL_ID,
    defaultWidth: 1280,
    defaultHeight: 860,
  },
  Component: ImageInspectionToolComponent,
};
