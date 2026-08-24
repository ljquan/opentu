import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { History, Sparkles } from 'lucide-react';
import { MessagePlugin } from 'tdesign-react';
import { executorFactory } from '../../services/media-executor';
import { ModelDropdown } from '../ai-input-bar/ModelDropdown';
import { useSelectableModels } from '../../hooks/use-runtime-models';
import { useDeviceType } from '../../hooks/useDeviceType';
import { usePromptHistory } from '../../hooks/usePromptHistory';
import type { PromptType } from '../../services/prompt-storage-service';
import {
  createModelRef,
  resolveInvocationRoute,
  type ModelRef,
} from '../../utils/settings-manager';
import { LS_KEYS } from '../../constants/storage-keys';
import { getPinnedSelectableModel } from '../../utils/runtime-model-discovery';
import {
  findMatchingSelectableModel,
  getModelRefFromConfig,
  getSelectionKey,
} from '../../utils/model-selection';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
} from './workflow/model-selection-storage';
import { WinBoxWindow } from '../winbox';
import { PromptListPanel, type PromptItem } from './PromptListPanel';
import {
  buildOptimizationPrompt,
  getPromptOptimizationScenario,
  normalizeOptimizedPromptResult,
  type PromptOptimizationScenarioId,
  type PromptOptimizeMode,
  type PromptOptimizeType,
} from '../../services/prompt-optimization-service';
import {
  analytics,
  type PromptAnalyticsType,
} from '../../utils/umami-analytics';
import './prompt-optimize-dialog.scss';

type OptimizeHistoryPanel = 'current' | 'requirements';

interface RequirementsHistoryItem {
  id: string;
  content: string;
  timestamp: number;
}

const REQUIREMENTS_HISTORY_LIMIT = 30;
const PROMPT_HISTORY_DISPLAY_LIMIT = 60;

function toPromptAnalyticsType(
  type?: PromptType | PromptOptimizeType | 'ppt-slide'
): PromptAnalyticsType | undefined {
  return type as PromptAnalyticsType | undefined;
}

function readRequirementsHistory(): RequirementsHistoryItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(
      LS_KEYS.PROMPT_OPTIMIZE_REQUIREMENTS_HISTORY
    );
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is RequirementsHistoryItem =>
          item &&
          typeof item.id === 'string' &&
          typeof item.content === 'string' &&
          typeof item.timestamp === 'number' &&
          item.content.trim().length > 0
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, REQUIREMENTS_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeRequirementsHistory(items: RequirementsHistoryItem[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      LS_KEYS.PROMPT_OPTIMIZE_REQUIREMENTS_HISTORY,
      JSON.stringify(items.slice(0, REQUIREMENTS_HISTORY_LIMIT))
    );
  } catch {
    // 忽略本地存储失败，避免影响优化主流程。
  }
}

function addRequirementsHistory(content: string): RequirementsHistoryItem[] {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return readRequirementsHistory();
  }

  const nextHistory = [
    {
      id: `requirements-${Date.now()}`,
      content: trimmedContent,
      timestamp: Date.now(),
    },
    ...readRequirementsHistory().filter(
      (item) => item.content !== trimmedContent
    ),
  ].slice(0, REQUIREMENTS_HISTORY_LIMIT);

  writeRequirementsHistory(nextHistory);
  return nextHistory;
}

export interface PromptOptimizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalPrompt: string;
  language: 'zh' | 'en';
  scenarioId?: PromptOptimizationScenarioId;
  type?: PromptOptimizeType;
  onApply: (prompt: string) => void;
  historyType?: PromptType;
  allowStructuredMode?: boolean;
  defaultMode?: PromptOptimizeMode;
}

