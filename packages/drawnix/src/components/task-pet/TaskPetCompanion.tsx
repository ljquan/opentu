import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ListTodo } from 'lucide-react';
import classNames from 'classnames';
import { useDraggablePosition } from '../../hooks/useDraggablePosition';
import {
  taskPetSettings,
  type TaskPetPosition,
  type TaskPetSettings,
} from '../../utils/settings-manager';
import { useTaskPetController } from './use-task-pet-controller';
import './task-pet.scss';

export type TaskPetVisualState =
  | 'idle'
  | 'running-left'
  | 'running-right'
  | 'waving'
  | 'running'
  | 'waiting'
  | 'review'
  | 'jumping'
  | 'failed';

export interface TaskPetCompanionProps {
  state: Exclude<TaskPetVisualState, 'running-left' | 'running-right'>;
  message: string | null;
  activeCount: number;
  motionEnabled: boolean;
  position: TaskPetPosition;
  onPositionCommit: (position: TaskPetPosition) => void;
  onOpenTasks: () => void;
}

interface TaskPetOverlayProps {
  onOpenTasks: () => void;
}

const PET_WIDTH = 112;
const PET_HEIGHT = 116;
const PET_VIEWPORT_PADDING = 12;

const STATE_LABELS: Record<TaskPetVisualState, string> = {
  idle: '灵宠待命',
  'running-left': '向左移动',
  'running-right': '向右移动',
  waving: '任务已开始',
  running: '任务处理中',
  waiting: '正在等待结果',
  review: '正在检查结果',
  jumping: '任务已完成',
  failed: '任务执行失败',
};

function normalizedToPixels(position: TaskPetPosition) {
  const viewportWidth =
    typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === 'undefined' ? 768 : window.innerHeight;
  return {
    x: position.x * viewportWidth - PET_WIDTH / 2,
    y: position.y * viewportHeight - PET_HEIGHT / 2,
  };
}

export const TaskPetCompanion = ({
  state,
  message,
  activeCount,
  motionEnabled,
  position: savedPosition,
  onPositionCommit,
  onOpenTasks,
}: TaskPetCompanionProps) => {
  const bubbleId = useId();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const initialPosition = normalizedToPixels(savedPosition);
  const commitPosition = useCallback(
    (nextPosition: { x: number; y: number }) => {
      const hostWidth = hostRef.current?.offsetWidth || PET_WIDTH;
      const hostHeight = hostRef.current?.offsetHeight || PET_HEIGHT;
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      onPositionCommit({
        x: Math.max(
          0,
          Math.min(1, (nextPosition.x + hostWidth / 2) / viewportWidth)
        ),
        y: Math.max(
          0,
          Math.min(1, (nextPosition.y + hostHeight / 2) / viewportHeight)
        ),
      });
    },
    [onPositionCommit]
  );
  const {
    position,
    isDragging,
    dragDirection,
    wasDraggedRef,
    elementRef,
    handlePointerDown,
  } = useDraggablePosition({
    initialPosition,
    viewportPadding: PET_VIEWPORT_PADDING,
    onCommit: commitPosition,
  });

  useEffect(() => {
    setExpanded(Boolean(message));
  }, [message, state]);

  const effectiveState: TaskPetVisualState = dragDirection
    ? `running-${dragDirection}`
    : state;
  const statusText = message || STATE_LABELS[effectiveState];
  const currentCenterX =
    ((position?.x ?? initialPosition.x) + PET_WIDTH / 2) /
    Math.max(1, typeof window === 'undefined' ? 1024 : window.innerWidth);
  const currentCenterY =
    ((position?.y ?? initialPosition.y) + PET_HEIGHT / 2) /
    Math.max(1, typeof window === 'undefined' ? 768 : window.innerHeight);
  const bubbleHorizontal = currentCenterX > 0.5 ? 'left' : 'right';
  const bubbleVertical = currentCenterY > 0.55 ? 'top' : 'bottom';

  return (
    <div
      ref={(node) => {
        hostRef.current = node;
        elementRef.current = node;
      }}
      className={classNames(
        'task-pet',
        `task-pet--${effectiveState}`,
        `task-pet--bubble-${bubbleHorizontal}`,
        `task-pet--bubble-${bubbleVertical}`,
        motionEnabled && 'task-pet--motion',
        isDragging && 'task-pet--dragging'
      )}
      style={
        position
          ? {
              left: `${position.x}px`,
              top: `${position.y}px`,
            }
          : undefined
      }
      data-state={effectiveState}
      data-testid="task-pet"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="task-pet__trigger"
        aria-label={`任务灵宠：${STATE_LABELS[effectiveState]}，可拖动`}
        aria-expanded={expanded}
        aria-controls={bubbleId}
        data-track="canvas_click_task_pet"
        data-testid="canvas-task-pet"
        onPointerDown={handlePointerDown}
        onClick={() => {
          if (!wasDraggedRef.current) {
            setExpanded((current) => !current);
          }
        }}
      >
        <span className="task-pet__sprite" aria-hidden="true">
          <img
            className="task-pet__image"
            src="/logo-tuzi.png"
            alt=""
            draggable={false}
          />
        </span>
        <span className="task-pet__state-indicator" aria-hidden="true" />
        {activeCount > 0 ? (
          <span className="task-pet__count" aria-hidden="true">
            {activeCount > 99 ? '99+' : activeCount}
          </span>
        ) : null}
      </button>

      <span className="task-pet__live" aria-live="polite" aria-atomic="true">
        {message || ''}
      </span>

      {expanded ? (
        <div
          id={bubbleId}
          className="task-pet__bubble"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="task-pet__bubble-heading">
            <span>画布小助手</span>
            <span className="task-pet__bubble-status" aria-hidden="true" />
          </div>
          <span className="task-pet__message">{statusText}</span>
          <button
            type="button"
            className="task-pet__tasks-button"
            onClick={() => {
              setExpanded(false);
              onOpenTasks();
            }}
          >
            <ListTodo size={15} aria-hidden="true" />
            <span>查看任务队列</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export const TaskPetOverlay = ({ onOpenTasks }: TaskPetOverlayProps) => {
  const [settings, setSettings] = useState<TaskPetSettings>(() =>
    taskPetSettings.get()
  );
  const presentation = useTaskPetController(settings);

  useEffect(() => {
    taskPetSettings.addListener(setSettings);
    return () => taskPetSettings.removeListener(setSettings);
  }, []);

  const handlePositionCommit = useCallback((position: TaskPetPosition) => {
    void taskPetSettings.update({ position });
  }, []);

  if (!settings.enabled) {
    return null;
  }

  return (
    <TaskPetCompanion
      {...presentation}
      message={presentation.message || null}
      motionEnabled={settings.motionEnabled}
      position={settings.position}
      onPositionCommit={handlePositionCommit}
      onOpenTasks={onOpenTasks}
    />
  );
};

export default TaskPetOverlay;
