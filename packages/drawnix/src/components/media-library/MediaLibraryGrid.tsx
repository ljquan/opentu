/**
 * Media Library Grid
 * 素材库网格视图组件 - 使用虚拟滚动优化大数据量性能
 */

import { useMemo, useState, useCallback, useRef, useEffect, useTransition } from 'react';
import { Loading, Input, Button, Checkbox, Tooltip, Dialog } from 'tdesign-react';
import { 
  Search, 
  Trash2, 
  CheckSquare, 
  XSquare, 
  HardDrive,
  Video as VideoIcon,
  Image as ImageIcon,
  Music,
  Globe,
  User,
  Sparkles,
  Clock,
  Calendar,
  ArrowUpAZ,
  ArrowDownZA,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Minus,
  Plus,
  Download,
  Eye,
  PlusCircle,
  CloudUpload,
  Heart,
  ListMusic,
} from 'lucide-react';
import { 
  ImageUploadIcon as ImageUploadIconComp,
  MediaLibraryIcon,
} from '../icons';
import { useAssets } from '../../contexts/AssetContext';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { filterAssets, formatFileSize } from '../../utils/asset-utils';
import { useDeviceType } from '../../hooks/useDeviceType';
import { VirtualAssetGrid } from './VirtualAssetGrid';
import { MediaLibraryEmpty } from './MediaLibraryEmpty';
import { ViewModeToggle } from './ViewModeToggle';
import { UnifiedMediaViewer, type MediaItem as UnifiedMediaItem } from '../shared/media-preview';
import { ImageEditor } from '../image-editor';
import { AudioPlaylistTabs } from '../shared/AudioPlaylistTabs';
import {
  ContextMenu,
  useContextMenuState,
  type ContextMenuEntry,
} from '../shared';
import type { MediaLibraryGridProps, ViewMode, SortOption, Asset } from '../../types/asset.types';
import { AssetType, AssetSource } from '../../types/asset.types';
import { useDrawnix } from '../../hooks/use-drawnix';
import { removeElementsByAssetIds, removeElementsByAssetUrls, isCacheUrl, countElementsByAssetUrls } from '../../utils/asset-cleanup';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import { useGitHubSync } from '../../contexts/GitHubSyncContext';
import { useAudioPlaylists } from '../../contexts/AudioPlaylistContext';
import { mediaSyncService } from '../../services/github-sync/media-sync-service';
import { openMusicPlayerToolAndPlay } from '../../services/tool-launch-service';
import {
  AUDIO_PLAYLIST_ALL_ID,
  type AudioPlaylist,
} from '../../types/audio-playlist.types';
import {
  buildAssetDownloadItem,
  buildAssetDownloadItems,
  smartDownload,
} from '../../utils/download-utils';
import './MediaLibraryGrid.scss';
import './VirtualAssetGrid.scss';

// 视图切换防抖时间
const VIEW_MODE_DEBOUNCE_MS = 150;

// localStorage keys
const VIEW_MODE_STORAGE_KEY = 'media-library-view-mode';
const GRID_SIZE_STORAGE_KEY = 'media-library-grid-size';

function normalizeImageDataUrl(value: string, fallbackMimeType = 'image/png'): string {
  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed || value;
  }

  const normalized = trimmed.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized) || normalized.length < 32) {
    return trimmed;
  }

  return `data:${fallbackMimeType};base64,${normalized}`;
}

// 从 localStorage 读取视图模式
const getStoredViewMode = (): ViewMode => {
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === 'grid' || stored === 'compact' || stored === 'list') {
      return stored;
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return 'grid';
};

// 从 localStorage 读取网格尺寸
const getStoredGridSize = (): number => {
  try {
    const stored = localStorage.getItem(GRID_SIZE_STORAGE_KEY);
    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val >= 80 && val <= 300) {
        return val;
      }
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return 180;
};

// 类型过滤选项
const TYPE_OPTIONS = [
  { value: 'ALL', label: '全部类型', icon: MediaLibraryIcon },
  { value: AssetType.IMAGE, label: '图片', icon: ImageUploadIconComp },
  { value: AssetType.VIDEO, label: '视频', icon: VideoIcon },
  { value: AssetType.AUDIO, label: '音频', icon: Music },
];

// 来源过滤选项
const SOURCE_OPTIONS = [
  { value: 'ALL', label: '全部来源', icon: Globe, countKey: 'sourceAll' },
  { value: AssetSource.LOCAL, label: '本地上传', icon: User, countKey: 'local' },
  { value: AssetSource.AI_GENERATED, label: 'AI生成', icon: Sparkles, countKey: 'ai' },
];

// 排序组定义
const SORT_GROUPS = [
  { 
    id: 'DATE', 
    label: '时间', 
    options: { asc: 'DATE_ASC' as SortOption, desc: 'DATE_DESC' as SortOption },
    icons: { asc: Calendar, desc: Clock },
    default: 'DATE_DESC' as SortOption
  },
  { 
    id: 'NAME', 
    label: '名称', 
    options: { asc: 'NAME_ASC' as SortOption, desc: 'NAME_DESC' as SortOption },
    icons: { asc: ArrowUpAZ, desc: ArrowDownZA },
    default: 'NAME_ASC' as SortOption
  },
  { 
    id: 'SIZE', 
    label: '大小', 
    options: { asc: 'SIZE_ASC' as SortOption, desc: 'SIZE_DESC' as SortOption },
    icons: { asc: ArrowUpNarrowWide, desc: ArrowDownWideNarrow },
    default: 'SIZE_DESC' as SortOption
  },
];

interface SelectionScopeSnapshot {
  activeType?: AssetType;
  activeSource?: AssetSource;
  searchQuery: string;
  playlistId: string | null;
}

interface SelectionState {
  scope: SelectionScopeSnapshot | null;
  selectedIds: Set<string>;
  deselectedIds: Set<string>;
}

function createEmptySelectionState(): SelectionState {
  return {
    scope: null,
    selectedIds: new Set<string>(),
    deselectedIds: new Set<string>(),
  };
}