export const PromptOptimizeDialog: React.FC<PromptOptimizeDialogProps> = (
  props
) => {
  const {
    open,
    onOpenChange,
    originalPrompt,
    language,
    type,
    onApply,
    historyType,
    allowStructuredMode = false,
    defaultMode,
  } = props;
  const scenarioId = props.scenarioId;
  const reactWindowId = useId();
  const currentPromptId = useId();
  const requirementsId = useId();
  const draftPromptId = useId();
  const scenario = useMemo(
    () => getPromptOptimizationScenario(scenarioId, type),
    [scenarioId, type]
  );
  const effectiveType = type || scenario.type;
  const effectiveHistoryType = historyType || scenario.historyType;
  const effectiveDefaultMode = defaultMode ?? scenario.defaultMode;
  const [requirements, setRequirements] = useState('');
  const [currentPrompt, setCurrentPrompt] = useState(originalPrompt);
  const [optimizedDraft, setOptimizedDraft] = useState('');
  const [mode, setMode] = useState<PromptOptimizeMode>(effectiveDefaultMode);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [activeHistoryPanel, setActiveHistoryPanel] =
    useState<OptimizeHistoryPanel | null>(null);
  const [requirementsHistory, setRequirementsHistory] = useState<
    RequirementsHistoryItem[]
  >([]);
  const optimizationAbortRef = useRef<AbortController | null>(null);
  const optimizingLockRef = useRef(false);
  const historyPopoverRef = useRef<HTMLDivElement | null>(null);
  const { isMobile, viewportWidth, viewportHeight } = useDeviceType();
  const {
    history: promptHistory,
    addHistory: addPromptHistory,
    refreshHistory: refreshPromptHistory,
  } = usePromptHistory({
    deduplicateWithPresets: false,
    modelTypeFilter: effectiveHistoryType,
  });

  const textModels = useSelectableModels('text');

  const resolveStoredOptimizerModel = useCallback(() => {
    const route = resolveInvocationRoute('text');
    const routeModelRef = createModelRef(route.profileId, route.modelId);
    const fallbackModelId = route.modelId || textModels[0]?.id || '';
    const fallbackModelRef =
      routeModelRef ||
      (fallbackModelId ? createModelRef(null, fallbackModelId) : null);
    const stored = readStoredModelSelection(
      LS_KEYS.PROMPT_OPTIMIZE_TEXT_MODEL,
      fallbackModelId,
      fallbackModelRef
    );
    const matchedModel =
      findMatchingSelectableModel(textModels, stored.modelId, stored.modelRef) ||
      getPinnedSelectableModel('text', stored.modelId, stored.modelRef);
    const modelId = matchedModel?.id || stored.modelId || fallbackModelId;
    const modelRef =
      getModelRefFromConfig(matchedModel) ||
      stored.modelRef ||
      fallbackModelRef ||
      (modelId ? createModelRef(null, modelId) : null);

    return { modelId, modelRef };
  }, [textModels]);

  const [optimizerModel, setOptimizerModel] = useState(
    () => resolveStoredOptimizerModel().modelId
  );
  const [optimizerModelRef, setOptimizerModelRef] = useState<ModelRef | null>(
    () => resolveStoredOptimizerModel().modelRef
  );

  const visibleTextModels = useMemo(() => {
    const matchedModel = findMatchingSelectableModel(
      textModels,
      optimizerModel,
      optimizerModelRef
    );
    if (matchedModel || !optimizerModel) {
      return textModels;
    }

    const pinnedModel = getPinnedSelectableModel(
      'text',
      optimizerModel,
      optimizerModelRef
    );
    return pinnedModel ? [pinnedModel, ...textModels] : textModels;
  }, [optimizerModel, optimizerModelRef, textModels]);

  const syncOptimizerModelFromStorage = useCallback(() => {
    const nextSelection = resolveStoredOptimizerModel();
    setOptimizerModel(nextSelection.modelId);
    setOptimizerModelRef(nextSelection.modelRef);
  }, [resolveStoredOptimizerModel]);

  const handleClose = useCallback(() => {
    optimizationAbortRef.current?.abort();
    optimizationAbortRef.current = null;
    optimizingLockRef.current = false;
    setIsOptimizing(false);
    setRequirements('');
    setOptimizedDraft('');
    setMode(effectiveDefaultMode);
    onOpenChange(false);
  }, [effectiveDefaultMode, onOpenChange]);

  const handleOptimizePrompt = useCallback(async () => {
    const rawPrompt = currentPrompt.trim();
    if (!rawPrompt) {
      MessagePlugin.warning(
        language === 'zh'
          ? '请先填写当前提示词'
          : 'Please enter the current prompt first'
      );
      return;
    }
    if (optimizingLockRef.current || isOptimizing) {
      return;
    }
    optimizingLockRef.current = true;

    addPromptHistory(rawPrompt, false, effectiveHistoryType || effectiveType);
    if (requirements.trim()) {
      setRequirementsHistory(addRequirementsHistory(requirements));
    }

    const controller = new AbortController();
    const startTime = Date.now();
    optimizationAbortRef.current?.abort();
    optimizationAbortRef.current = controller;
    setIsOptimizing(true);
    analytics.trackPromptAction({
      action: 'optimize',
      surface: 'prompt_optimize_dialog',
      promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
      mode,
      status: 'start',
      model: optimizerModel || undefined,
      prompt: rawPrompt,
      requirements,
    });

    try {
      const optimizedPrompt = normalizeOptimizedPromptResult(
        (
          await executorFactory.getFallbackExecutor().generateText(
            {
              prompt: await buildOptimizationPrompt({
                scenarioId,
                originalPrompt: rawPrompt,
                optimizationRequirements: requirements,
                language,
                type: effectiveType,
                mode,
              }),
              model: optimizerModel || undefined,
              modelRef: optimizerModelRef,
            },
            {
              signal: controller.signal,
            }
          )
        ).content
      );

      if (!optimizedPrompt) {
        throw new Error('Empty optimized prompt');
      }

      setOptimizedDraft(optimizedPrompt);
      analytics.trackPromptAction({
        action: 'optimize',
        surface: 'prompt_optimize_dialog',
        promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
        mode,
        status: 'success',
        model: optimizerModel || undefined,
        prompt: rawPrompt,
        requirements,
        durationMs: Date.now() - startTime,
        metadata: {
          result_length_bucket:
            optimizedPrompt.length <= 200
              ? '1-200'
              : optimizedPrompt.length <= 500
              ? '201-500'
              : optimizedPrompt.length <= 1000
              ? '501-1000'
              : '1000+',
        },
      });
      MessagePlugin.success(
        language === 'zh'
          ? mode === 'structured'
            ? '结构化提示词已生成，可继续优化或回填'
            : '提示词优化完成，可继续优化或回填'
          : mode === 'structured'
          ? 'Structured prompt generated. You can refine again or apply it.'
          : 'Prompt optimized. You can refine again or apply it.'
      );
      setRequirements('');
    } catch (error) {
      if (controller.signal.aborted) {
        analytics.trackPromptAction({
          action: 'optimize',
          surface: 'prompt_optimize_dialog',
          promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
          mode,
          status: 'cancelled',
          model: optimizerModel || undefined,
          prompt: rawPrompt,
          requirements,
          durationMs: Date.now() - startTime,
        });
        return;
      }
      console.error('[PromptOptimizeDialog] Failed to optimize prompt:', error);
      analytics.trackPromptAction({
        action: 'optimize',
        surface: 'prompt_optimize_dialog',
        promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
        mode,
        status: 'failed',
        model: optimizerModel || undefined,
        prompt: rawPrompt,
        requirements,
        durationMs: Date.now() - startTime,
        metadata: {
          error:
            error instanceof Error ? error.name || 'Error' : typeof error,
        },
      });
      MessagePlugin.error(
        language === 'zh'
          ? mode === 'structured'
            ? '结构化提示词生成失败，请稍后重试'
            : '提示词优化失败，请稍后重试'
          : mode === 'structured'
          ? 'Failed to generate structured prompt, please try again later'
          : 'Failed to optimize prompt, please try again later'
      );
    } finally {
      if (optimizationAbortRef.current === controller) {
        optimizationAbortRef.current = null;
      }
      optimizingLockRef.current = false;
      setIsOptimizing(false);
    }
  }, [
    currentPrompt,
    language,
    mode,
    optimizerModel,
    optimizerModelRef,
    requirements,
    addPromptHistory,
    effectiveHistoryType,
    effectiveType,
    isOptimizing,
    scenarioId,
  ]);

  const handleUseDraftAsCurrent = useCallback(() => {
    const draft = optimizedDraft.trim();
    if (!draft) {
      return;
    }
    analytics.trackPromptAction({
      action: 'use_draft_as_current',
      surface: 'prompt_optimize_dialog',
      promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
      mode,
      prompt: draft,
    });
    setCurrentPrompt(draft);
    setRequirements('');
  }, [effectiveHistoryType, effectiveType, mode, optimizedDraft]);

  const handleApplyPrompt = useCallback(() => {
    const promptToApply = (optimizedDraft || currentPrompt).trim();
    if (!promptToApply) {
      MessagePlugin.warning(
        language === 'zh'
          ? '没有可回填的提示词'
          : 'There is no prompt to apply'
      );
      return;
    }
    analytics.trackPromptAction({
      action: 'apply',
      surface: 'prompt_optimize_dialog',
      promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
      mode,
      prompt: promptToApply,
    });
    onApply(promptToApply);
    handleClose();
  }, [
    currentPrompt,
    effectiveHistoryType,
    effectiveType,
    handleClose,
    language,
    mode,
    onApply,
    optimizedDraft,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }
    syncOptimizerModelFromStorage();
    setCurrentPrompt(originalPrompt);
    setOptimizedDraft('');
    setRequirements('');
    setRequirementsHistory(readRequirementsHistory());
    setActiveHistoryPanel(null);
    setMode(effectiveDefaultMode);
  }, [effectiveDefaultMode, open, originalPrompt, syncOptimizerModelFromStorage]);

  useEffect(() => {
    return () => {
      optimizationAbortRef.current?.abort();
      optimizationAbortRef.current = null;
      optimizingLockRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!activeHistoryPanel) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        historyPopoverRef.current?.contains(target)
      ) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest('.prompt-optimize-dialog__history-btn')
      ) {
        return;
      }
      setActiveHistoryPanel(null);
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [activeHistoryPanel]);

  const requirementsPlaceholder =
    language === 'zh'
      ? mode === 'structured'
        ? '例如：突出时间轴结构、把区域与数量拆开、保留标题与图例、输出 JSON 不要解释...'
        : '例如：更电影感、补充镜头语言、减少冗余、强调主体与光线...'
      : mode === 'structured'
      ? 'For example: emphasize timeline structure, split regions and counts, preserve titles and legends, output JSON only...'
      : 'For example: make it more cinematic, add camera language, reduce redundancy, emphasize subject and lighting...';
  const canOptimize = currentPrompt.trim().length > 0;
  const canApply =
    (optimizedDraft.length > 0 ? optimizedDraft : currentPrompt).trim().length >
    0;
  const hasOptimizedDraft = optimizedDraft.length > 0;
  const currentPromptHistoryItems = useMemo<PromptItem[]>(
    () =>
      promptHistory.slice(0, PROMPT_HISTORY_DISPLAY_LIMIT).map((item) => ({
        id: item.id,
        content: item.content,
        pinned: item.pinned,
        modelType: item.modelType,
      })),
    [promptHistory]
  );
  const requirementsHistoryItems = useMemo<PromptItem[]>(
    () =>
      requirementsHistory.map((item) => ({
        id: item.id,
        content: item.content,
      })),
    [requirementsHistory]
  );
  const windowId = useMemo(
    () =>
      `prompt-optimize-dialog-${reactWindowId.replace(
        /[^a-zA-Z0-9_-]/g,
        ''
      )}`,
    [reactWindowId]
  );
  const title =
    language === 'zh'
      ? mode === 'structured'
        ? '结构化提示词'
        : '提示词优化'
      : mode === 'structured'
      ? 'Structured Prompt'
      : 'Prompt Optimization';
  const windowSize = useMemo(() => {
    const viewportPadding = isMobile ? 16 : 48;
    const maxWidth = Math.max(280, viewportWidth - viewportPadding);
    const maxHeight = Math.max(320, viewportHeight - viewportPadding);
    const targetWidth = hasOptimizedDraft ? 1120 : 680;
    const targetHeight = hasOptimizedDraft ? 760 : 680;
    const width = Math.max(280, Math.min(targetWidth, maxWidth));
    const height = Math.max(320, Math.min(targetHeight, maxHeight));

    return {
      width,
      height,
      minWidth: Math.min(hasOptimizedDraft ? 640 : 320, width),
      minHeight: Math.min(420, height),
    };
  }, [hasOptimizedDraft, isMobile, viewportHeight, viewportWidth]);

  const handleToggleHistoryPanel = useCallback(
    (panel: OptimizeHistoryPanel) => {
      if (panel === 'current') {
        refreshPromptHistory();
      } else {
        setRequirementsHistory(readRequirementsHistory());
      }
      analytics.trackPromptAction({
        action: 'toggle_history',
        surface: 'prompt_optimize_dialog',
        promptType: toPromptAnalyticsType(
          panel === 'current' ? effectiveHistoryType || effectiveType : undefined
        ),
        mode,
        metadata: { panel },
      });
      setActiveHistoryPanel((currentPanel) =>
        currentPanel === panel ? null : panel
      );
    },
    [effectiveHistoryType, effectiveType, mode, refreshPromptHistory]
  );

  const handleSelectCurrentPromptHistory = useCallback((item: PromptItem) => {
    setCurrentPrompt(item.content);
    setActiveHistoryPanel(null);
  }, []);

  const handleSelectRequirementsHistory = useCallback((item: PromptItem) => {
    setRequirements(item.content);
    setActiveHistoryPanel(null);
  }, []);

  const handleModeChange = useCallback(
    (nextMode: PromptOptimizeMode) => {
      analytics.trackPromptAction({
        action: 'mode_select',
        surface: 'prompt_optimize_dialog',
        promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
        mode: nextMode,
      });
      setMode(nextMode);
    },
    [effectiveHistoryType, effectiveType]
  );

  const renderHistoryPanel = (
    panel: OptimizeHistoryPanel,
    items: PromptItem[],
    onSelect: (item: PromptItem) => void
  ) => {
    if (activeHistoryPanel !== panel) {
      return null;
    }

    return (
      <div
        ref={historyPopoverRef}
        className="prompt-optimize-dialog__history-panel"
      >
        {items.length > 0 ? (
          <PromptListPanel
            title={language === 'zh' ? '历史' : 'History'}
            items={items}
            onSelect={onSelect}
            language={language}
            analyticsSurface={`prompt_optimize_${panel}_history`}
            analyticsPromptType={toPromptAnalyticsType(
              panel === 'current' ? effectiveHistoryType || effectiveType : undefined
            )}
            showCount
          />
        ) : (
          <div className="prompt-optimize-dialog__history-empty">
            {language === 'zh' ? '暂无历史' : 'No history yet'}
          </div>
        )}
      </div>
    );
  };

  if (!open) {
    return null;
  }

  return (
    <WinBoxWindow
      id={windowId}
      visible={open}
      title={title}
      icon={<Sparkles size={16} />}
      onClose={handleClose}
      width={windowSize.width}
      height={windowSize.height}
      minWidth={windowSize.minWidth}
      minHeight={windowSize.minHeight}
      x="center"
      y="center"
      maximizable={!isMobile}
      minimizable={false}
      resizable={!isMobile}
      movable={!isMobile}
      modal={false}
      background="#ffffff"
      className={`winbox-ai-generation winbox-prompt-optimize ${
        hasOptimizedDraft ? 'winbox-prompt-optimize--split' : ''
      }`}
    >
      <div
        className={`prompt-optimize-dialog ${
          hasOptimizedDraft ? 'prompt-optimize-dialog--split' : ''
        }`}
      >
        <div
          className={`prompt-optimize-dialog__body ${
            hasOptimizedDraft ? 'prompt-optimize-dialog__body--split' : ''
          }`}
        >
          <div className="prompt-optimize-dialog__form-pane">
            <div className="prompt-optimize-dialog__section prompt-optimize-dialog__section--current">
              <div className="prompt-optimize-dialog__label-row">
                <label
                  className="prompt-optimize-dialog__label"
                  htmlFor={currentPromptId}
                >
                  {language === 'zh' ? '当前提示词' : 'Current Prompt'}
                </label>
                <button
                  type="button"
                  className="prompt-optimize-dialog__history-btn"
                  onClick={() => handleToggleHistoryPanel('current')}
                  aria-label={
                    language === 'zh'
                      ? '当前提示词历史'
                      : 'Current prompt history'
                  }
                >
                  <History size={16} />
                </button>
                {renderHistoryPanel(
                  'current',
                  currentPromptHistoryItems,
                  handleSelectCurrentPromptHistory
                )}
              </div>
              <textarea
                id={currentPromptId}
                className="prompt-optimize-dialog__textarea prompt-optimize-dialog__textarea--current"
                value={currentPrompt}
                onChange={(event) => setCurrentPrompt(event.target.value)}
                placeholder={
                  language === 'zh'
                    ? '输入或编辑要优化的提示词...'
                    : 'Enter or edit the prompt to optimize...'
                }
                rows={5}
                disabled={isOptimizing}
              />
            </div>

            <div className="prompt-optimize-dialog__section prompt-optimize-dialog__section--requirements">
              <div className="prompt-optimize-dialog__label-row">
                <label
                  className="prompt-optimize-dialog__label"
                  htmlFor={requirementsId}
                >
                  {language === 'zh' ? '补充要求' : 'Additional Requirements'}
                </label>
                <button
                  type="button"
                  className="prompt-optimize-dialog__history-btn"
                  onClick={() => handleToggleHistoryPanel('requirements')}
                  aria-label={
                    language === 'zh'
                      ? '补充要求历史'
                      : 'Additional requirements history'
                  }
                >
                  <History size={16} />
                </button>
                {renderHistoryPanel(
                  'requirements',
                  requirementsHistoryItems,
                  handleSelectRequirementsHistory
                )}
              </div>
              <textarea
                id={requirementsId}
                className="prompt-optimize-dialog__textarea"
                value={requirements}
                onChange={(event) => setRequirements(event.target.value)}
                placeholder={requirementsPlaceholder}
                rows={4}
                disabled={isOptimizing}
              />
            </div>
          </div>

          {hasOptimizedDraft && (
            <div className="prompt-optimize-dialog__result-pane">
              <div className="prompt-optimize-dialog__section prompt-optimize-dialog__section--result">
                <div className="prompt-optimize-dialog__result-header">
                  <label
                    className="prompt-optimize-dialog__label"
                    htmlFor={draftPromptId}
                  >
                    {language === 'zh' ? '优化结果草稿' : 'Optimized Draft'}
                  </label>
                </div>
                <textarea
                  id={draftPromptId}
                  className="prompt-optimize-dialog__textarea prompt-optimize-dialog__textarea--draft"
                  value={optimizedDraft}
                  onChange={(event) => setOptimizedDraft(event.target.value)}
                  rows={6}
                  disabled={isOptimizing}
                />
              </div>
            </div>
          )}
        </div>

        <div
          className={`prompt-optimize-dialog__footer ${
            hasOptimizedDraft ? 'prompt-optimize-dialog__footer--split' : ''
          }`}
        >
          <div className="prompt-optimize-dialog__footer-actions prompt-optimize-dialog__footer-actions--form">
            <div className="prompt-optimize-dialog__footer-controls">
              {allowStructuredMode && (
                <div
                  className="prompt-optimize-dialog__mode-switch"
                  aria-label={language === 'zh' ? '输出模式' : 'Output Mode'}
                >
                  <button
                    type="button"
                    className={`prompt-optimize-dialog__mode-btn ${
                      mode === 'polish'
                        ? 'prompt-optimize-dialog__mode-btn--active'
                        : ''
                    }`}
                    onClick={() => handleModeChange('polish')}
                    disabled={isOptimizing}
                  >
                    <Sparkles size={14} />
                    <span>{language === 'zh' ? '普通润色' : 'Polish'}</span>
                  </button>
                  <button
                    type="button"
                    className={`prompt-optimize-dialog__mode-btn ${
                      mode === 'structured'
                        ? 'prompt-optimize-dialog__mode-btn--active'
                        : ''
                    }`}
                    onClick={() => handleModeChange('structured')}
                    disabled={isOptimizing}
                  >
                    <span>
                      {language === 'zh' ? '结构化 JSON' : 'Structured JSON'}
                    </span>
                  </button>
                </div>
              )}
              <div className="prompt-optimize-dialog__model">
                <ModelDropdown
                  selectedModel={optimizerModel}
                  selectedSelectionKey={getSelectionKey(
                    optimizerModel,
                    optimizerModelRef
                  )}
                  onSelect={(modelId, modelRef) => {
                    const nextModelRef = modelRef || null;
                    analytics.trackPromptAction({
                      action: 'model_select',
                      surface: 'prompt_optimize_dialog',
                      promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
                      mode,
                      model: modelId,
                    });
                    setOptimizerModel(modelId);
                    setOptimizerModelRef(nextModelRef);
                    writeStoredModelSelection(
                      LS_KEYS.PROMPT_OPTIMIZE_TEXT_MODEL,
                      modelId,
                      nextModelRef
                    );
                  }}
                  onSelectModel={(model) => {
                    const nextModelRef = getModelRefFromConfig(model);
                    analytics.trackPromptAction({
                      action: 'model_select',
                      surface: 'prompt_optimize_dialog',
                      promptType: toPromptAnalyticsType(effectiveHistoryType || effectiveType),
                      mode,
                      model: model.id,
                    });
                    setOptimizerModel(model.id);
                    setOptimizerModelRef(nextModelRef);
                    writeStoredModelSelection(
                      LS_KEYS.PROMPT_OPTIMIZE_TEXT_MODEL,
                      model.id,
                      nextModelRef
                    );
                  }}
                  language={language}
                  models={visibleTextModels}
                  placement="up"
                  header={
                    language === 'zh'
                      ? '选择文本模型 (↑↓ Tab)'
                      : 'Select text model (↑↓ Tab)'
                  }
                  disabled={isOptimizing}
                />
              </div>
            </div>
            <div className="prompt-optimize-dialog__footer-buttons">
              <button
                type="button"
                className="prompt-optimize-dialog__footer-btn prompt-optimize-dialog__footer-btn--primary"
                onClick={() => void handleOptimizePrompt()}
                disabled={isOptimizing || !canOptimize}
              >
                {language === 'zh'
                  ? isOptimizing
                    ? mode === 'structured'
                      ? '生成中...'
                      : '优化中...'
                    : mode === 'structured'
                    ? '生成结构化提示词'
                    : '开始优化'
                  : isOptimizing
                  ? mode === 'structured'
                    ? 'Generating...'
                    : 'Optimizing...'
                  : mode === 'structured'
                  ? 'Generate Structured Prompt'
                  : 'Optimize'}
              </button>
              <button
                type="button"
                className="prompt-optimize-dialog__footer-btn prompt-optimize-dialog__footer-btn--apply"
                onClick={handleApplyPrompt}
                disabled={isOptimizing || !canApply}
              >
                {language === 'zh' ? '回填' : 'Apply'}
              </button>
            </div>
          </div>
          {hasOptimizedDraft && (
            <div className="prompt-optimize-dialog__footer-actions prompt-optimize-dialog__footer-actions--result">
              <button
                type="button"
                className="prompt-optimize-dialog__footer-btn prompt-optimize-dialog__footer-btn--secondary"
                onClick={handleUseDraftAsCurrent}
                disabled={isOptimizing}
              >
                {language === 'zh'
                  ? '用结果继续优化'
                  : 'Use Draft to Refine'}
              </button>
            </div>
          )}
        </div>
      </div>
    </WinBoxWindow>
  );
};

export default PromptOptimizeDialog;
