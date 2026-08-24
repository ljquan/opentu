import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MessagePlugin } from '../../utils/message-plugin';
import {
  Clipboard,
  Edit3,
  Loader2,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  createPromptHistoryRecord,
  deletePromptHistoryPrompts,
  getPromptHistoryPage,
  setPromptHistoryPinned,
  updatePromptHistoryRecord,
  type PromptHistoryCategory,
  type PromptHistoryRecord,
  type PromptHistoryResultPreview,
} from '../../services/prompt-history-service';
import {
  analytics,
  type PromptAnalyticsType,
} from '../../utils/umami-analytics';
import { copyToClipboard } from '../../utils/runtime-helpers';
import { RetryImage } from '../retry-image';
import { HoverTip } from '../shared/hover';
import { UnifiedMediaViewer, type MediaItem } from '../shared/media-preview';
import { VideoPosterPreview } from '../shared/VideoPosterPreview';
import './prompt-history-tool.scss';

const CATEGORY_OPTIONS: Array<{
  value: PromptHistoryCategory | 'all';
  label: string;
}> = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'text', label: '文本' },
  { value: 'agent', label: 'Agent' },
  { value: 'ppt-common', label: 'PPT公共' },
  { value: 'ppt-slide', label: 'PPT页面' },
];

type PromptDialogMode = 'create' | 'edit';

interface PromptDialogState {
  mode: PromptDialogMode;
  record?: PromptHistoryRecord;
  title: string;
  sentPrompt: string;
  tagsInput: string;
  category: PromptHistoryCategory;
  pinned: boolean;
}

