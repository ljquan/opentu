/**
 * 视频拆解器 - 主容器
 *
 * 多步骤工作流：分析 → 脚本编辑 → 素材生成
 * 支持历史记录和收藏
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { PageId, AnalysisRecord } from './types';
import { loadRecords, updateRecord } from './storage';
import { StepBar } from './components/StepBar';
import { AnalyzePage } from './pages/AnalyzePage';
import { ScriptPage } from './pages/ScriptPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import { taskQueueService } from '../../services/task-queue';
import { syncVideoAnalyzerTask, isVideoAnalyzerTask } from './task-sync';
import { switchToVersion } from './utils';
import { useDrawnix } from '../../hooks/use-drawnix';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import { TaskType } from '../../types/task.types';
import type { Task } from '../../types/task.types';
import { MessagePlugin } from 'tdesign-react';
import './VideoAnalyzer.scss';

const VideoAnalyzer: React.FC = () => {
  const [page, setPage] = useState<PageId>('analyze');
  const [currentRecord, setCurrentRecord] = useState<AnalysisRecord | null>(null);
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [showStarred, setShowStarred] = useState(false);
  const { board } = useDrawnix();

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

  const handleInsertTask = useCallback(async (task: Task) => {
    if ((!task.result?.url && !task.result?.urls?.length) || !board) {
      void MessagePlugin.warning('无法插入：白板未就绪');
      return;
    }
    try {
      if (task.type === TaskType.IMAGE) {
        const urls = task.result.urls?.length ? task.result.urls : [task.result.url];
        for (const url of urls) {
          await insertImageFromUrl(board, url);
        }
        void MessagePlugin.success(urls.length > 1 ? '多图已插入到白板' : '图片已插入到白板');
      } else if (task.type === TaskType.VIDEO) {
        await insertVideoFromUrl(board, task.result.url);
        void MessagePlugin.success('视频已插入到白板');
      }
    } catch (error) {
      console.error('[VideoAnalyzer] Failed to insert to board:', error);
      void MessagePlugin.error(`插入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [board]);

  const handleSelectScript = useCallback(async (record: AnalysisRecord, task: Task) => {
    // 通过任务的 prompt 匹配 ScriptVersion
    const taskPrompt = String(task.params.videoAnalyzerPrompt || task.params.prompt || '');
    const versions = record.scriptVersions || [];
    const matched = versions.find(v => v.prompt === taskPrompt)
      || versions.find(v => taskPrompt && v.prompt?.includes(taskPrompt));

    let updatedRecord = record;
    if (matched && matched.id !== record.activeVersionId) {
      const patch = switchToVersion(record, matched.id);
      if (patch) {
        const updatedRecords = await updateRecord(record.id, patch);
        updatedRecord = updatedRecords.find(r => r.id === record.id) || { ...record, ...patch };
        setRecords(updatedRecords);
      }
    }

    setCurrentRecord(updatedRecord);
    setPage('script');
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
                <span role="img" aria-label="history">📋</span>
                {records.length > 0 && <span className="va-nav-count">{records.length}</span>}
              </button>
              <button className="va-nav-btn" onClick={() => { setShowStarred(true); setPage('history'); }}>
                <span role="img" aria-label="starred">⭐</span>
                {records.filter(r => r.starred).length > 0 && <span className="va-nav-count">{records.filter(r => r.starred).length}</span>}
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
          onCreateNew={handleRestart}
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
          onInsertTask={board ? handleInsertTask : undefined}
          onSelectScript={handleSelectScript}
        />
      )}
    </div>
  );
};

export default VideoAnalyzer;
