/**
 * 步骤条组件
 */

import React from 'react';
import type { PageId } from '../types';

const STEPS: Array<{ id: PageId; label: string }> = [
  { id: 'analyze', label: '分析' },
  { id: 'script', label: '脚本' },
  { id: 'generate', label: '生成' },
];

interface StepBarProps {
  current: PageId;
  onNavigate: (page: PageId) => void;
  /** 是否允许跳转到脚本/生成（需要有分析结果） */
  hasRecord: boolean;
}

export const StepBar: React.FC<StepBarProps> = ({ current, onNavigate, hasRecord }) => {
  const currentIdx = STEPS.findIndex(s => s.id === current);

  return (
    <div className="va-step-bar">
      {STEPS.map((step, i) => {
        const isActive = step.id === current;
        const isPast = i < currentIdx;
        const isDisabled = !hasRecord && i > 0;

        return (
          <React.Fragment key={step.id}>
            {i > 0 && <span className="va-step-arrow">→</span>}
            <button
              className={`va-step ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
              onClick={() => !isDisabled && onNavigate(step.id)}
              disabled={isDisabled}
            >
              <span className="va-step-num">{i + 1}</span>
              {step.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};