function parseTagsInput(value: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  value
    .split(/[\n,，;；]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => {
      const normalized = tag.slice(0, 60);
      if (seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      result.push(normalized);
    });
  return result;
}

function categoryLabel(category: PromptHistoryCategory): string {
  return (
    CATEGORY_OPTIONS.find((item) => item.value === category)?.label || category
  );
}

function toPromptAnalyticsType(
  category: PromptHistoryCategory | 'all'
): PromptAnalyticsType | undefined {
  return category === 'all' ? undefined : category;
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function resultPreviewText(preview: PromptHistoryResultPreview): string {
  if (preview.kind === 'audio') {
    return preview.title || preview.text || preview.url || '音频结果';
  }
  if (preview.kind === 'text') {
    return preview.title ? `${preview.title} ${preview.text}` : preview.text;
  }
  if (preview.kind === 'image' || preview.kind === 'video') {
    return '';
  }
  return preview.text;
}

function previewToMediaItem(
  preview: PromptHistoryResultPreview,
  record: PromptHistoryRecord,
  index: number
): MediaItem | null {
  if (preview.kind === 'image') {
    return {
      id: `${record.id}-result-${index}`,
      url: preview.url,
      type: 'image',
      title: preview.title || record.title,
      prompt: record.sentPrompt,
    };
  }
  if (preview.kind === 'video') {
    return {
      id: `${record.id}-result-${index}`,
      url: preview.url,
      type: 'video',
      posterUrl: preview.posterUrl,
      title: preview.title || record.title,
      duration: preview.duration,
      prompt: record.sentPrompt,
    };
  }
  if (preview.kind === 'audio' && preview.url) {
    return {
      id: `${record.id}-result-${index}`,
      url: preview.url,
      type: 'audio',
      posterUrl: preview.coverUrl,
      title: preview.title || record.title,
      duration: preview.duration,
      prompt: record.sentPrompt,
    };
  }
  return null;
}

function resultPreviewMedia(record: PromptHistoryRecord): MediaItem[] {
  const previews =
    record.resultPreviews?.length > 0
      ? record.resultPreviews
      : record.resultPreview
      ? [record.resultPreview]
      : [];
  return previews
    .map((preview, index) => previewToMediaItem(preview, record, index))
    .filter((item): item is MediaItem => Boolean(item));
}

function canEditSentPrompt(record?: PromptHistoryRecord): boolean {
  return Boolean(record && record.resultCount === 0);
}

interface PromptHistoryToolProps {
  initialCategory?: PromptHistoryCategory;
}

export const PromptHistoryTool: React.FC<PromptHistoryToolProps> = ({
  initialCategory,
}) => {
  const [records, setRecords] = useState<PromptHistoryRecord[]>([]);
  const [category, setCategory] = useState<PromptHistoryCategory | 'all'>(
    initialCategory || 'all'
  );
  const [skillTag, setSkillTag] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [skillTags, setSkillTags] = useState<string[]>([]);
  const [loadingMode, setLoadingMode] = useState<'reset' | 'more' | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewItems, setPreviewItems] = useState<MediaItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [dialogState, setDialogState] = useState<PromptDialogState | null>(
    null
  );
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const lastSelectedIdRef = useRef<string | null>(null);
  const searchTrackAtRef = useRef(0);
  const loading = loadingMode !== null;

  useEffect(() => {
    analytics.trackPromptAction({
      action: 'open_tool',
      surface: 'prompt_history_tool',
      source: 'toolbox',
      status: 'success',
      metadata: {
        tool_id: 'prompt-history',
      },
    });
  }, []);

  useEffect(() => {
    if (!initialCategory) {
      return;
    }
    setCategory(initialCategory);
    setSkillTag('all');
    setSearch('');
  }, [initialCategory]);

  const loadPage = useCallback(
    async (mode: 'reset' | 'more' = 'reset', offset = 0) => {
      if (mode === 'more' && loadingRef.current) {
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      setLoadingMode(mode);
      try {
        const page = await getPromptHistoryPage({
          category,
          skillTag,
          search,
          offset,
          limit: 30,
        });
        if (requestId !== requestIdRef.current) {
          return;
        }
        setRecords((prev) =>
          mode === 'more' ? [...prev, ...page.records] : page.records
        );
        setNextOffset(page.nextOffset);
        setHasMore(page.hasMore);
        setTotal(page.total);
        setSkillTags(page.skillTags);
        if (mode === 'reset') {
          setSelectedIds(new Set());
          lastSelectedIdRef.current = null;
        }
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        analytics.trackPromptAction({
          action: 'load_history',
          surface: 'prompt_history_tool',
          promptType: toPromptAnalyticsType(category),
          status: 'failed',
          metadata: {
            mode,
            has_search: search.trim().length > 0,
            has_skill_filter: skillTag !== 'all',
          },
        });
        console.error('[PromptHistoryTool] 加载提示词历史失败:', error);
        MessagePlugin.error('我的提示词加载失败');
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setLoadingMode(null);
        }
      }
    },
    [category, search, skillTag]
  );

  useEffect(() => {
    void loadPage('reset');
  }, [loadPage]);

  useEffect(() => {
    if (skillTag !== 'all' && !skillTags.includes(skillTag)) {
      setSkillTag('all');
    }
  }, [skillTag, skillTags]);

  const orderedIds = useMemo(
    () => records.map((record) => record.id),
    [records]
  );
  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.has(record.id)),
    [records, selectedIds]
  );
  const dialogTags = useMemo(
    () => parseTagsInput(dialogState?.tagsInput || ''),
    [dialogState?.tagsInput]
  );
  const loadedText = useMemo(
    () => `共 ${total} 条，已加载 ${records.length} 条`,
    [records.length, total]
  );
  const allLoadedSelected =
    orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id));

  const handleRefresh = useCallback(() => {
    analytics.trackPromptAction({
      action: 'refresh',
      surface: 'prompt_history_tool',
      promptType: toPromptAnalyticsType(category),
      metadata: {
        has_search: search.trim().length > 0,
        has_skill_filter: skillTag !== 'all',
      },
    });
    void loadPage('reset');
  }, [category, loadPage, search, skillTag]);

  const handleCategoryChange = useCallback(
    (nextCategory: PromptHistoryCategory | 'all') => {
      if (nextCategory === category) return;
      analytics.trackPromptAction({
        action: 'filter_category',
        surface: 'prompt_history_tool',
        promptType: toPromptAnalyticsType(nextCategory),
        metadata: { category: nextCategory },
      });
      setCategory(nextCategory);
    },
    [category]
  );

  const handleSkillTagChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextSkillTag = event.target.value;
      analytics.trackPromptAction({
        action: 'filter_skill',
        surface: 'prompt_history_tool',
        promptType: toPromptAnalyticsType(category),
        metadata: {
          selection: nextSkillTag === 'all' ? 'all' : 'custom',
        },
      });
      setSkillTag(nextSkillTag);
    },
    [category]
  );

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextSearch = event.target.value;
      setSearch(nextSearch);

      const trimmed = nextSearch.trim();
      if (!trimmed) return;
      const now = Date.now();
      if (now - searchTrackAtRef.current < 2000) return;
      searchTrackAtRef.current = now;
      analytics.trackPromptAction({
        action: 'search',
        surface: 'prompt_history_tool',
        promptType: toPromptAnalyticsType(category),
        prompt: trimmed,
        metadata: {
          has_skill_filter: skillTag !== 'all',
        },
      });
    },
    [category, skillTag]
  );

  const toggleSelection = useCallback(
    (recordId: string, checked: boolean, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const anchor = lastSelectedIdRef.current;
        if (shiftKey && anchor) {
          const anchorIndex = orderedIds.indexOf(anchor);
          const targetIndex = orderedIds.indexOf(recordId);
          if (anchorIndex >= 0 && targetIndex >= 0) {
            const [start, end] =
              anchorIndex < targetIndex
                ? [anchorIndex, targetIndex]
                : [targetIndex, anchorIndex];
            orderedIds.slice(start, end + 1).forEach((id) => {
              if (checked) {
                next.add(id);
              } else {
                next.delete(id);
              }
            });
            return next;
          }
        }

        if (checked) {
          next.add(recordId);
        } else {
          next.delete(recordId);
        }
        lastSelectedIdRef.current = recordId;
        return next;
      });
    },
    [orderedIds]
  );

  const handleToggleAllLoaded = useCallback(
    (checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        orderedIds.forEach((id) => {
          if (checked) {
            next.add(id);
          } else {
            next.delete(id);
          }
        });
        return next;
      });
    },
    [orderedIds]
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedRecords.length === 0) return;
    deletePromptHistoryPrompts(
      selectedRecords.flatMap((record) => record.sourceSentPrompts)
    );
    analytics.trackPromptAction({
      action: 'delete',
      surface: 'prompt_history_tool',
      itemCount: selectedRecords.length,
      status: 'success',
    });
    MessagePlugin.success(`已删除 ${selectedRecords.length} 条提示词`);
    void loadPage('reset');
  }, [loadPage, selectedRecords]);

  const handleCopyPrompt = useCallback(
    async (
      record: PromptHistoryRecord,
      event: React.MouseEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
      try {
        await copyToClipboard(record.sentPrompt);
        analytics.trackPromptAction({
          action: 'copy',
          surface: 'prompt_history_tool',
          promptType: toPromptAnalyticsType(record.category),
          prompt: record.sentPrompt,
          status: 'success',
          metadata: {
            record_status: record.status,
            initial_differs_from_sent:
              record.initialPrompt !== record.sentPrompt,
          },
        });
        MessagePlugin.success('提示词已复制');
      } catch (error) {
        console.error('[PromptHistoryTool] 复制提示词失败:', error);
        MessagePlugin.error('复制失败');
      }
    },
    []
  );

  const handleCheckboxMouseDown = useCallback(
    (event: React.MouseEvent<HTMLInputElement>) => {
      if (event.shiftKey) {
        window.getSelection()?.removeAllRanges();
      }
    },
    []
  );

  const handleTogglePinned = useCallback(
    (
      record: PromptHistoryRecord,
      event: React.MouseEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
      const nextPinned = !record.pinned;
      setPromptHistoryPinned(record.sentPrompt, nextPinned, record.category);
      analytics.trackPromptAction({
        action: nextPinned ? 'pin' : 'unpin',
        surface: 'prompt_history_tool',
        promptType: toPromptAnalyticsType(record.category),
        prompt: record.sentPrompt,
        status: 'success',
      });
      MessagePlugin.success(nextPinned ? '已置顶提示词' : '已取消置顶');
      void loadPage('reset');
    },
    [loadPage]
  );

  const handleOpenEditDialog = useCallback(
    (
      record: PromptHistoryRecord,
      event: React.MouseEvent<HTMLButtonElement>
    ) => {
      event.stopPropagation();
      setDialogState({
        mode: 'edit',
        record,
        title: record.title,
        sentPrompt: record.sentPrompt,
        tagsInput: record.tags.join(', '),
        category: record.category,
        pinned: record.pinned,
      });
    },
    []
  );

  const handleOpenCreateDialog = useCallback(
    (
      record?: PromptHistoryRecord,
      event?: React.MouseEvent<HTMLButtonElement>
    ) => {
      event?.stopPropagation();
      const defaultCategory = category === 'all' ? 'text' : category;
      setDialogState({
        mode: 'create',
        record,
        title: record?.title || '',
        sentPrompt: record?.sentPrompt || '',
        tagsInput: record?.tags.join(', ') || '',
        category: record?.category || defaultCategory,
        pinned: record?.pinned || false,
      });
    },
    [category]
  );

  const handleCloseEditDialog = useCallback(() => {
    setDialogState(null);
  }, []);

  const handleSubmitEditDialog = useCallback(() => {
    if (!dialogState) return;
    if (!dialogState.sentPrompt.trim()) {
      MessagePlugin.warning('发送提示词不能为空');
      return;
    }

    const canEditCurrentSentPrompt =
      dialogState.mode === 'edit' && canEditSentPrompt(dialogState.record);

    const success =
      dialogState.mode === 'create'
        ? createPromptHistoryRecord({
            title: dialogState.title,
            content: dialogState.sentPrompt,
            tags: dialogTags,
            category: dialogState.category,
            pinned: dialogState.pinned,
          })
        : updatePromptHistoryRecord({
            sourceSentPrompt: dialogState.record?.sourceSentPrompt || '',
            sourceSentPrompts: dialogState.record?.sourceSentPrompts,
            title: dialogState.title,
            sentPrompt: canEditCurrentSentPrompt
              ? dialogState.sentPrompt
              : dialogState.record?.sentPrompt || dialogState.sentPrompt,
            tags: dialogTags,
            category: dialogState.record?.category,
            ...(canEditCurrentSentPrompt
              ? { allowSentPromptEdit: true }
              : {}),
          });
    if (!success) {
      MessagePlugin.error('保存失败');
      return;
    }

    analytics.trackPromptAction({
      action: dialogState.mode === 'create' ? 'create' : 'edit',
      surface: 'prompt_history_tool',
      promptType: toPromptAnalyticsType(dialogState.category),
      prompt: dialogState.sentPrompt,
      status: 'success',
      metadata: {
        tag_count: dialogTags.length,
        title_changed:
          dialogState.mode === 'edit'
            ? dialogState.title.trim() !== dialogState.record?.title
            : Boolean(dialogState.title.trim()),
        prompt_changed:
          dialogState.mode === 'create' ||
          (canEditCurrentSentPrompt &&
            dialogState.sentPrompt.trim() !== dialogState.record?.sentPrompt),
      },
    });
    MessagePlugin.success(
      dialogState.mode === 'create' ? '提示词已创建' : '提示词已更新'
    );
    setDialogState(null);
    void loadPage('reset');
  }, [dialogState, dialogTags, loadPage]);

  const updateDialogState = useCallback(
    (patch: Partial<PromptDialogState>) => {
      setDialogState((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    []
  );

  const openPreview = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      items: MediaItem[],
      index: number
    ) => {
      event.stopPropagation();
      if (items.length === 0) return;
      setPreviewItems(items);
      setPreviewInitialIndex(index);
      setPreviewVisible(true);
    },
    []
  );

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceToBottom < 180 && hasMore && !loading) {
        analytics.trackPromptAction({
          action: 'load_more',
          surface: 'prompt_history_tool',
          promptType: toPromptAnalyticsType(category),
          itemCount: records.length,
          metadata: {
            has_search: search.trim().length > 0,
            has_skill_filter: skillTag !== 'all',
            next_offset: nextOffset,
          },
        });
        void loadPage('more', nextOffset);
      }
    },
    [
      category,
      hasMore,
      loadPage,
      loading,
      nextOffset,
      records.length,
      search,
      skillTag,
    ]
  );

  const canEditDialogSentPrompt =
    dialogState?.mode === 'create' || canEditSentPrompt(dialogState?.record);

  return (
    <div className="prompt-history-tool">
      <div className="prompt-history-tool__toolbar">
        <div className="prompt-history-tool__search">
          <Search size={14} />
          <input
            value={search}
            onChange={handleSearchChange}
            placeholder="搜索标题、提示词、标签"
          />
        </div>
        <button
          type="button"
          className="prompt-history-tool__icon-btn"
          onClick={() => handleOpenCreateDialog()}
          aria-label="新建提示词"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="prompt-history-tool__icon-btn"
          onClick={handleRefresh}
          disabled={loading}
          aria-label="刷新"
        >
          {loading ? <Loader2 size={16} /> : <RotateCcw size={16} />}
        </button>
      </div>

      <div className="prompt-history-tool__filters">
        {CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={category === option.value ? 'is-active' : ''}
            onClick={() => handleCategoryChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {skillTags.length > 0 && (
        <div className="prompt-history-tool__skill-filter">
          <select value={skillTag} onChange={handleSkillTagChange}>
            <option value="all">全部 Skill</option>
            {skillTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="prompt-history-tool__summary">
        <span>{loadedText}</span>
        {selectedRecords.length > 0 && (
          <button
            type="button"
            className="prompt-history-tool__delete-btn"
            onClick={handleDeleteSelected}
          >
            <Trash2 size={14} />
            删除 {selectedRecords.length} 条
          </button>
        )}
        {loadingMode === 'reset' && (
          <Loader2
            size={14}
            className="prompt-history-tool__summary-loading"
          />
        )}
      </div>

      <div className="prompt-history-tool__table-wrap" onScroll={handleScroll}>
        <table className="prompt-history-tool__table">
          <thead>
            <tr>
              <th className="prompt-history-tool__col-select">
                <input
                  type="checkbox"
                  aria-label="选择已加载提示词"
                  checked={allLoadedSelected}
                  onChange={(event) =>
                    handleToggleAllLoaded(event.target.checked)
                  }
                />
              </th>
              <th className="prompt-history-tool__col-type">类型</th>
              <th className="prompt-history-tool__col-title">标题</th>
              <th>发送提示词</th>
              <th className="prompt-history-tool__col-tags">标签</th>
              <th className="prompt-history-tool__col-result">结果</th>
              <th className="prompt-history-tool__col-time">时间</th>
              <th className="prompt-history-tool__col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const mediaItems = resultPreviewMedia(record);
              return (
                <tr
                  key={record.id}
                  className={selectedIds.has(record.id) ? 'is-selected' : ''}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${record.title}`}
                      checked={selectedIds.has(record.id)}
                      onMouseDown={handleCheckboxMouseDown}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        toggleSelection(
                          record.id,
                          event.target.checked,
                          event.nativeEvent instanceof MouseEvent
                            ? event.nativeEvent.shiftKey
                            : false
                        )
                      }
                    />
                  </td>
                  <td>
                    <span
                      className={`prompt-history-tool__type prompt-history-tool__type--${record.category}`}
                    >
                      {categoryLabel(record.category)}
                    </span>
                  </td>
                  <td>
                    <div className="prompt-history-tool__title">
                      {record.title}
                    </div>
                    {record.initialPrompt !== record.sentPrompt && (
                      <div className="prompt-history-tool__subtext">
                        初始：{record.initialPrompt}
                      </div>
                    )}
                    {record.sourceSentPrompt !== record.sentPrompt && (
                      <div className="prompt-history-tool__subtext">
                        原始：{record.sourceSentPrompt}
                      </div>
                    )}
                  </td>
                  <td>
                    <HoverTip
                      placement="left"
                      delay={120}
                      overlayClassName="prompt-history-tool__prompt-popover"
                      content={
                        <div className="prompt-history-tool__prompt-full">
                          {record.sentPrompt}
                        </div>
                      }
                    >
                      <button
                        type="button"
                        className="prompt-history-tool__prompt"
                        onClick={(event) => handleCopyPrompt(record, event)}
                        aria-label={`复制提示词：${record.title}`}
                      >
                        {record.sentPrompt}
                      </button>
                    </HoverTip>
                  </td>
                  <td>
                    <div className="prompt-history-tool__tags">
                      {record.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {mediaItems.length > 0 ? (
                      <div className="prompt-history-tool__media-grid">
                        {mediaItems.slice(0, 4).map((item, index) => (
                          <HoverTip
                            key={item.id || item.url}
                            placement="left"
                            delay={80}
                            overlayClassName="prompt-history-tool__media-popover"
                            content={
                              item.type === 'video' ? (
                                <video
                                  src={item.url}
                                  poster={item.posterUrl}
                                  controls
                                  muted
                                  preload="metadata"
                                />
                              ) : (
                                <RetryImage
                                  src={item.posterUrl || item.url}
                                  alt={item.title || record.title}
                                  showSkeleton={false}
                                  eager
                                />
                              )
                            }
                          >
                            <button
                              type="button"
                              className="prompt-history-tool__media-thumb"
                              onClick={(event) =>
                                openPreview(event, mediaItems, index)
                              }
                            >
                              {item.type === 'video' ? (
                                <VideoPosterPreview
                                  src={item.url}
                                  poster={item.posterUrl}
                                  alt={item.title || record.title}
                                  thumbnailSize="small"
                                  activateVideoOnClick={false}
                                />
                              ) : (
                                <RetryImage
                                  src={item.posterUrl || item.url}
                                  alt={item.title || record.title}
                                  showSkeleton={false}
                                  eager
                                />
                              )}
                            </button>
                          </HoverTip>
                        ))}
                        {record.resultCount > 4 && (
                          <span className="prompt-history-tool__media-count">
                            +{record.resultCount - 4}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="prompt-history-tool__result-text">
                        {resultPreviewText(record.resultPreview)}
                      </div>
                    )}
                  </td>
                  <td>{formatTime(record.createdAt)}</td>
                  <td>
                    <div className="prompt-history-tool__actions">
                      <button
                        type="button"
                        className="prompt-history-tool__create-btn"
                        onClick={(event) => handleOpenCreateDialog(record, event)}
                        aria-label={`基于 ${record.title} 创建`}
                      >
                        <Plus size={15} />
                      </button>
                      <button
                        type="button"
                        className="prompt-history-tool__edit-btn"
                        onClick={(event) => handleOpenEditDialog(record, event)}
                        aria-label={`编辑 ${record.title}`}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        className={`prompt-history-tool__pin-btn ${
                          record.pinned ? 'is-pinned' : ''
                        }`}
                        onClick={(event) => handleTogglePinned(record, event)}
                        aria-label={record.pinned ? '取消置顶' : '置顶'}
                      >
                        {record.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && records.length === 0 && (
          <div className="prompt-history-tool__empty">暂无我的提示词</div>
        )}
        {loadingMode === 'more' && (
          <div className="prompt-history-tool__loading-more">
            <Loader2 size={14} />
            加载中...
          </div>
        )}
        {!hasMore && records.length > 0 && (
          <div className="prompt-history-tool__done">已加载全部</div>
        )}
      </div>

      <div className="prompt-history-tool__footer">
        <div className="prompt-history-tool__hint">
          <Clipboard size={13} />
          点击提示词复制，勾选列选择，Shift 连选
        </div>
        <span>{hasMore ? '向下滚动自动加载' : '没有更多了'}</span>
      </div>
      <UnifiedMediaViewer
        visible={previewVisible}
        items={previewItems}
        initialIndex={previewInitialIndex}
        onClose={() => setPreviewVisible(false)}
        showThumbnails={previewItems.length > 1}
        videoAutoPlay={true}
      />
      {dialogState && (
        <div
          className="prompt-history-tool__edit-mask"
          role="presentation"
          onMouseDown={handleCloseEditDialog}
        >
          <form
            className="prompt-history-tool__edit-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmitEditDialog();
            }}
          >
            <div className="prompt-history-tool__edit-header">
              <div>
                <h3>
                  {dialogState.mode === 'create' ? '创建提示词' : '编辑提示词'}
                </h3>
                <p>
                  {dialogState.mode === 'create'
                    ? '填写类型、置顶、标题、发送提示词和标签'
                    : canEditDialogSentPrompt
                    ? '修改标题、发送提示词和标签'
                    : '修改标题和标签，发送提示词保持不变'}
                </p>
              </div>
              <button
                type="button"
                className="prompt-history-tool__edit-close"
                onClick={handleCloseEditDialog}
                aria-label="关闭编辑弹窗"
              >
                ×
              </button>
            </div>

            {dialogState.mode === 'create' && (
              <div className="prompt-history-tool__field-row">
                <label className="prompt-history-tool__field">
                  <span>类型</span>
                  <select
                    value={dialogState.category}
                    onChange={(event) =>
                      updateDialogState({
                        category: event.target.value as PromptHistoryCategory,
                      })
                    }
                  >
                    {CATEGORY_OPTIONS.filter(
                      (
                        option
                      ): option is {
                        value: PromptHistoryCategory;
                        label: string;
                      } => option.value !== 'all'
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="prompt-history-tool__switch-field">
                  <input
                    type="checkbox"
                    checked={dialogState.pinned}
                    onChange={(event) =>
                      updateDialogState({ pinned: event.target.checked })
                    }
                  />
                  <span>置顶</span>
                </label>
              </div>
            )}

            <label className="prompt-history-tool__field">
              <span>标题</span>
              <input
                value={dialogState.title}
                onChange={(event) =>
                  updateDialogState({ title: event.target.value })
                }
                maxLength={80}
                placeholder="输入标题"
              />
            </label>

            <label className="prompt-history-tool__field">
              <span>发送提示词</span>
              <textarea
                value={dialogState.sentPrompt}
                onChange={(event) =>
                  updateDialogState({ sentPrompt: event.target.value })
                }
                readOnly={!canEditDialogSentPrompt}
                rows={8}
                maxLength={2000}
                placeholder="输入发送提示词"
              />
            </label>

            <label className="prompt-history-tool__field">
              <span>标签</span>
              <textarea
                className="prompt-history-tool__tags-input"
                value={dialogState.tagsInput}
                onChange={(event) =>
                  updateDialogState({ tagsInput: event.target.value })
                }
                rows={2}
                placeholder="多个标签用逗号或换行分隔"
              />
            </label>

            {dialogTags.length > 0 && (
              <div className="prompt-history-tool__edit-tags">
                {dialogTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}

            <div className="prompt-history-tool__edit-footer">
              <button type="button" onClick={handleCloseEditDialog}>
                取消
              </button>
              <button type="submit" className="is-primary">
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default PromptHistoryTool;
