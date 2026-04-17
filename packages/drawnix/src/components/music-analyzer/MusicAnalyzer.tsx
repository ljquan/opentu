import React, { useCallback, useEffect, useState } from 'react';
import type { MusicAnalysisRecord, PageId } from './types';
import { loadRecords } from './storage';
import { StepBar } from './components/StepBar';
import { CreatePage } from './pages/CreatePage';
import { LyricsPage } from './pages/LyricsPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import { taskQueueService } from '../../services/task-queue';
import {
  isMusicAnalyzerTask,
  syncMusicAnalyzerTask,
  getMusicGenerationRecordId,
  syncMusicGenerationTask,
} from './task-sync';
import '../video-analyzer/VideoAnalyzer.scss';
import './MusicAnalyzer.scss';

const MusicAnalyzer: React.FC = () => {
  const [page, setPage] = useState<PageId>('create');
  const [currentRecord, setCurrentRecord] = useState<MusicAnalysisRecord | null>(null);
  const [records, setRecords] = useState<MusicAnalysisRecord[]>([]);
  const [showStarred, setShowStarred] = useState(false);

  useEffect(() => {
    loadRecords().then(setRecords);
  }, []);

  // 同步分析/改写/歌词生成任务
  useEffect(() => {
    let disposed = false;
    const syncingTaskIds = new Set<string>();

    const syncTask = async (task: Parameters<typeof syncMusicAnalyzerTask>[0]) => {
      if (syncingTaskIds.has(task.id)) return;

      // 处理音乐分析器任务（analyze/rewrite/lyrics-gen）
      if (isMusicAnalyzerTask(task)) {
        syncingTaskIds.add(task.id);
        try {
          const synced = await syncMusicAnalyzerTask(task);
          if (!synced || disposed) return;
          setRecords(synced.records);
          setCurrentRecord((prev) => {
            if (prev?.id === synced.record.id || !prev) return synced.record;
            return prev;
          });
        } catch (error) {
          console.error('[MusicAnalyzer] Failed to sync task result:', error);
        } finally {
          syncingTaskIds.delete(task.id);
        }
        return;
      }

      // 处理批量生成任务（AUDIO + batchId 以 ma_ 开头）
      const recordId = getMusicGenerationRecordId(task);
      if (recordId) {
        syncingTaskIds.add(task.id);
        try {
          const synced = await syncMusicGenerationTask(task, recordId);
          if (!synced || disposed) return;
          setRecords(synced.records);
          setCurrentRecord((prev) => {
            if (prev?.id === synced.record.id) return synced.record;
            return prev;
          });
        } catch (error) {
          console.error('[MusicAnalyzer] Failed to sync generation task:', error);
        } finally {
          syncingTaskIds.delete(task.id);
        }
      }
    };

    taskQueueService.getAllTasks().forEach((task) => {
      if (task.status === 'completed') void syncTask(task);
    });

    const subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      if (event.task.status === 'completed') {
        void syncTask(event.task);
      }
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleAnalysisComplete = useCallback((record: MusicAnalysisRecord) => {
    setCurrentRecord(record);
  }, []);

  const handleHistorySelect = useCallback((record: MusicAnalysisRecord) => {
    setCurrentRecord(record);
    setPage('create');
  }, []);

  const handleSelectLyrics = useCallback((record: MusicAnalysisRecord) => {
    setCurrentRecord(record);
    setPage('lyrics');
  }, []);

  const handleRecordUpdate = useCallback((record: MusicAnalysisRecord) => {
    setCurrentRecord(record);
  }, []);

  const handleRestart = useCallback(() => {
    setCurrentRecord(null);
    setPage('create');
  }, []);

  const handleNavigate = useCallback((target: Exclude<PageId, 'history'>) => {
    setPage(target);
  }, []);

  return (
    <div className="video-analyzer music-analyzer">
      <div className="va-nav">
        {page === 'history' ? (
          <>
            <button className="va-nav-back" onClick={() => setPage('create')}>
              ←
            </button>
            <span className="va-nav-title">{showStarred ? '收藏' : '历史记录'}</span>
            <button
              className={`va-nav-btn ${showStarred ? 'active' : ''}`}
              onClick={() => setShowStarred((value) => !value)}
            >
              {showStarred ? '★ 收藏' : '☆ 全部'}
            </button>
          </>
        ) : (
          <>
            <StepBar current={page} onNavigate={handleNavigate} hasRecord={!!currentRecord} />
            <div className="va-nav-actions">
              <button
                className="va-nav-btn"
                onClick={() => {
                  setShowStarred(false);
                  setPage('history');
                }}
              >
                <span role="img" aria-label="history">
                  📋
                </span>
                {records.length > 0 && <span className="va-nav-count">{records.length}</span>}
              </button>
              <button
                className="va-nav-btn"
                onClick={() => {
                  setShowStarred(true);
                  setPage('history');
                }}
              >
                <span role="img" aria-label="starred">
                  ⭐
                </span>
                {records.filter((record) => record.starred).length > 0 && (
                  <span className="va-nav-count">
                    {records.filter((record) => record.starred).length}
                  </span>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {page === 'create' && (
        <CreatePage
          existingRecord={currentRecord}
          onComplete={handleAnalysisComplete}
          onRecordsChange={setRecords}
          onCreateNew={handleRestart}
          onNext={currentRecord ? () => setPage('lyrics') : undefined}
          onLyricsReady={() => setPage('lyrics')}
        />
      )}
      {page === 'lyrics' && currentRecord && (
        <LyricsPage
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
          onSelectLyrics={handleSelectLyrics}
        />
      )}
    </div>
  );
};

export default MusicAnalyzer;
