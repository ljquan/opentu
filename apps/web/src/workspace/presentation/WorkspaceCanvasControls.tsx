import {
  Crosshair,
  Map,
  Maximize2,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type WorkspaceCanvasAction =
  | 'undo'
  | 'redo'
  | 'zoom-out'
  | 'fit'
  | 'zoom-in'
  | 'minimap'
  | 'focus';

interface WorkspaceCanvasControlsProps {
  onAction: (action: WorkspaceCanvasAction) => void;
}

const controls: Array<{
  action: WorkspaceCanvasAction;
  label: string;
  icon: typeof Undo2;
}> = [
  { action: 'undo', label: '撤销', icon: Undo2 },
  { action: 'redo', label: '重做', icon: Redo2 },
  { action: 'zoom-out', label: '缩小', icon: ZoomOut },
  { action: 'fit', label: '适应画布', icon: Crosshair },
  { action: 'zoom-in', label: '放大', icon: ZoomIn },
  { action: 'minimap', label: '小地图', icon: Map },
];

export function WorkspaceCanvasControls({
  onAction,
}: WorkspaceCanvasControlsProps) {
  return (
    <div
      className="next-workspace__canvas-controls"
      role="toolbar"
      aria-label="画布快捷控制"
    >
      {controls.map(({ action, label, icon: Icon }) => (
        <button
          key={action}
          type="button"
          aria-label={label}
          title={label}
          onClick={() => onAction(action)}
        >
          <Icon size={15} />
        </button>
      ))}
      <span
        className="next-workspace__canvas-controls-divider"
        aria-hidden="true"
      />
      <button
        type="button"
        aria-label="专注画布"
        title="专注画布"
        onClick={() => onAction('focus')}
      >
        <Maximize2 size={15} />
      </button>
    </div>
  );
}
