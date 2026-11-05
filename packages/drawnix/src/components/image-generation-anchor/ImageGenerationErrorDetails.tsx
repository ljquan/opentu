import React from 'react';
import { ImageGenerationCopyButton } from './ImageGenerationCopyButton';
import type { ImageGenerationAnchorViewModel } from '../../types/image-generation-anchor.types';
import { formatGenerationErrorReport } from '../../utils/generation-error-details';

interface Props {
  phaseLabel: string;
  failure?: ImageGenerationAnchorViewModel['failureDetails'];
  localTaskId: string;
  workflowId: string;
  anchorType: string;
  transitionMode: string;
}

export const ImageGenerationErrorDetails: React.FC<Props> = ({
  phaseLabel,
  failure,
  localTaskId,
  workflowId,
  anchorType,
  transitionMode,
}) => {
  const rows: [string, string][] = [
    ['阶段', phaseLabel || '—'],
    ['模型', failure?.modelId || '未记录'],
    ['错误', failure?.error || '无'],
    ['Request ID', failure?.requestId || '未获取到'],
  ];
  if (failure?.remoteId) rows.push(['任务 ID', failure.remoteId]);
  rows.push(
    ['本地任务', localTaskId || '未获取到'],
    ['工作流', workflowId || '未获取到'],
    ['形态', anchorType || '—'],
    ['过渡', transitionMode || '—']
  );
  const report = formatGenerationErrorReport(rows);
  const row = ([label, value]: [string, string], index: number) => (
    <div className="image-generation-anchor__detail-row" key={label}>
      <span className="image-generation-anchor__detail-label">{label}</span>
      <div className="image-generation-anchor__copy-value">
        <span
          className={`image-generation-anchor__detail-value${
            ['Request ID', '任务 ID', '本地任务', '工作流'].includes(label)
              ? ' image-generation-anchor__detail-value--id'
              : ''
          }`}
        >
          {value}
        </span>
        {index === 0 && (
          <ImageGenerationCopyButton
            label="全部错误信息"
            value={report}
            detail
          />
        )}
      </div>
    </div>
  );

  return (
    <div
      className="image-generation-anchor__details"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {rows.map(row)}
    </div>
  );
};
