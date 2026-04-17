import React from 'react';
import type { PageId } from '../types';

const STEPS: Array<{ id: Exclude<PageId, 'history'>; label: string }> = [
  { id: 'analyze', label: '分析' },
  { id: 'script', label: '脚本' },
  { id: 'generate', label: '生成' },
];

interface StepBarProps {
  current: PageId;
  onNavigate: (page: Exclude<PageId, 'history'>) => void;
  hasRecord: boolean;
  /** 是否有分镜数据（控制"生成"步骤是否可点击） */
  hasShots: boolean;
}

export const StepBar: React.FC<StepBarProps> = ({
  current,
  onNavigate,
  hasRecord,
  hasShots,
}) => {
  const currentIdx = STEPS.findIndex(item => item.id === current);

  return (
    <div className="va-step-bar">
      {STEPS.map((step, index) => {
        const isActive = step.id === current;
        const isPast = index < currentIdx;
        const isDisabled =
          (!hasRecord && index > 0) || ((step.id === 'script' || step.id === 'generate') && !hasShots);

        return (
          <React.Fragment key={step.id}>
            {index > 0 && <span className="va-step-arrow">→</span>}
            <button
              className={`va-step ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
              onClick={() => !isDisabled && onNavigate(step.id)}
              disabled={isDisabled}
            >
              <span className="va-step-num">{index + 1}</span>
              {step.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
