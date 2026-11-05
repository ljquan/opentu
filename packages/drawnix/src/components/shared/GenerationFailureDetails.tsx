import React from 'react';
import { ImageGenerationCopyButton as CopyButton } from '../image-generation-anchor/ImageGenerationCopyButton';
import type { getGenerationFailureDetails } from '../../utils/generation-error-details';
import { formatGenerationErrorReport } from '../../utils/generation-error-details';
import './generation-failure-details.scss';

export const GenerationFailureDetails: React.FC<{
  details: ReturnType<typeof getGenerationFailureDetails>;
}> = ({ details }) => {
  const rows: [string, string][] = [
    ['Request ID', details.requestId || '未获取到'],
    ['错误', details.error || '执行失败'],
    ['模型', details.modelId || '未记录'],
  ];
  if (details.remoteId) rows.push(['任务 ID', details.remoteId]);
  const report = formatGenerationErrorReport(rows);
  const row = ([label, value]: [string, string], index: number) => (
    <div className="generation-failure-details__row" key={label}>
      <span className="generation-failure-details__label">{label}</span>
      <div
        className={`generation-failure-details__value${
          label === '错误' ? ' generation-failure-details__value--error' : ''
        }`}
      >
        <span>{value}</span>
        {index === 0 && (
          <CopyButton
            label="全部错误信息"
            value={report}
            className="generation-failure-details__copy"
          />
        )}
      </div>
    </div>
  );
  return (
    <div
      className="generation-failure-details"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {rows.map(row)}
    </div>
  );
};
