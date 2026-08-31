import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { MusicAnalysisRecord } from '../types';
import { Switch } from 'tdesign-react';
import { formatLyricsMarkdown } from '../types';
import { updateRecord } from '../storage';
import { taskQueueService } from '../../../services/task-queue';
import { TaskType, type KnowledgeContextRef } from '../../../types/task.types';
import { ModelDropdown } from '../../ai-input-bar/ModelDropdown';
import { KnowledgeNoteContextSelector } from '../../shared';
import { useSelectableModels } from '../../../hooks/use-runtime-models';
import { getSelectionKey } from '../../../utils/model-selection';
import type { ModelRef } from '../../../utils/settings-manager';
import { quickInsert } from '../../../mcp/tools/canvas-insertion';
import { syncMusicAnalyzerTask } from '../task-sync';
import {
  buildLyricsRewritePrompt,
  buildSunoLyricsPrompt,
  collectLyricsDraftModels,
  getDefaultRewritePrompt,
  isSunoLyricsModel,
  readStoredModelSelection,
  writeStoredModelSelection,
  ORIGINAL_VERSION_ID,
  switchToLyricsVersion,
} from '../utils';
import { MusicBriefEditor } from '../components/MusicBriefEditor';
import {
  areMusicBriefsEqual,
  normalizeMusicBrief,
  type MusicBrief,
} from '../music-brief';
import { analytics } from '../../../utils/umami-analytics';

const STORAGE_KEY_MODEL = 'music-analyzer:model';
const DEFAULT_ANALYSIS_MODEL = 'gemini-2.5-pro';

interface LyricsPageProps {
  record: MusicAnalysisRecord;
  onRecordUpdate: (record: MusicAnalysisRecord) => void;
  onRecordsChange: (records: MusicAnalysisRecord[]) => void;
  onNext?: () => void;
}

