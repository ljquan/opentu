/**
 * 历史记录页 - 分析历史列表 + 收藏 + 删除
 */

import React, { useCallback } from 'react';
import type { AnalysisRecord } from '../types';
import { updateRecord, deleteRecord } from '../storage';

interface HistoryPageProps {
  records: AnalysisRecord[];
  onSelect: (record: AnalysisRecord) => void;
  onRecordsChange: (records: AnalysisRecord[]) => void;
  showStarredOnly?: boolean;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({
  records,
  onSelect,
  onRecordsChange,
  showStarredOnly = false,
}) => {
  const filtered = showStarredOnly ? records.filter(r => r.starred) : records;

  const handleToggleStar = useCallback(async (e: React.MouseEvent, record: AnalysisRecord) => {
    e.stopPropagation();
    const updated = await updateRecord(record.id, { starred: !record.starred });
    onRecordsChange(updated);
  }, [onRecordsChange]);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = await deleteRecord(id);
    onRecordsChange(updated);
  }, [onRecordsChange]);

  if (filtered.length === 0) {
    return (
      <div className="va-page va-empty">
        <span>{showStarredOnly ? '暂无收藏' : '暂无分析记录'}</span>
      </div>
    );
  }

  return (
    <div className="va-page">
      <div className="va-history-list">
        {filtered.map(record => (
          <div
            key={record.id}
            className="va-history-item"
            onClick={() => onSelect(record)}
          >
            <div className="va-history-header">
              <span className="va-history-source">
                {record.source === 'youtube' ? '🔗' : '📁'} {record.sourceLabel}
              </span>
              <button
                className={`va-star-btn ${record.starred ? 'starred' : ''}`}
                onClick={e => handleToggleStar(e, record)}
              >
                {record.starred ? '★' : '☆'}
              </button>
            </div>
            <div className="va-history-meta">
              <span>{new Date(record.createdAt).toLocaleString()}</span>
              <span>{record.analysis.shotCount} 镜头</span>
              <span>{record.model}</span>
            </div>
            {record.analysis.video_style && (
              <div className="va-history-style">{record.analysis.video_style}</div>
            )}
            <button
              className="va-history-delete"
              onClick={e => handleDelete(e, record.id)}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
