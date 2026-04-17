/**
 * 爆款MV生成器 - 主容器
 *
 * 工作流：创意+音乐 → AI分镜 → 批量视频生成
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { MVRecord, PageId } from './types';
import { loadRecords } from './storage';
import { StepBar } from './components/StepBar';
import { AnalyzePage } from './pages/AnalyzePage';
import { ScriptPage } from './pages/ScriptPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import { taskQueueService } from '../../services/task-queue';
import {
  isMVCreatorTask,
  syncMVStoryboardTask,
  syncMVRewriteTask,
  getMVMusicRecordId,
  syncMVMusicTask,
} from './task-sync';
import '../video-analyzer/VideoAnalyzer.scss';
import '../music-analyzer/MusicAnalyzer.scss';
import './MVCreator.scss';

const MVCreator: React.FC = () => {
  const [page, setPage] = useState<PageId>('analyze');
  const [currentRecord, setCurrentRecord] = useState<MVRecord | null>(null);
  const [records, setRecords] = useState<MVRecord[]>([]);
  const [showStarred, setShowStarred] = useState(false);

  useEffect(() => {
    loadRecords().then(setRecords);
  }, []);

  // 同步分镜规划 + 音乐生成任务
  useEffect(() => {
    let disposed = false;
    const syncingTaskIds = new Set<string>();

    const syncTask = async (task: Parameters<typeof syncMVStoryboardTask>[0]) => {
      if (syncingTaskIds.has(task.id)) return;

      // 分镜规划 / 脚本改编任务
      if (isMVCreatorTask(task)) {
        syncingTaskIds.add(task.id);
        try {
          const synced = await syncMVStoryboardTask(task) || await syncMVRewriteTask(task);
          if (!synced || disposed) return;
          setRecords(synced.records);
          setCurrentRecord(prev => {
            if (prev?.id === synced.record.id) return synced.record;
            return prev;
          });
        } catch (error) {
          console.error('[MVCreator] Failed to sync storyboard task:', error);
        } finally {
          syncingTaskIds.delete(task.id);
        }
        return;
      }

      // 音乐生成任务
      const recordId = getMVMusicRecordId(task);
      if (recordId) {
        syncingTaskIds.add(task.id);
        try {
          const synced = await syncMVMusicTask(task, recordId);
          if (!synced || disposed) return;
          setRecords(synced.records);
          setCurrentRecord(prev => {
            if (prev?.id === synced.record.id) return synced.record;
            return prev;
          });
        } catch (error) {
          console.error('[MVCreator] Failed to sync music task:', error);
        } finally {
          syncingTaskIds.delete(task.id);
        }
      }
    };

    taskQueueService.getAllTasks().forEach(task => {
      if (task.status === 'completed') void syncTask(task);
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

  const handleComplete = useCallback((record: MVRecord) => {
    setCurrentRecord(record);
  }, []);

  const handleHistorySelect = useCallback((record: MVRecord) => {
    setCurrentRecord(record);
    if (record.editedShots && record.editedShots.length > 0) {
      setPage('generate');
    } else if (record.selectedClipId) {
      setPage('analyze');
    } else {
      setPage('analyze');
    }
  }, []);

  const handleRecordUpdate = useCallback((record: MVRecord) => {
    setCurrentRecord(record);
  }, []);

  const handleRestart = useCallback(() => {
    setCurrentRecord(null);
    setPage('analyze');
  }, []);

  const handleNavigate = useCallback((target: Exclude<PageId, 'history'>) => {
    setPage(target);
  }, []);

  const hasShots = !!(currentRecord?.editedShots && currentRecord.editedShots.length > 0);

  return (
    <div className="video-analyzer music-analyzer mv-creator">
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
            <StepBar
              current={page}
              onNavigate={handleNavigate}
              hasRecord={!!currentRecord}
              hasShots={hasShots}
            />
            <div className="va-nav-actions">
              <button className="va-nav-btn" onClick={() => { setShowStarred(false); setPage('history'); }}>
                <span role="img" aria-label="history">📋</span>
                {records.length > 0 && <span className="va-nav-count">{records.length}</span>}
              </button>
              <button className="va-nav-btn" onClick={() => { setShowStarred(true); setPage('history'); }}>
                <span role="img" aria-label="starred">⭐</span>
                {records.filter(r => r.starred).length > 0 && (
                  <span className="va-nav-count">{records.filter(r => r.starred).length}</span>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {page === 'analyze' && (
        <AnalyzePage
          existingRecord={currentRecord}
          onComplete={handleComplete}
          onRecordsChange={setRecords}
          onCreateNew={handleRestart}
          onNext={currentRecord?.editedShots?.length ? () => setPage('script') : undefined}
        />
      )}
      {page === 'script' && currentRecord && hasShots && (
        <ScriptPage
          record={currentRecord}
          onRecordUpdate={handleRecordUpdate}
          onRecordsChange={setRecords}
          onNext={() => setPage('generate')}
        />
      )}
      {page === 'generate' && currentRecord && hasShots && (
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

export default MVCreator;
