/**
 * 视频拆解器 - 主容器
 *
 * 多步骤工作流：分析 → 脚本编辑 → 素材生成
 * 支持历史记录和收藏
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { PageId, AnalysisRecord } from './types';
import { loadRecords } from './storage';
import { StepBar } from './components/StepBar';
import { AnalyzePage } from './pages/AnalyzePage';
import { ScriptPage } from './pages/ScriptPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import { taskQueueService } from '../../services/task-queue';
import { syncVideoAnalyzerTask, isVideoAnalyzerTask } from './task-sync';
import './VideoAnalyzer.scss';

const VideoAnalyzer: React.FC = () => {
  const [page, setPage] = useState<PageId>('analyze');
  const [currentRecord, setCurrentRecord] = useState<AnalysisRecord | null>(null);
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [showStarred, setShowStarred] = useState(false);

  useEffect(() => {
    loadRecords().then(setRecords);
  }, []);

  useEffect(() => {
    let disposed = false;
    const syncingTaskIds = new Set<string>();

    const syncTask = async (task: Parameters<typeof syncVideoAnalyzerTask>[0]) => {
      if (!isVideoAnalyzerTask(task) || syncingTaskIds.has(task.id)) {
        return;
      }

      syncingTaskIds.add(task.id);
      try {
        const synced = await syncVideoAnalyzerTask(task);
        if (!synced || disposed) {
          return;
        }

        setRecords(synced.records);
        setCurrentRecord(prev => {
          if (prev?.id === synced.record.id) {
            return synced.record;
          }
          if (!prev && task.params.videoAnalyzerAction === 'analyze') {
            return synced.record;
          }
          return prev;
        });
      } catch (error) {
        console.error('[VideoAnalyzer] Failed to sync task result:', error);
      } finally {
        syncingTaskIds.delete(task.id);
      }
    };

    taskQueueService.getAllTasks().forEach(task => {
      void syncTask(task);
    });

    const subscription = taskQueueService.observeTaskUpdates().subscribe(event => {
      if (event.task.status === 'completed') {
        void syncTask(event.task);
      }
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleAnalysisComplete = useCallback((record: AnalysisRecord) => {
    setCurrentRecord(record);
  }, []);

  const handleHistorySelect = useCallback((record: AnalysisRecord) => {
    setCurrentRecord(record);
    setPage('analyze');
  }, []);

  const handleRecordUpdate = useCallback((record: AnalysisRecord) => {
    setCurrentRecord(record);
  }, []);

  const handleRestart = useCallback(() => {
    setCurrentRecord(null);
    setPage('analyze');
  }, []);

  const handleNavigate = useCallback((target: PageId) => {
    if (target === 'history') {
      setShowStarred(false);
    }
    setPage(target);
  }, []);

  return (
    <div className="video-analyzer">
      {/* 顶部导航栏：步骤条 + 历史/收藏入口 */}
      <div className="va-nav">
        {page === 'history' ? (
          <>
            <button className="va-nav-back" onClick={() => setPage('analyze')}>←</button>
            <span className="va-nav-title">{showStarred ? '收藏' : '历史记录'}</span>
            <button
              className={`va-nav-btn ${showStarred ? 'active' : ''}`}
              onClick={() => setShowStarred(s => !s)}
            >
              {showStarred ? '★ 收藏' : '☆ 全部'}
            </button>
          </>
        ) : (
          <>
            <StepBar current={page} onNavigate={handleNavigate} hasRecord={!!currentRecord} />
            <div className="va-nav-actions">
              <button className="va-nav-btn" onClick={() => { setShowStarred(false); setPage('history'); }}>
                📋{records.length > 0 && <span className="va-nav-count">{records.length}</span>}
              </button>
              <button className="va-nav-btn" onClick={() => { setShowStarred(true); setPage('history'); }}>
                ⭐{records.filter(r => r.starred).length > 0 && <span className="va-nav-count">{records.filter(r => r.starred).length}</span>}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 页面内容 */}
      {page === 'analyze' && (
        <AnalyzePage
          existingRecord={currentRecord}
          onComplete={handleAnalysisComplete}
          onRecordsChange={setRecords}
          onNext={currentRecord ? () => setPage('script') : undefined}
        />
      )}
      {page === 'script' && currentRecord && (
        <ScriptPage
          record={currentRecord}
          onRecordUpdate={handleRecordUpdate}
          onRecordsChange={setRecords}
          onNext={() => setPage('generate')}
        />
      )}
      {page === 'generate' && currentRecord && (
        <GeneratePage
          record={currentRecord}
          onRecordUpdate={handleRecordUpdate}
          onRecordsChange={setRecords}
          onRestart={handleRestart}
        />
      )}
      {page === 'history' && (
        <HistoryPage
          records={records}
          onSelect={handleHistorySelect}
          onRecordsChange={setRecords}
          showStarredOnly={showStarred}
        />
      )}
    </div>
  );
};

export default VideoAnalyzer;