export const LyricsPage: React.FC<LyricsPageProps> = ({
  record,
  onRecordUpdate,
  onRecordsChange,
  onNext,
}) => {
  const [rewritePrompt, setRewritePrompt] = useState(() =>
    getDefaultRewritePrompt(record)
  );
  const [knowledgeContextRefs, setKnowledgeContextRefs] = useState<
    KnowledgeContextRef[]
  >([]);
  const [lyricsDraft, setLyricsDraft] = useState(record.lyricsDraft || '');
  const [title, setTitle] = useState(
    record.title || record.analysis?.titleSuggestions?.[0] || ''
  );
  const [styleTagsInput, setStyleTagsInput] = useState(
    (record.styleTags || record.analysis?.genreTags || []).join(', ')
  );
  const [instrumental, setInstrumental] = useState(
    record.instrumental === true
  );
  const [musicBrief, setMusicBrief] = useState<MusicBrief>(() =>
    normalizeMusicBrief(record.musicBrief)
  );
  const [pendingRewriteTaskId, setPendingRewriteTaskId] = useState<
    string | null
  >(() => record.pendingRewriteTaskId || null);
  const [rewriteProgress, setRewriteProgress] = useState('');
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModelState] = useState(
    () =>
      record.analysisModel ||
      readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL)
        .modelId
  );
  const [selectedModelRef, setSelectedModelRef] = useState<ModelRef | null>(
    () =>
      record.analysisModelRef ||
      readStoredModelSelection(STORAGE_KEY_MODEL, DEFAULT_ANALYSIS_MODEL)
        .modelRef
  );
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const rewritingRef = useRef(false);

  const setSelectedModel = useCallback(
    (model: string, modelRef?: ModelRef | null) => {
      setSelectedModelState(model);
      setSelectedModelRef(modelRef || null);
      writeStoredModelSelection(STORAGE_KEY_MODEL, model, modelRef);
    },
    []
  );

  useEffect(() => {
    setRewritePrompt(getDefaultRewritePrompt(record));
    setLyricsDraft(record.lyricsDraft || '');
    setTitle(record.title || record.analysis?.titleSuggestions?.[0] || '');
    setStyleTagsInput(
      (record.styleTags || record.analysis?.genreTags || []).join(', ')
    );
    setInstrumental(record.instrumental === true);
    setMusicBrief((current) => {
      const next = normalizeMusicBrief(record.musicBrief);
      return areMusicBriefsEqual(current, next) ? current : next;
    });
    setPendingRewriteTaskId(record.pendingRewriteTaskId || null);
  }, [record]);

  useEffect(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const styleTags = styleTagsInput
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const updated = await updateRecord(record.id, {
        rewritePrompt,
        lyricsDraft,
        title,
        styleTags,
        instrumental,
        musicBrief: normalizeMusicBrief(musicBrief),
        pendingRewriteTaskId,
      });
      onRecordsChange(updated);
      onRecordUpdate({
        ...record,
        rewritePrompt,
        lyricsDraft,
        title,
        styleTags,
        instrumental,
        musicBrief: normalizeMusicBrief(musicBrief),
        pendingRewriteTaskId,
      });
    }, 400);
    return () => clearTimeout(saveTimerRef.current);
  }, [
    lyricsDraft,
    musicBrief,
    onRecordUpdate,
    onRecordsChange,
    pendingRewriteTaskId,
    record.id,
    rewritePrompt,
    styleTagsInput,
    instrumental,
    title,
  ]);

  const allTextModels = useSelectableModels('text');
  const audioModels = useSelectableModels('audio');
  const rewriteModels = useMemo(
    () => collectLyricsDraftModels(allTextModels, audioModels),
    [allTextModels, audioModels]
  );
  const isSunoModel = useMemo(
    () => isSunoLyricsModel(selectedModel),
    [selectedModel]
  );

  // 版本列表
  const versions = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [
      { id: ORIGINAL_VERSION_ID, label: '原始版本' },
    ];
    for (const v of record.lyricsVersions || []) {
      items.push({ id: v.id, label: v.label });
    }
    return items;
  }, [record.lyricsVersions]);

  const activeVersionId = record.activeVersionId || ORIGINAL_VERSION_ID;
  const hasVersions = versions.length > 1;
  const creationPrompt = String(record.creationPrompt || '').trim();

  const handleInstrumentalChange = useCallback(
    (value: boolean) => {
      setInstrumental(value);
      onRecordUpdate({ ...record, instrumental: value });
      void updateRecord(record.id, { instrumental: value }).then(
        onRecordsChange
      );
    },
    [onRecordUpdate, onRecordsChange, record]
  );

  const handleSwitchVersion = useCallback(
    async (versionId: string) => {
      const patch = switchToLyricsVersion(record, versionId);
      if (!patch) return;
      const updated = await updateRecord(record.id, patch);
      onRecordsChange(updated);
      onRecordUpdate({ ...record, ...patch });
      setVersionMenuOpen(false);
    },
    [onRecordUpdate, onRecordsChange, record]
  );

  const handleRewrite = useCallback(async () => {
    if (rewritingRef.current || pendingRewriteTaskId) {
      return;
    }
    rewritingRef.current = true;
    setError('');
    setRewriteProgress(isSunoModel ? '歌词生成中...' : '歌词改写中 0%');
    analytics.trackUIInteraction({
      area: 'popular_music_tool',
      action: 'lyrics_rewrite_started',
      control: 'rewrite_lyrics',
      source: 'music_analyzer_lyrics_page',
      metadata: {
        engine: isSunoModel ? 'suno' : 'text_model',
        hasRewritePrompt: !!rewritePrompt.trim(),
        lyricsLength: lyricsDraft.trim().length,
      },
    });
    try {
      let task;
      if (isSunoModel) {
        const sunoPrompt = buildSunoLyricsPrompt({
          userPrompt: rewritePrompt,
          originalPrompt: creationPrompt,
          currentLyrics: lyricsDraft,
          musicBrief,
          mode: 'rewrite',
        });

        // Suno lyrics API：补齐首轮创作提示词与当前歌词，避免改写上下文缺失
        task = taskQueueService.createTask(
          {
            prompt: sunoPrompt,
            model: selectedModel,
            modelRef: selectedModelRef || null,
            sunoAction: 'lyrics',
            musicAnalyzerAction: 'lyrics-gen',
            musicAnalyzerRecordId: record.id,
            musicAnalyzerMusicBrief: normalizeMusicBrief(musicBrief),
            knowledgeContextRefs,
            autoInsertToCanvas: false,
          },
          TaskType.AUDIO
        );
      } else {
        // Gemini 文本模型：通过 prompt 工程改写
        task = taskQueueService.createTask(
          {
            prompt: `改写歌词：${record.sourceLabel}`,
            model: selectedModel,
            modelRef: selectedModelRef || null,
            musicAnalyzerAction: 'rewrite',
            musicAnalyzerPrompt: buildLyricsRewritePrompt({
              analysis: record.analysis,
              userPrompt: rewritePrompt,
              originalPrompt: creationPrompt,
              currentLyrics: lyricsDraft,
              musicBrief,
            }),
            musicAnalyzerRecordId: record.id,
            musicAnalyzerMusicBrief: normalizeMusicBrief(musicBrief),
            knowledgeContextRefs,
            autoInsertToCanvas: false,
          },
          TaskType.CHAT
        );
      }
      setPendingRewriteTaskId(task.id);
      const updated = await updateRecord(record.id, {
        rewritePrompt,
        musicBrief: normalizeMusicBrief(musicBrief),
        pendingRewriteTaskId: task.id,
      });
      onRecordsChange(updated);
      onRecordUpdate({
        ...record,
        rewritePrompt,
        musicBrief: normalizeMusicBrief(musicBrief),
        pendingRewriteTaskId: task.id,
      });
    } catch (taskError: any) {
      rewritingRef.current = false;
      setError(taskError.message || '歌词改写失败');
      setRewriteProgress('');
    }
  }, [
    creationPrompt,
    lyricsDraft,
    onRecordUpdate,
    onRecordsChange,
    record,
    rewritePrompt,
    selectedModel,
    selectedModelRef,
    isSunoModel,
    knowledgeContextRefs,
    musicBrief,
    pendingRewriteTaskId,
  ]);

  useEffect(() => {
    if (!pendingRewriteTaskId) return;

    const currentTask = taskQueueService.getTask(pendingRewriteTaskId);
    if (typeof currentTask?.progress === 'number') {
      setRewriteProgress(`歌词改写中 ${Math.round(currentTask.progress)}%`);
    }

    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.task.id !== pendingRewriteTaskId) return;

        if (event.task.status === 'failed') {
          rewritingRef.current = false;
          setPendingRewriteTaskId(null);
          setRewriteProgress('');
          setError(event.task.error?.message || '歌词改写失败');
          void updateRecord(record.id, { pendingRewriteTaskId: null }).then(
            onRecordsChange
          );
          return;
        }

        if (event.task.status === 'completed') {
          void syncMusicAnalyzerTask(event.task)
            .then((synced) => {
              if (!synced) return;
              onRecordsChange(synced.records);
              onRecordUpdate(synced.record);
              setLyricsDraft(synced.record.lyricsDraft || '');
              setTitle(synced.record.title || '');
              setStyleTagsInput((synced.record.styleTags || []).join(', '));
            })
            .catch((taskError: any) => {
              setError(taskError.message || '改写结果同步失败');
            })
            .finally(() => {
              rewritingRef.current = false;
              setPendingRewriteTaskId(null);
              setRewriteProgress('');
            });
          return;
        }

        if (typeof event.task.progress === 'number') {
          setRewriteProgress(`歌词改写中 ${Math.round(event.task.progress)}%`);
        }
      });

    return () => subscription.unsubscribe();
  }, [onRecordUpdate, onRecordsChange, pendingRewriteTaskId, record.id]);

  const handleInsertLyrics = useCallback(async () => {
    const result = await quickInsert(
      'text',
      formatLyricsMarkdown({
        title,
        styleTags: styleTagsInput
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        lyricsDraft,
      }),
      undefined,
      undefined,
      {
        prompt:
          record.rewritePrompt ||
          record.creationPrompt ||
          record.sourceLabel ||
          lyricsDraft,
      }
    );
    if (!result.success) {
      setError(result.error || '插入失败，请确认画布已打开');
      return;
    }
    analytics.trackUIInteraction({
      area: 'popular_music_tool',
      action: 'lyrics_inserted_to_canvas',
      control: 'insert_lyrics',
      source: 'music_analyzer_lyrics_page',
      metadata: {
        lyricsLength: lyricsDraft.trim().length,
        tagsCount: styleTagsInput.split(',').filter((item) => item.trim())
          .length,
      },
    });
  }, [lyricsDraft, styleTagsInput, title]);

  return (
    <div className="va-page">
      <div className="ma-card">
        <MusicBriefEditor value={musicBrief} onChange={setMusicBrief} />
      </div>

      <div className="ma-card ma-instrumental-card">
        <div className="ma-card-header">
          <span>纯音乐模式</span>
          <span className="ma-muted">
            不生成演唱人声，下一步可直接填写音乐描述
          </span>
        </div>
        <Switch
          value={instrumental}
          onChange={(value) => handleInstrumentalChange(Boolean(value))}
          label={instrumental ? '仅生成纯音乐' : '生成歌曲（可包含人声）'}
        />
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>改写要求</span>
          {hasVersions && (
            <div className="ma-version-dropdown">
              <button
                className="ma-version-btn"
                onClick={() => setVersionMenuOpen((v) => !v)}
              >
                {versions.find((v) => v.id === activeVersionId)?.label ||
                  '原始版本'}
                <span className="ma-version-arrow">
                  {versionMenuOpen ? '▲' : '▼'}
                </span>
              </button>
              {versionMenuOpen && (
                <div className="ma-version-menu">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      className={`ma-version-menu-item ${
                        v.id === activeVersionId ? 'active' : ''
                      }`}
                      onClick={() => handleSwitchVersion(v.id)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <textarea
          className="ma-textarea"
          value={rewritePrompt}
          onChange={(event) => setRewritePrompt(event.target.value)}
          rows={4}
          placeholder="告诉 AI 要保留什么、强化什么、改成什么风格"
        />
        <KnowledgeNoteContextSelector
          value={knowledgeContextRefs}
          onChange={setKnowledgeContextRefs}
          disabled={!!pendingRewriteTaskId}
          className="ma-knowledge-context-selector"
          placement="up"
        />
        <div className="ma-lyrics-submit-row ma-lyrics-submit-row--rewrite">
          <div className="ma-lyrics-model-inline">
            <span className="ma-inline-label">歌词模型</span>
            <ModelDropdown
              selectedModel={selectedModel}
              selectedSelectionKey={getSelectionKey(
                selectedModel,
                selectedModelRef
              )}
              onSelect={setSelectedModel}
              models={rewriteModels}
              variant="form"
              placement="up"
              placeholder="选择歌词模型"
            />
          </div>
          <button
            className="va-btn-primary ma-rewrite-submit"
            onClick={handleRewrite}
            disabled={!!pendingRewriteTaskId}
          >
            {pendingRewriteTaskId
              ? rewriteProgress ||
                (isSunoModel ? '歌词生成中...' : '歌词改写中...')
              : isSunoModel
              ? 'Suno 生成歌词'
              : 'AI 改写'}
          </button>
        </div>
        {rewriteProgress && (
          <div className="ma-progress">{rewriteProgress}</div>
        )}
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>歌曲标题</span>
        </div>
        <input
          className="ma-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="歌曲标题"
        />
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>Suno 风格标签</span>
        </div>
        <input
          className="ma-input"
          value={styleTagsInput}
          onChange={(event) => setStyleTagsInput(event.target.value)}
          placeholder="例如 cinematic pop, female vocal, uplifting"
        />
      </div>

      <div className="ma-card">
        <div className="ma-card-header">
          <span>歌词草稿</span>
        </div>
        <textarea
          className="ma-textarea"
          value={lyricsDraft}
          onChange={(event) => setLyricsDraft(event.target.value)}
          rows={14}
          placeholder="AI 改写结果会出现在这里，可继续手改"
        />
      </div>

      {error && <div className="ma-error">{error}</div>}

      <div className="va-page-actions">
        <button onClick={handleInsertLyrics} disabled={!lyricsDraft.trim()}>
          插入歌词
        </button>
        <button
          className="va-btn-primary"
          onClick={onNext}
          disabled={!lyricsDraft.trim() && !instrumental}
        >
          下一步
        </button>
      </div>
    </div>
  );
};
