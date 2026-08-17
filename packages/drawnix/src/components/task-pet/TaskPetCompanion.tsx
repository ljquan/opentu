import { useEffect, useId, useState } from 'react';
import { ListTodo } from 'lucide-react';
import classNames from 'classnames';
import './task-pet.scss';

export type TaskPetVisualState =
  | 'idle'
  | 'wave'
  | 'running'
  | 'waiting'
  | 'review'
  | 'jumping'
  | 'failed';

export interface TaskPetCompanionProps {
  state: TaskPetVisualState;
  message: string | null;
  activeCount: number;
  motionEnabled: boolean;
  onOpenTasks: () => void;
}

const STATE_LABELS: Record<TaskPetVisualState, string> = {
  idle: '灵宠待命',
  wave: '任务已开始',
  running: '任务处理中',
  waiting: '正在等待结果',
  review: '正在检查结果',
  jumping: '任务已完成',
  failed: '任务执行失败',
};

export const TaskPetCompanion = ({
  state,
  message,
  activeCount,
  motionEnabled,
  onOpenTasks,
}: TaskPetCompanionProps) => {
  const bubbleId = useId();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(Boolean(message));
  }, [message, state]);

  const statusText = message || STATE_LABELS[state];

  return (
    <div
      className={classNames(
        'task-pet',
        `task-pet--${state}`,
        motionEnabled && 'task-pet--motion'
      )}
      data-state={state}
      data-testid="task-pet"
    >
      <button
        type="button"
        className="task-pet__trigger"
        aria-label={`任务灵宠：${STATE_LABELS[state]}`}
        aria-expanded={expanded}
        aria-controls={bubbleId}
        data-track="toolbar_click_task_pet"
        data-testid="toolbar-task-pet"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setExpanded((current) => !current)}
      >
        <img
          className="task-pet__image"
          src="/logo-tuzi.png"
          alt=""
          draggable={false}
        />
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
        <div id={bubbleId} className="task-pet__bubble">
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

export default TaskPetCompanion;
