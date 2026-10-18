import React, { useCallback, useMemo } from 'react';
import type { MusicAnalysisRecord, PageId } from './types';
import { loadRecords } from './storage';
import { CreatePage } from './pages/CreatePage';
import { LyricsPage } from './pages/LyricsPage';
import { GeneratePage } from './pages/GeneratePage';
import { HistoryPage } from './pages/HistoryPage';
import {
  isMusicAnalyzerTask,
  syncMusicAnalyzerTask,
  getMusicGenerationRecordId,
  syncMusicGenerationTask,
} from './task-sync';
import type { Task } from '../../types/task.types';
import { writeStoredModelSelection } from './utils';
import {
  WorkflowNavBar,
  useWorkflowNavigation,
  useWorkflowRecords,
  type WorkflowStepConfig,
} from '../shared/workflow';
import { useWorkflowTaskSync } from '../shared/workflow/useWorkflowTaskSync';
import '../video-analyzer/VideoAnalyzer.scss';
import './MusicAnalyzer.scss';

type WorkflowPageId = Exclude<PageId, 'history'>;

const MUSIC_STEPS: Array<Omit<WorkflowStepConfig<WorkflowPageId>, 'disabled'>> = [
  { id: 'create', label: '创作' },
  { id: 'lyrics', label: '歌词' },
  { id: 'generate', label: '生成' },
];

const MusicAnalyzer: React.FC = () => {
  const {
    records,
    setRecords,
    currentRecord,
    showStarred,
    setShowStarred,
    starredCount,
    selectRecord,
    updateCurrentRecord,
    restart,
    applySyncedRecord,
  } = useWorkflowRecords<MusicAnalysisRecord>({
    loadRecords,
    logPrefix: '[MusicAnalyzer]',
  });
  const {
    page,
    setPage,
    navigateToStep,
    goToDefaultPage,
    openHistory,
    openStarred,
    toggleStarred,
  } = useWorkflowNavigation<PageId, WorkflowPageId>({
    initialPage: 'create',
    defaultPage: 'create',
    historyPage: 'history',
    setShowStarred,
  });

  const syncTask = useCallback(async (task: Task) => {
    if (isMusicAnalyzerTask(task)) {
      const synced = await syncMusicAnalyzerTask(task);
      return synced ? { ...synced, selectWhenNoCurrent: true } : null;
    }

    const recordId = getMusicGenerationRecordId(task);
    if (recordId) {
      return syncMusicGenerationTask(task, recordId);
    }

    return null;
  }, []);

  useWorkflowTaskSync<MusicAnalysisRecord>({
    syncTask,
    applySyncedRecord,
    logPrefix: '[MusicAnalyzer]',
  });

  const steps = useMemo<WorkflowStepConfig<WorkflowPageId>[]>(
    () =>
      MUSIC_STEPS.map((step, index) => ({
        ...step,
        disabled: !currentRecord && index > 0,
      })),
    [currentRecord]
  );

  const handleAnalysisComplete = useCallback((record: MusicAnalysisRecord) => {
    updateCurrentRecord(record);
  }, [updateCurrentRecord]);

  const handleHistorySelect = useCallback((record: MusicAnalysisRecord) => {
    selectRecord(record);
    goToDefaultPage();
  }, [goToDefaultPage, selectRecord]);

  const handleSelectLyrics = useCallback((record: MusicAnalysisRecord) => {
    selectRecord(record);
    setPage('lyrics');
  }, [selectRecord, setPage]);

  const handleRecordUpdate = useCallback((record: MusicAnalysisRecord) => {
    updateCurrentRecord(record);
  }, [updateCurrentRecord]);

  const handleRestart = useCallback(() => {
    restart();
    goToDefaultPage();
  }, [goToDefaultPage, restart]);

  return (
    <div className="video-analyzer music-analyzer">
      <WorkflowNavBar
        isHistoryPage={page === 'history'}
        showStarred={showStarred}
        recordsCount={records.length}
        starredCount={starredCount}
        currentStep={page}
        steps={steps}
        onStepNavigate={navigateToStep}
        onBackFromHistory={goToDefaultPage}
        onOpenHistory={openHistory}
        onOpenStarred={openStarred}
        onToggleStarred={toggleStarred}
      />

      {page === 'create' && (
        <CreatePage
          existingRecord={currentRecord}
          onComplete={handleAnalysisComplete}
          onRecordsChange={setRecords}
          onCreateNew={handleRestart}
          onNext={currentRecord ? () => setPage('lyrics') : undefined}
          onLyricsReady={() => setPage('lyrics')}
          onOpenSunoV2={(record, model, modelRef) => {
            writeStoredModelSelection('music-analyzer:audio-model', model, modelRef);
            selectRecord(record);
            setPage('generate');
          }}
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