function matchesSelectionScope(
  asset: Asset,
  scope: SelectionScopeSnapshot | null,
  playlistAssetIdSets: Map<string, Set<string>>
): boolean {
  if (!scope) return false;

  const matchesType = !scope.activeType || asset.type === scope.activeType;
  const matchesSource = !scope.activeSource || asset.source === scope.activeSource;
  const matchesSearch =
    !scope.searchQuery || asset.name.toLowerCase().includes(scope.searchQuery);

  let matchesPlaylist = true;
  if (scope.playlistId) {
    if (scope.playlistId === AUDIO_PLAYLIST_ALL_ID) {
      matchesPlaylist = asset.type === AssetType.AUDIO;
    } else {
      matchesPlaylist = playlistAssetIdSets.get(scope.playlistId)?.has(asset.id) ?? false;
    }
  }

  return matchesType && matchesSource && matchesSearch && matchesPlaylist;
}

export function MediaLibraryGrid({
  filterType,
  selectedAssetId,
  onSelectAsset,
  onDoubleClick,
  onFileUpload,
  onUploadClick,
  storageStatus,
}: MediaLibraryGridProps) {
  const { assets, filters, loading, setFilters, removeAssets, syncedUrls, loadSyncedUrls } = useAssets();
  const {
    playlists,
    favoriteAssetIds,
    playlistItems,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addAssetToPlaylist,
    removeAssetFromPlaylist,
    toggleFavorite,
    isFavorite,
    getPlaylistAssetIds,
  } = useAudioPlaylists();
  const { board } = useDrawnix();
  const { isMobile } = useDeviceType();
  const [isDragging, setIsDragging] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectionState, setSelectionState] = useState<SelectionState>(() =>
    createEmptySelectionState()
  );
  const [gridSize, setGridSize] = useState<number>(getStoredGridSize); // 从缓存恢复网格尺寸
  const lastSelectedIdRef = useRef<string | null>(null); // 记录上次选中的素材ID，用于Shift连选
  
  // 预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewItems, setPreviewItems] = useState<UnifiedMediaItem[]>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  
  // 图片编辑器状态
  const [imageEditorVisible, setImageEditorVisible] = useState(false);
  const [imageEditorUrl, setImageEditorUrl] = useState('');
  
  // 下载状态
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0); // 0-100
  
  // 同步状态
  const { isConfigured } = useGitHubSync();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0); // 0-100
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const {
    contextMenu: assetContextMenu,
    open: openAssetMenu,
    close: closeAssetMenu,
  } = useContextMenuState<Asset>();
  const [playlistDialog, setPlaylistDialog] = useState<{
    mode: 'create' | 'rename' | 'create-and-add';
    playlistId?: string;
    targetAssetId?: string;
  } | null>(null);
  const [playlistNameInput, setPlaylistNameInput] = useState('');
  const { confirm, confirmDialog } = useConfirmDialog();

  // 加载已同步的 URL（当配置了 GitHub 同步时）
  useEffect(() => {
    if (isConfigured) {
      loadSyncedUrls();
    }
  }, [isConfigured, loadSyncedUrls]);

  useEffect(() => {
    if (filters.activeType && filters.activeType !== AssetType.AUDIO && selectedPlaylistId) {
      setSelectedPlaylistId(null);
    }
  }, [filters.activeType, selectedPlaylistId]);

  useEffect(() => {
    if (
      selectedPlaylistId &&
      selectedPlaylistId !== AUDIO_PLAYLIST_ALL_ID &&
      !playlists.some((playlist) => playlist.id === selectedPlaylistId)
    ) {
      setSelectedPlaylistId(null);
    }
  }, [playlists, selectedPlaylistId]);

  // 监听媒体同步完成事件，刷新同步状态
  useEffect(() => {
    if (!isConfigured) return;

    let mounted = true;
    const handleSyncCompleted = async () => {
      if (mounted) {
        console.log('[MediaLibraryGrid] Media sync completed, refreshing synced URLs');
        await loadSyncedUrls();
      }
    };

    // 动态导入并注册监听器
    import('../../services/github-sync/media-sync-service').then(({ mediaSyncService }) => {
      mediaSyncService.addSyncCompletedListener(handleSyncCompleted);
    });

    return () => {
      mounted = false;
      // 清理监听器
      import('../../services/github-sync/media-sync-service').then(({ mediaSyncService }) => {
        mediaSyncService.removeSyncCompletedListener(handleSyncCompleted);
      });
    };
  }, [isConfigured, loadSyncedUrls]);

  // 计算各类型的数量
  const counts = useMemo(() => {
    return {
      all: assets.length,
      image: assets.filter(a => a.type === AssetType.IMAGE).length,
      video: assets.filter(a => a.type === AssetType.VIDEO).length,
      audio: assets.filter(a => a.type === AssetType.AUDIO).length,
      local: assets.filter(a => a.source === AssetSource.LOCAL).length,
      ai: assets.filter(a => a.source === AssetSource.AI_GENERATED).length,
      sourceAll: assets.length,
    };
  }, [assets]);

  // 获取选中的素材（用于移动端底部简介）
  const selectedAsset = useMemo(() => {
    if (!selectedAssetId) return null;
    return assets.find(a => a.id === selectedAssetId) || null;
  }, [assets, selectedAssetId]);

  // 监听网格尺寸变化并缓存
  useEffect(() => {
    localStorage.setItem(GRID_SIZE_STORAGE_KEY, gridSize.toString());
  }, [gridSize]);

  // 视图模式状态 - 使用两个状态实现平滑过渡，从 localStorage 恢复
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [pendingViewMode, setPendingViewMode] = useState<ViewMode>(getStoredViewMode);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPending, startTransition] = useTransition();
  const viewModeDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // 应用筛选和排序
  const filteredResult = useMemo(() => {
    const result = filterAssets(assets, filters);
    if (!selectedPlaylistId) {
      return result;
    }

    const playlistAssetIds = new Set(
      selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID
        ? assets.filter((asset) => asset.type === AssetType.AUDIO).map((asset) => asset.id)
        : getPlaylistAssetIds(selectedPlaylistId)
    );

    const playlistAssets = result.assets.filter((asset) => playlistAssetIds.has(asset.id));
    return {
      assets: playlistAssets,
      count: playlistAssets.length,
      isEmpty: playlistAssets.length === 0,
    };
  }, [assets, filters, selectedPlaylistId, getPlaylistAssetIds]);

  const currentPlaylistAssetIds = useMemo(
    () =>
      new Set(
        selectedPlaylistId && selectedPlaylistId !== AUDIO_PLAYLIST_ALL_ID
          ? getPlaylistAssetIds(selectedPlaylistId)
          : []
      ),
    [getPlaylistAssetIds, selectedPlaylistId]
  );

  const playlistAssetIdSets = useMemo(() => {
    const result = new Map<string, Set<string>>();
    Object.keys(playlistItems).forEach((playlistId) => {
      const items = playlistItems[playlistId] ?? [];
      result.set(
        playlistId,
        new Set(
          items
            .map((item) => item.assetId)
            .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0)
        )
      );
    });
    return result;
  }, [playlistItems]);

  const handleAssetDownload = useCallback(async (asset: Asset) => {
    await smartDownload([buildAssetDownloadItem(asset)]);
  }, []);

  const assetContextMenuItems = useMemo<ContextMenuEntry<Asset>[]>(() => [
    {
      key: 'open-player',
      label: '在音乐播放器中打开',
      icon: <Music size={14} />,
      onSelect: async (asset) => {
        const audioQueue = filteredResult.assets
          .filter((item) => item.type === AssetType.AUDIO)
          .map((item) => ({
            elementId: `asset:${item.id}`,
            audioUrl: item.url,
            title: item.name,
            duration: item.duration,
            previewImageUrl: item.thumbnail,
            clipId: item.clipId,
            providerTaskId: item.providerTaskId,
          }));
        const activePlaylist = selectedPlaylistId
          ? playlists.find((playlist) => playlist.id === selectedPlaylistId) || null
          : null;

        await openMusicPlayerToolAndPlay({
          source: {
            elementId: `asset:${asset.id}`,
            audioUrl: asset.url,
            title: asset.name,
            duration: asset.duration,
            previewImageUrl: asset.thumbnail,
            clipId: asset.clipId,
            providerTaskId: asset.providerTaskId,
          },
          queue: audioQueue,
          playlist:
            activePlaylist && selectedPlaylistId !== AUDIO_PLAYLIST_ALL_ID
              ? {
                  playlistId: activePlaylist.id,
                  playlistName: activePlaylist.name,
                }
              : undefined,
        });
      },
    },
    {
      key: 'favorite',
      label: (asset) => (favoriteAssetIds.has(asset.id) ? '取消收藏' : '加入收藏'),
      icon: <Heart size={14} />,
      onSelect: (asset) => {
        if (asset.type === AssetType.AUDIO) {
          void toggleFavorite(asset.id);
        }
      },
    },
    {
      key: 'playlist-actions',
      type: 'submenu',
      label: '添加到播放列表',
      icon: <ListMusic size={14} />,
      children: (asset) =>
        playlists.map((playlist) => {
          const exists = (playlistItems[playlist.id] || []).some(
            (item) => item.assetId === asset.id
          );
          return {
            key: `playlist-${playlist.id}`,
            label: exists ? `已在 ${playlist.name}` : `添加到 ${playlist.name}`,
            icon: <ListMusic size={14} />,
            disabled: exists,
            onSelect: () => {
              void addAssetToPlaylist(asset.id, playlist.id);
            },
          };
        }),
    },
    {
      key: 'remove-current',
      label: '从当前播放列表移除',
      icon: <XSquare size={14} />,
      danger: true,
      disabled: (asset) =>
        !selectedPlaylistId ||
        selectedPlaylistId === AUDIO_PLAYLIST_ALL_ID ||
        !currentPlaylistAssetIds.has(asset.id),
      onSelect: (asset) => {
        if (selectedPlaylistId && selectedPlaylistId !== AUDIO_PLAYLIST_ALL_ID) {
          void removeAssetFromPlaylist(asset.id, selectedPlaylistId);
        }
      },
    },
    {
      key: 'create-playlist',
      label: '新建播放列表并添加',
      icon: <Plus size={14} />,
      onSelect: (asset) => {
        setPlaylistNameInput('');
        setPlaylistDialog({ mode: 'create-and-add', targetAssetId: asset.id });
        closeAssetMenu();
      },
    },
  ], [
    addAssetToPlaylist,
    closeAssetMenu,
    currentPlaylistAssetIds,
    favoriteAssetIds,
    filteredResult.assets,
    playlists,
    playlistItems,
    removeAssetFromPlaylist,
    selectedPlaylistId,
    toggleFavorite,
  ]);

  // 视图模式切换处理 - 带防抖和过渡动画，并持久化到 localStorage
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    // 如果相同模式，不处理
    if (mode === viewMode) return;

    // 清除之前的防抖定时器
    if (viewModeDebounceRef.current) {
      clearTimeout(viewModeDebounceRef.current);
    }

    // 立即更新按钮状态
    setPendingViewMode(mode);

    // 根据模式自动调整滑块位置并同步缓存
    let newSize = gridSize;
    if (mode === 'grid') newSize = 180;
    else if (mode === 'compact') newSize = 80;
    
    setGridSize(newSize);
    localStorage.setItem(GRID_SIZE_STORAGE_KEY, newSize.toString());

    // 显示过渡状态
    setIsTransitioning(true);

    // 保存到 localStorage
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // localStorage 不可用时忽略
    }

    // 防抖处理实际的视图切换
    viewModeDebounceRef.current = setTimeout(() => {
      // 使用 startTransition 降低优先级，让 UI 保持响应
      startTransition(() => {
        setViewMode(mode);
        // 延迟关闭过渡状态，让动画完成
        setTimeout(() => {
          setIsTransitioning(false);
        }, 100);
      });
    }, VIEW_MODE_DEBOUNCE_MS);
  }, [gridSize, viewMode]);

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (viewModeDebounceRef.current) {
        clearTimeout(viewModeDebounceRef.current);
      }
    };
  }, []);

  const getSelectionScopeSnapshot = useCallback((): SelectionScopeSnapshot => {
    return {
      activeType:
        filters.activeType && filters.activeType !== 'ALL'
          ? (filters.activeType as AssetType)
          : undefined,
      activeSource:
        filters.activeSource && filters.activeSource !== 'ALL'
          ? (filters.activeSource as AssetSource)
          : undefined,
      searchQuery: filters.searchQuery.trim().toLowerCase(),
      playlistId: selectedPlaylistId || null,
    };
  }, [filters.activeSource, filters.activeType, filters.searchQuery, selectedPlaylistId]);

  const isAssetSelected = useCallback((asset: Asset): boolean => {
    if (selectionState.selectedIds.has(asset.id)) {
      return true;
    }

    return (
      matchesSelectionScope(asset, selectionState.scope, playlistAssetIdSets) &&
      !selectionState.deselectedIds.has(asset.id)
    );
  }, [playlistAssetIdSets, selectionState]);

  const filteredSelectedAssets = useMemo(() => {
    return filteredResult.assets.filter(isAssetSelected);
  }, [filteredResult.assets, isAssetSelected]);

  const filteredSelectedCount = filteredSelectedAssets.length;

  // 全选逻辑
  const isAllSelected = useMemo(() => {
    if (filteredResult.assets.length === 0) return false;
    return filteredSelectedCount === filteredResult.assets.length;
  }, [filteredResult.assets.length, filteredSelectedCount]);

  const isPartialSelected = useMemo(() => {
    if (filteredResult.assets.length === 0) return false;
    return filteredSelectedCount > 0 && filteredSelectedCount < filteredResult.assets.length;
  }, [filteredResult.assets.length, filteredSelectedCount]);

  const clearSelectionState = useCallback(() => {
    setSelectionState(createEmptySelectionState());
    lastSelectedIdRef.current = null;
  }, []);

  // 拖放事件处理
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0 && onFileUpload) {
        onFileUpload(files);
      }
    },
    [onFileUpload],
  );

  // 批量选择处理
  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => !prev);
    clearSelectionState();
  }, [clearSelectionState]);

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      clearSelectionState();
    } else {
      setSelectionState({
        scope: getSelectionScopeSnapshot(),
        selectedIds: new Set<string>(),
        deselectedIds: new Set<string>(),
      });
    }
  }, [clearSelectionState, getSelectionScopeSnapshot, isAllSelected]);

  const toggleAssetSelection = useCallback((assetId: string, event?: React.MouseEvent) => {
    const currentAsset = filteredResult.assets.find((asset) => asset.id === assetId);
    if (!currentAsset) {
      return;
    }

    // Shift 键连选逻辑
    if (event?.shiftKey && lastSelectedIdRef.current && lastSelectedIdRef.current !== assetId) {
      const lastIndex = filteredResult.assets.findIndex(a => a.id === lastSelectedIdRef.current);
      const currentIndex = filteredResult.assets.findIndex(a => a.id === assetId);
      
      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeAssets = filteredResult.assets.slice(start, end + 1);
        
        setSelectionState((prev) => {
          const nextSelectedIds = new Set(prev.selectedIds);
          const nextDeselectedIds = new Set(prev.deselectedIds);

          rangeAssets.forEach((asset) => {
            if (matchesSelectionScope(asset, prev.scope, playlistAssetIdSets)) {
              nextDeselectedIds.delete(asset.id);
            } else {
              nextSelectedIds.add(asset.id);
            }
          });

          return {
            ...prev,
            selectedIds: nextSelectedIds,
            deselectedIds: nextDeselectedIds,
          };
        });
        
        // 更新右侧面板显示最近点击的素材
        onSelectAsset(assetId);
        return;
      }
    }
    
    // 普通点击切换选中状态
    setSelectionState((prev) => {
      const nextSelectedIds = new Set(prev.selectedIds);
      const nextDeselectedIds = new Set(prev.deselectedIds);
      const selectedByScope = matchesSelectionScope(currentAsset, prev.scope, playlistAssetIdSets);
      const isSelected = nextSelectedIds.has(assetId) || (selectedByScope && !nextDeselectedIds.has(assetId));

      if (isSelected) {
        if (nextSelectedIds.has(assetId)) {
          nextSelectedIds.delete(assetId);
        } else if (selectedByScope) {
          nextDeselectedIds.add(assetId);
        }
      } else if (selectedByScope) {
        nextDeselectedIds.delete(assetId);
      } else {
        nextSelectedIds.add(assetId);
      }

      return {
        ...prev,
        selectedIds: nextSelectedIds,
        deselectedIds: nextDeselectedIds,
      };
    });
    
    // 记录本次选中的 ID
    lastSelectedIdRef.current = assetId;
    
    // 更新右侧面板显示最近点击的素材
    onSelectAsset(assetId);
  }, [filteredResult.assets, onSelectAsset, playlistAssetIdSets]);

  // 批量删除处理（同时删除画布上使用这些素材的元素）
  // 只删除当前筛选结果中被选中的素材
  const handleBatchDelete = useCallback(async () => {
    const idsToDelete = filteredSelectedAssets.map(a => a.id);
    
    if (idsToDelete.length === 0) return;
    
    try {
      // 删除画布上使用这些素材的元素
      if (board) {
        // 分离缓存类型素材和普通素材
        const cacheAssets = filteredSelectedAssets.filter(a => isCacheUrl(a.url));
        const normalAssetIds = idsToDelete.filter(
          id => !cacheAssets.some(a => a.id === id)
        );
        
        // 缓存类型素材使用 URL 匹配删除
        for (const asset of cacheAssets) {
          removeElementsByAssetUrls(board, asset.dedupeUrls || [asset.url]);
        }

        // 普通素材使用 ID 匹配删除
        if (normalAssetIds.length > 0) {
          const expandedIds = filteredSelectedAssets.flatMap(asset =>
            isCacheUrl(asset.url) ? [] : (asset.dedupeAssetIds || [asset.id])
          );
          removeElementsByAssetIds(board, expandedIds);
        }
      }
      
      // 然后删除素材本身
      await removeAssets(idsToDelete);
      clearSelectionState();
      setIsSelectionMode(false);
    } catch (error) {
      console.error('[MediaLibraryGrid] Batch delete failed:', error);
    }
  }, [board, clearSelectionState, filteredSelectedAssets, removeAssets]);

  // 计算批量删除时会影响的画布元素数量
  // 只计算当前筛选结果中被选中的素材
  const batchDeleteWarningInfo = useMemo(() => {
    if (!board || filteredSelectedAssets.length === 0) {
      return { hasCacheAssets: false, affectedCount: 0 };
    }
    
    let affectedCount = 0;
    const cacheAssets = filteredSelectedAssets.filter(a => isCacheUrl(a.url));
    
    for (const asset of cacheAssets) {
      affectedCount += countElementsByAssetUrls(board, asset.dedupeUrls || [asset.url]);
    }
    
    return { hasCacheAssets: cacheAssets.length > 0, affectedCount };
  }, [board, filteredSelectedAssets]);

  const handleBatchDeleteClick = useCallback(async () => {
    if (filteredSelectedCount === 0) {
      return;
    }

    const confirmed = await confirm({
      title: '确认批量删除',
      confirmText: '删除',
      cancelText: '取消',
      danger: true,
      children: (
        <>
          <p>确定要删除选中的 {filteredSelectedCount} 个素材吗？</p>
          {batchDeleteWarningInfo.hasCacheAssets &&
          batchDeleteWarningInfo.affectedCount > 0 ? (
            <p style={{ marginTop: '8px', color: 'var(--td-error-color)' }}>
              <span role="img" aria-label="注意">⚠️</span> 画布中有 <strong>{batchDeleteWarningInfo.affectedCount}</strong> 个元素正在使用这些素材，删除后将被一并移除！
            </p>
          ) : null}
        </>
      ),
    });

    if (confirmed) {
      await handleBatchDelete();
    }
  }, [batchDeleteWarningInfo, confirm, filteredSelectedCount, handleBatchDelete]);

  const handleDeletePlaylist = useCallback(async (playlist: AudioPlaylist) => {
    const confirmed = await confirm({
      title: '确认删除播放列表',
      description: `确定要删除播放列表「${playlist.name}」吗？删除后列表内关联关系将被移除，此操作不可撤销。`,
      confirmText: '删除',
      cancelText: '取消',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    await deletePlaylist(playlist.id);
  }, [confirm, deletePlaylist]);

  // 批量下载处理
  // 只下载当前筛选结果中被选中的素材
  const handleBatchDownload = useCallback(async () => {
    if (filteredSelectedAssets.length === 0 || isDownloading) return;
    
    setIsDownloading(true);
    setDownloadProgress(0);
    
    try {
      await smartDownload(
        buildAssetDownloadItems(filteredSelectedAssets),
        `素材_${new Date().toISOString().slice(0, 10)}.zip`,
        setDownloadProgress
      );
    } catch (error) {
      console.error('[MediaLibraryGrid] Download failed:', error);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  }, [filteredSelectedAssets, isDownloading]);

  // 批量同步处理（上传到云端）
  // 同步当前筛选结果中被选中的素材（AI 生成和本地上传）
  const handleBatchSync = useCallback(async () => {
    if (filteredSelectedAssets.length === 0 || isSyncing) return;
    
    // 收集所有可同步的媒体 URL（排除已同步的）
    const syncableUrls: string[] = [];
    
    // AI 生成素材：直接同步当前资产 URL（支持一个任务展开多条音频）
    filteredSelectedAssets
      .filter(a => a.source === AssetSource.AI_GENERATED)
      .forEach(a => {
        const syncStatus = mediaSyncService.getUrlSyncStatus(a.url);
        if (syncStatus !== 'synced') {
          syncableUrls.push(a.url);
        }
      });
    
    // 本地上传素材：获取缓存 URL（排除已同步）
    filteredSelectedAssets
      .filter(a => a.source === AssetSource.LOCAL && a.url.startsWith('/__aitu_cache__/'))
      .forEach(a => {
        const syncStatus = mediaSyncService.getUrlSyncStatus(a.url);
        if (syncStatus !== 'synced') {
          syncableUrls.push(a.url);
        }
      });
    
    if (syncableUrls.length === 0) {
      console.log('[MediaLibraryGrid] No syncable assets found');
      return;
    }
    
    setIsSyncing(true);
    setSyncProgress(0);
    
    try {
      const result = await mediaSyncService.syncSelectedMedia(
        syncableUrls,
        (current, total, url, status) => {
          setSyncProgress(Math.round((current / total) * 100));
        }
      );
      
      console.log('[MediaLibraryGrid] Batch sync result:', { 
        succeeded: result.succeeded, 
        failed: result.failed,
        skipped: result.skipped 
      });
      setSyncProgress(100);
      
      // 刷新同步状态（更新已同步 URL 列表）
      if (result.succeeded > 0) {
        await loadSyncedUrls();
      }
    } catch (error) {
      console.error('[MediaLibraryGrid] Batch sync failed:', error);
    } finally {
      setIsSyncing(false);
      setSyncProgress(0);
    }
  }, [filteredSelectedAssets, isSyncing, loadSyncedUrls]);
  
  // 计算选中的可同步素材数量（排除已同步的）
  const syncableCount = useMemo(() => {
    // AI 生成素材：直接按资产 URL 判断是否可同步
    const aiSyncable = filteredSelectedAssets.filter(a => {
      if (a.source !== AssetSource.AI_GENERATED) return false;
      const syncStatus = mediaSyncService.getUrlSyncStatus(a.url);
      return syncStatus !== 'synced';
    }).length;
    
    // 本地上传素材：检查是否有缓存 URL，且未同步
    const localSyncable = filteredSelectedAssets.filter(a => {
      if (a.source !== AssetSource.LOCAL) return false;
      // 只有在统一缓存中的本地素材才能同步
      if (!a.url.startsWith('/__aitu_cache__/')) return false;
      // 检查是否已同步
      const syncStatus = mediaSyncService.getUrlSyncStatus(a.url);
      return syncStatus !== 'synced';
    }).length;
    
    return aiSyncable + localSyncable;
  }, [filteredSelectedAssets]);

  const handleToggleFavorite = useCallback(async (asset: Asset) => {
    if (asset.type !== AssetType.AUDIO) return;
    await toggleFavorite(asset.id);
  }, [toggleFavorite]);

  const openAssetContextMenu = useCallback((asset: Asset, event: React.MouseEvent) => {
    if (asset.type !== AssetType.AUDIO) return;
    event.preventDefault();
    event.stopPropagation();
    openAssetMenu(event, asset);
  }, [openAssetMenu]);

  const handleSelectPlaylist = useCallback((playlistId: string | null) => {
    setSelectedPlaylistId(playlistId);
    if (playlistId) {
      setFilters({ activeType: AssetType.AUDIO });
    }
  }, [setFilters]);

  const openCreatePlaylistDialog = useCallback((mode: 'create' | 'create-and-add', targetAssetId?: string) => {
    setPlaylistNameInput('');
    setPlaylistDialog({ mode, targetAssetId });
    closeAssetMenu();
  }, [closeAssetMenu]);

  const openRenamePlaylistDialog = useCallback((playlist: AudioPlaylist) => {
    setPlaylistNameInput(playlist.name);
    setPlaylistDialog({ mode: 'rename', playlistId: playlist.id });
  }, []);

  const handleSubmitPlaylistDialog = useCallback(async () => {
    if (!playlistDialog) return;
    if (playlistDialog.mode === 'rename' && playlistDialog.playlistId) {
      await renamePlaylist(playlistDialog.playlistId, playlistNameInput);
    } else {
      const playlist = await createPlaylist(playlistNameInput);
      if (playlistDialog.mode === 'create-and-add' && playlistDialog.targetAssetId) {
        await addAssetToPlaylist(playlistDialog.targetAssetId, playlist.id);
      }
      handleSelectPlaylist(playlist.id);
    }
    setPlaylistDialog(null);
    setPlaylistNameInput('');
  }, [playlistDialog, renamePlaylist, playlistNameInput, createPlaylist, addAssetToPlaylist, handleSelectPlaylist]);

  // 将素材转换为预览项
  const convertToMediaItems = useCallback((assetList: Asset[]): UnifiedMediaItem[] => {
    return assetList.map(asset => ({
      id: asset.id,
      url: asset.type === AssetType.IMAGE ? normalizeImageDataUrl(asset.url) : asset.url,
      type: asset.type === AssetType.VIDEO ? 'video' : asset.type === AssetType.AUDIO ? 'audio' : 'image',
      title: asset.name,
      alt: asset.name,
      posterUrl: asset.thumbnail,
      prompt: asset.prompt,
      artist: asset.modelName,
      album: asset.type === AssetType.AUDIO ? 'Aitu Generated' : undefined,
    }));
  }, []);

  // 打开预览
  const handlePreview = useCallback((asset: Asset) => {
    const allMediaItems = convertToMediaItems(filteredResult.assets);
    const index = filteredResult.assets.findIndex(a => a.id === asset.id);
    setPreviewItems(allMediaItems);
    setPreviewInitialIndex(index >= 0 ? index : 0);
    setPreviewVisible(true);
  }, [filteredResult.assets, convertToMediaItems]);

  // 关闭预览
  const handlePreviewClose = useCallback(() => {
    setPreviewVisible(false);
  }, []);

  // 从预览器插入到画布
  const handleInsertFromViewer = useCallback(async (item: UnifiedMediaItem) => {
    // 优先使用外部回调（如果有）
    if (onDoubleClick) {
      const asset = filteredResult.assets.find(a => a.id === item.id);
      if (asset) {
        onDoubleClick(asset);
        return;
      }
    }
    
    // 直接插入到画布
    if (board) {
      try {
        if (item.type === 'video') {
          await insertVideoFromUrl(board, item.url);
        } else {
          await insertImageFromUrl(board, normalizeImageDataUrl(item.url));
        }
        // 插入成功后关闭预览
        setPreviewVisible(false);
      } catch (error) {
        console.error('Failed to insert media to canvas:', error);
      }
    }
  }, [filteredResult.assets, onDoubleClick, board]);

  // 处理图片编辑
  const handleEditImage = useCallback((item: UnifiedMediaItem) => {
    if (item.type !== 'image') return;
    setImageEditorUrl(item.url);
    setImageEditorVisible(true);
    setPreviewVisible(false); // 关闭预览
  }, []);

  // 编辑后插入画布
  const handleEditInsert = useCallback(async (editedImageUrl: string) => {
    if (!board) return;
    
    try {
      // 导入必要服务
      const { unifiedCacheService } = await import('../../services/unified-cache-service');
      
      const taskId = `edited-image-${Date.now()}`;
      const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
      
      // 将 data URL 转换为 Blob
      const response = await fetch(editedImageUrl);
      const blob = await response.blob();
      
      // 缓存到 Cache API
      await unifiedCacheService.cacheMediaFromBlob(stableUrl, blob, 'image', { taskId });
      
      // 插入到画布
      await insertImageFromUrl(board, stableUrl);
      
      // 关闭编辑器
      setImageEditorVisible(false);
      setImageEditorUrl('');
    } catch (error) {
      console.error('Failed to insert edited image:', error);
    }
  }, [board]);

  // 键盘事件处理（空格键/回车键预览选中的素材）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 只有在素材库容器获得焦点时才处理
      if (!gridContainerRef.current?.contains(document.activeElement)) return;
      
      // 如果正在编辑输入框，不处理
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      
      // 如果预览已打开，不处理（让 MediaViewer 处理）
      if (previewVisible) return;

      // 空格键或回车键预览选中的素材
      if ((e.key === ' ' || e.key === 'Enter') && selectedAssetId) {
        e.preventDefault();
        const asset = filteredResult.assets.find(a => a.id === selectedAssetId);
        if (asset) {
          handlePreview(asset);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAssetId, filteredResult.assets, handlePreview, previewVisible]);

  if (loading && assets.length === 0) {
    return (
      <div className="media-library-grid__loading">
        <Loading size="large" text="加载素材中..." />
      </div>
    );
  }

  return (
    <div
      ref={gridContainerRef}
      className={`media-library-grid ${isDragging ? 'media-library-grid--dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="media-library-grid"
    >
      <div className="media-library-grid__header">
        <div className="media-library-grid__header-top">
          <div className="media-library-grid__search">
            <Input
              value={filters.searchQuery}
              onChange={(value) => setFilters({ searchQuery: value as string })}
              placeholder="搜索素材..."
              prefixIcon={<Search size={16} />}
              clearable
              data-track="grid_search_input"
            />
          </div>
          <div className="media-library-grid__header-right">
            <ViewModeToggle viewMode={pendingViewMode} onViewModeChange={handleViewModeChange} />
            {isSelectionMode ? (
              <>
                <Button
                  variant="base"
                  theme="danger"
                  size="small"
                  icon={<Trash2 size={16} />}
                  disabled={filteredSelectedCount === 0}
                  onClick={() => {
                    void handleBatchDeleteClick();
                  }}
                  data-track="grid_batch_delete"
                >
                  删除
                </Button>
                <Button
                  variant="outline"
                  size="small"
                  icon={<XSquare size={16} />}
                  onClick={toggleSelectionMode}
                  data-track="grid_cancel_selection"
                >
                  取消
                </Button>
                <Button
                  variant="base"
                  theme="primary"
                  size="small"
                  icon={<Download size={16} />}
                  disabled={filteredSelectedCount === 0 || isDownloading}
                  loading={isDownloading}
                  onClick={handleBatchDownload}
                  data-track="grid_batch_download"
                >
                  下载
                </Button>
                {isConfigured && (
                  <Tooltip content="同步选中的素材到云端" placement="bottom" theme="light">
                    <Button
                      variant="outline"
                      size="small"
                      icon={<CloudUpload size={16} />}
                      disabled={syncableCount === 0 || isSyncing}
                      loading={isSyncing}
                      onClick={handleBatchSync}
                      data-track="grid_batch_sync"
                    >
                      {isSyncing ? `${syncProgress}%` : `同步 (${syncableCount})`}
                    </Button>
                  </Tooltip>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="small"
                  icon={<CheckSquare size={16} />}
                  onClick={toggleSelectionMode}
                  data-track="grid_toggle_selection_mode"
                >
                  批量选择
                </Button>
                <Button
                  variant="base"
                  theme="primary"
                  size="small"
                  icon={<ImageUploadIconComp size={16} />}
                  onClick={onUploadClick}
                  data-track="grid_upload_click"
                >
                  上传
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="media-library-grid__header-bottom">
          {/* 选择模式：全选和计数 */}
          {isSelectionMode && (
            <div
              className="media-library-grid__selection-info"
              onClick={toggleSelectAll}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleSelectAll();
                }
              }}
            >
              <Checkbox
                checked={isAllSelected}
                indeterminate={isPartialSelected}
                data-track="grid_select_all"
              />
              <span className="media-library-grid__selection-count">
                {filteredSelectedCount}
              </span>
            </div>
          )}

          <div className="media-library-grid__filter-island">
            <div className="media-library-grid__filter-group">
              {TYPE_OPTIONS.map(opt => {
                  const count = opt.value === 'ALL' ? counts.all : opt.value === AssetType.IMAGE ? counts.image : opt.value === AssetType.AUDIO ? counts.audio : counts.video;
                  const Icon = opt.icon;
                  const isActive = (filters.activeType || 'ALL') === opt.value;
                  return (
                    <Tooltip key={opt.value} content={`${opt.label} (${count})`} placement="top" theme="light" showArrow={false}>
                      <div
                        className={`media-library-grid__filter-option ${isActive ? 'media-library-grid__filter-option--active' : ''}`}
                        onClick={() => setFilters({ activeType: opt.value === 'ALL' ? undefined : opt.value as AssetType })}
                      >
                        <Icon size={14} strokeWidth={1.5} className={opt.value === 'ALL' ? 'icon-all' : ''} />
                        <span className="media-library-grid__filter-count">{count}</span>
                      </div>
                    </Tooltip>
                  );
                })}
                
                {SOURCE_OPTIONS.filter(opt => opt.value !== 'ALL').map(opt => {
                  const count = counts[opt.countKey as keyof typeof counts];
                  const Icon = opt.icon;
                  const isActive = filters.activeSource === opt.value;
                  return (
                    <Tooltip key={opt.value} content={`${opt.label} (${count})`} placement="top" theme="light" showArrow={false}>
                      <div
                        className={`media-library-grid__filter-option ${isActive ? 'media-library-grid__filter-option--active' : ''}`}
                        onClick={() => setFilters({ activeSource: isActive ? undefined : opt.value as AssetSource })}
                      >
                        <Icon size={14} strokeWidth={1.5} />
                        <span className="media-library-grid__filter-count">{count}</span>
                      </div>
                    </Tooltip>
                  );
                })}
            </div>
          </div>

          <div className="media-library-grid__header-spacer" />

          <div className="media-library-grid__sort-options">
              {SORT_GROUPS.map(group => {
                const currentSort = filters.sortBy || 'DATE_DESC';
                const isAsc = currentSort === group.options.asc;
                const isDesc = currentSort === group.options.desc;
                const isActive = isAsc || isDesc;
                const Icon = isAsc ? group.icons.asc : group.icons.desc;
                
                const handleSortClick = () => {
                  if (currentSort === group.options.asc) {
                    // 当前是正序 -> 切换到逆序
                    setFilters({ sortBy: group.options.desc });
                  } else if (currentSort === group.options.desc) {
                    // 当前是逆序
                    if (currentSort === 'DATE_DESC' && group.id === 'DATE') {
                      // 如果当前已经是默认的日期逆序，点一下进入日期正序
                      setFilters({ sortBy: 'DATE_ASC' });
                    } else {
                      // 否则恢复默认排序 (DATE_DESC)
                      setFilters({ sortBy: 'DATE_DESC' });
                    }
                  } else {
                    // 当前不在该组 -> 切换到正序
                    setFilters({ sortBy: group.options.asc });
                  }
                };

                return (
          <Tooltip
            key={group.id} 
            content={`${group.label}: ${isAsc ? '正序' : (isDesc ? '逆序' : '默认')}`} 
            placement="top" 
            theme="light" 
            showArrow={false}
          >
                    <div
                      className={`media-library-grid__filter-option ${isActive ? 'media-library-grid__filter-option--active' : ''}`}
                      onClick={handleSortClick}
                    >
                      <Icon size={14} strokeWidth={1.5} />
                    </div>
                  </Tooltip>
                );
            })}
          </div>
        </div>

        {(!filters.activeType || filters.activeType === AssetType.AUDIO) && (
          <AudioPlaylistTabs
            className="media-library-grid__playlist-bar"
            selectedPlaylistId={selectedPlaylistId || AUDIO_PLAYLIST_ALL_ID}
            allCount={counts.audio}
            playlists={playlists}
            playlistItems={playlistItems}
            onSelect={handleSelectPlaylist}
            onCreate={() => openCreatePlaylistDialog('create')}
            onRename={openRenamePlaylistDialog}
            onDelete={(playlist) => void handleDeletePlaylist(playlist)}
          />
        )}

        {/* 下载进度条 */}
        {isDownloading && (
          <div className="media-library-grid__progress">
            <div className="media-library-grid__progress-bar">
              <div 
                className="media-library-grid__progress-fill"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <span className="media-library-grid__progress-text">
              {downloadProgress < 50 ? '下载中' : '压缩中'} {downloadProgress}%
            </span>
          </div>
        )}
      </div>

      {isDragging && (
        <div className="media-library-grid__drop-overlay">
          <div className="media-library-grid__drop-message">
            <div className="media-library-grid__drop-message-icon">
              <ImageUploadIconComp size={32} />
            </div>
            <h3 className="media-library-grid__drop-message-title">拖放文件到这里</h3>
            <p className="media-library-grid__drop-message-description">支持 JPG、PNG、MP4 格式</p>
          </div>
        </div>
      )}

      {filteredResult.isEmpty ? (
        <MediaLibraryEmpty />
      ) : (
        <>
          {/* 虚拟滚动网格 - 只渲染可见区域的元素 */}
          <div className={`media-library-grid__container ${isTransitioning || isPending ? 'media-library-grid__container--transitioning' : ''}`}>
            <VirtualAssetGrid
              assets={filteredResult.assets}
              viewMode={viewMode}
              gridSize={gridSize}
              selectedAssetId={selectedAssetId ?? undefined}
              isAssetSelected={isAssetSelected}
              isSelectionMode={isSelectionMode}
              onSelectAsset={isSelectionMode ? toggleAssetSelection : onSelectAsset}
              onDoubleClick={onDoubleClick}
              onPreview={handlePreview}
              onContextMenu={openAssetContextMenu}
              isFavorite={isFavorite}
              onToggleFavorite={handleToggleFavorite}
              syncedUrls={syncedUrls}
            />
          </div>

          {/* 移动端：选中素材时显示简介和操作 */}
          {isMobile && selectedAsset && !isSelectionMode && (
            <div className="media-library-grid__mobile-inspector">
              <div className="media-library-grid__mobile-inspector-info">
                <div className="media-library-grid__mobile-inspector-type">
                  {selectedAsset.type === AssetType.IMAGE ? <ImageIcon size={14} /> : selectedAsset.type === AssetType.AUDIO ? <Music size={14} /> : <VideoIcon size={14} />}
                  <span>{selectedAsset.type === AssetType.IMAGE ? '图片' : selectedAsset.type === AssetType.AUDIO ? '音频' : '视频'}</span>
                  {selectedAsset.source === AssetSource.AI_GENERATED && (
                    <span className="media-library-grid__mobile-inspector-ai">AI</span>
                  )}
                </div>
                <div className="media-library-grid__mobile-inspector-name" title={selectedAsset.name}>
                  {selectedAsset.name}
                </div>
              </div>
              <div className="media-library-grid__mobile-inspector-actions">
                <Tooltip content="预览" theme="light">
                  <button
                    className="media-library-grid__mobile-inspector-btn"
                    onClick={() => handlePreview(selectedAsset)}
                    data-track="mobile_preview"
                  >
                    <Eye size={18} />
                  </button>
                </Tooltip>
                {onDoubleClick && (
                  <Tooltip content="插入画布" theme="light">
                    <button
                      className="media-library-grid__mobile-inspector-btn media-library-grid__mobile-inspector-btn--primary"
                      onClick={() => onDoubleClick(selectedAsset)}
                      data-track="mobile_insert"
                    >
                      <PlusCircle size={18} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="下载" theme="light">
                  <button
                    className="media-library-grid__mobile-inspector-btn"
                    onClick={() => {
                      void handleAssetDownload(selectedAsset);
                    }}
                    data-track="mobile_download"
                  >
                    <Download size={18} />
                  </button>
                </Tooltip>
              </div>
            </div>
          )}

          {/* 底部工具栏（始终显示） */}
          <div className="media-library-grid__footer">
            <div className="media-library-grid__footer-left">
              {storageStatus ? (
                <div className="media-library-grid__footer-storage">
                  <HardDrive size={14} />
                  <span>已用 {formatFileSize(storageStatus.quota.usage)}</span>
                </div>
              ) : (
                <div className="media-library-grid__footer-storage">
                  <HardDrive size={14} />
                  <span>正在获取存储状态...</span>
                </div>
              )}
              <span className="media-library-grid__footer-count">共 {filteredResult.count} 个素材</span>
              {!isSelectionMode && <span className="media-library-grid__footer-hint">双击预览</span>}
            </div>
            
            <div className="media-library-grid__footer-right">
              {viewMode !== 'list' && (
                <div className="media-library-grid__zoom-control">
                  <Minus size={14} onClick={() => setGridSize(prev => Math.max(80, prev - 20))} />
                  <input
                    type="range"
                    min="80"
                    max="300"
                    step="10"
                    value={gridSize}
                    onChange={(e) => setGridSize(Number(e.target.value))}
                    className="media-library-grid__zoom-slider"
                    data-track="grid_zoom_slider"
                  />
                  <Plus size={14} onClick={() => setGridSize(prev => Math.min(300, prev + 20))} />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 媒体预览器 */}
      <UnifiedMediaViewer
        visible={previewVisible}
        items={previewItems}
        initialIndex={previewInitialIndex}
        onClose={handlePreviewClose}
        showThumbnails={true}
        onInsertToCanvas={board ? handleInsertFromViewer : undefined}
        onEdit={handleEditImage}
      />

      {/* 图片编辑器 - 素材库场景只支持插入画布和下载 */}
      {imageEditorVisible && imageEditorUrl && (
        <ImageEditor
          visible={imageEditorVisible}
          imageUrl={imageEditorUrl}
          showOverwrite={false}
          onClose={() => {
            setImageEditorVisible(false);
            setImageEditorUrl('');
          }}
          onInsert={board ? handleEditInsert : undefined}
        />
      )}

      <ContextMenu
        state={assetContextMenu}
        items={assetContextMenuItems}
        onClose={closeAssetMenu}
      />

      <Dialog
        visible={!!playlistDialog}
        header={playlistDialog?.mode === 'rename' ? '重命名播放列表' : '新建播放列表'}
        onClose={() => setPlaylistDialog(null)}
        onConfirm={() => void handleSubmitPlaylistDialog()}
        confirmBtn="确定"
        cancelBtn="取消"
      >
        <Input
          value={playlistNameInput}
          onChange={(value) => setPlaylistNameInput(String(value))}
          placeholder="请输入播放列表名称"
          autofocus
        />
      </Dialog>
      {confirmDialog}
    </div>
  );
}
