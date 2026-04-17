/**
 * Asset Context
 * 素材Context - 状态管理
 *
 * 素材库数据来源：
 * 1. 本地上传的素材：存储在 IndexedDB (aitu-assets) 中
 * 2. AI 生成的素材：直接从任务队列获取已完成的任务
 * 3. 缓存中的素材：从 drawnix-unified-cache 获取，去重后合并展示
 */

import {
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
  useEffect,
} from 'react';
import { MessagePlugin } from 'tdesign-react';
import { assetStorageService } from '../services/asset-storage-service';
import { taskQueueService } from '../services/task-queue';
import { taskStorageReader } from '../services/task-storage-reader';
import {
  unifiedCacheService,
  type CachedMedia,
} from '../services/unified-cache-service';
import { getStorageStatus } from '../utils/storage-quota';
import { getAssetSizeFromCache } from '../hooks/useAssetSize';
import type {
  Asset,
  AssetContextValue,
  AssetType,
  AssetSource,
  FilterState,
  StorageStatus,
} from '../types/asset.types';
import { AssetType as AssetTypeEnum, AssetSource as AssetSourceEnum, DEFAULT_FILTER_STATE } from '../types/asset.types';
import { TaskStatus, TaskType } from '../types/task.types';
import { AssetContext } from './asset-context-instance';
import { audioPlaylistService } from '../services/audio-playlist-service';
import { setGlobalAssetMap } from '../stores/asset-map-store';
import {
  getAssetContentHash,
  getLocalAssetGroupKey,
  normalizeAssetUrl,
} from '../utils/asset-dedupe';
import {
  isAIGeneratedAudioUrl,
  isAssetLibraryUrl,
  isLegacyCacheUrl,
} from '../utils/virtual-media-url';


/**
 * Asset Provider Props
 */
interface AssetProviderProps {
  children: ReactNode;
}

function getLocalDedupeKey(asset: Asset): string | undefined {
  return getLocalAssetGroupKey(asset) || undefined;
}

function isUnifiedCacheAsset(asset: Asset): boolean {
  return asset.id.startsWith('unified-cache-');
}

interface CacheAssetTaskContext {
  completedTaskIds: Set<string>;
  completedTaskUrls: Set<string>;
}

interface CacheAssetLoadResult {
  assets: Asset[];
  metadataByNormalizedUrl: Map<string, CachedMedia>;
}

function isPlaybackCachePollution(
  item: Pick<CachedMedia, 'metadata'>,
  filename: string,
  isAudio: boolean
): boolean {
  if (!isAudio) {
    return false;
  }

  if (item.metadata?.source === 'PLAYBACK_CACHE') {
    return true;
  }

  return !item.metadata?.name && /^asset:[0-9a-f-]+\.(mp3|wav|ogg|aac|flac|m4a|webm)$/i.test(filename);
}

function hasAIGeneratedCacheMetadata(item: {
  metadata?: {
    taskId?: string;
    prompt?: string;
    model?: string;
    params?: unknown;
    source?: string;
  };
}): boolean {
  if (item.metadata?.source === AssetSourceEnum.AI_GENERATED) {
    return true;
  }

  return Boolean(
    item.metadata?.taskId &&
    (item.metadata.prompt || item.metadata.model || item.metadata.params)
  );
}

function getNormalizedClipId(asset: Pick<Asset, 'clipId'>): string | undefined {
  const clipId = typeof asset.clipId === 'string' ? asset.clipId.trim() : '';
  return clipId || undefined;
}

function getAudioAssetIdentityKeys(asset: Pick<Asset, 'clipId' | 'contentHash' | 'url'>): string[] {
  const keys: string[] = [];
  const clipId = getNormalizedClipId(asset);
  const contentHash = getAssetContentHash(asset);
  const normalizedUrl = normalizeAssetUrl(asset.url);

  if (clipId) {
    keys.push(`clip:${clipId}`);
  }
  if (contentHash) {
    keys.push(`hash:${contentHash}`);
  }
  if (normalizedUrl) {
    keys.push(`url:${normalizedUrl}`);
  }

  return keys.length > 0 ? keys : [`url:${asset.url}`];
}

function getAudioAssetRepresentativeScore(asset: Asset): number {
  let score = 0;

  if (asset.source === AssetSourceEnum.AI_GENERATED) score += 50;
  if (!isUnifiedCacheAsset(asset)) score += 100;
  if (asset.thumbnail) score += 20;
  if (typeof asset.duration === 'number' && Number.isFinite(asset.duration) && asset.duration > 0) score += 10;
  if (asset.clipId) score += 8;
  if (asset.contentHash) score += 4;
  if (asset.providerTaskId) score += 2;

  return score;
}

function mergeAudioAssetMetadata(preferred: Asset, fallback: Asset): Asset {
  const mergedUrls = new Set([
    ...(preferred.dedupeUrls || []),
    ...(fallback.dedupeUrls || []),
    normalizeAssetUrl(preferred.url),
    normalizeAssetUrl(fallback.url),
  ]);
  const mergedAssetIds = new Set([
    ...(preferred.dedupeAssetIds || []),
    ...(fallback.dedupeAssetIds || []),
    ...(isUnifiedCacheAsset(preferred) ? [] : [preferred.id]),
    ...(isUnifiedCacheAsset(fallback) ? [] : [fallback.id]),
  ]);

  return {
    ...fallback,
    ...preferred,
    id: preferred.id,
    url: preferred.url,
    name: preferred.name || fallback.name,
    mimeType: preferred.mimeType || fallback.mimeType,
    createdAt: Math.max(preferred.createdAt, fallback.createdAt),
    size: preferred.size || fallback.size,
    contentHash: getAssetContentHash(preferred) || getAssetContentHash(fallback),
    thumbnail: preferred.thumbnail || fallback.thumbnail,
    duration: preferred.duration ?? fallback.duration,
    taskId: preferred.taskId || fallback.taskId,
    providerTaskId:
      preferred.providerTaskId ||
      fallback.providerTaskId ||
      preferred.taskId ||
      fallback.taskId,
    clipId: preferred.clipId || fallback.clipId,
    prompt: preferred.prompt || fallback.prompt,
    modelName: preferred.modelName || fallback.modelName,
    dedupeUrls: Array.from(mergedUrls),
    dedupeAssetIds: Array.from(mergedAssetIds),
  };
}

function combineAudioAssets(existing: Asset, candidate: Asset): Asset {
  const existingScore = getAudioAssetRepresentativeScore(existing);
  const candidateScore = getAudioAssetRepresentativeScore(candidate);

  if (candidateScore > existingScore) {
    return mergeAudioAssetMetadata(candidate, existing);
  }
  if (candidateScore < existingScore) {
    return mergeAudioAssetMetadata(existing, candidate);
  }
  if (candidate.createdAt > existing.createdAt) {
    return mergeAudioAssetMetadata(candidate, existing);
  }
  return mergeAudioAssetMetadata(existing, candidate);
}

function mergeAIGeneratedAudioAssets(assets: Asset[]): Asset[] {
  const groups: Array<{
    representative: Asset;
    members: Asset[];
    keys: Set<string>;
  }> = [];

  for (const asset of assets) {
    const identityKeys = getAudioAssetIdentityKeys(asset);
    const matchedIndexes = groups
      .map((group, index) => (
        identityKeys.some((key) => group.keys.has(key)) ? index : -1
      ))
      .filter((index) => index >= 0);

    if (matchedIndexes.length === 0) {
      groups.push({
        representative: asset,
        members: [asset],
        keys: new Set(identityKeys),
      });
      continue;
    }

    const primaryGroup = groups[matchedIndexes[0]];
    primaryGroup.representative = combineAudioAssets(primaryGroup.representative, asset);
    primaryGroup.members.push(asset);
    identityKeys.forEach((key) => primaryGroup.keys.add(key));

    const secondaryIndexes = matchedIndexes.slice(1).sort((left, right) => right - left);
    for (const index of secondaryIndexes) {
      const [mergedGroup] = groups.splice(index, 1);
      if (!mergedGroup) {
        continue;
      }
      primaryGroup.representative = combineAudioAssets(
        primaryGroup.representative,
        mergedGroup.representative
      );
      mergedGroup.members.forEach((member) => primaryGroup.members.push(member));
      mergedGroup.keys.forEach((key) => primaryGroup.keys.add(key));
    }
  }

  return groups.map((group) => group.representative);
}

function mergeLocalAssets(assets: Asset[]): Asset[] {
  const grouped = new Map<string, Asset>();

  for (const asset of assets) {
    const groupKey = getLocalDedupeKey(asset);
    if (!groupKey) {
      grouped.set(`${asset.id}:${asset.url}`, {
        ...asset,
        dedupeAssetIds: isUnifiedCacheAsset(asset) ? [] : [asset.id],
        dedupeUrls: [normalizeAssetUrl(asset.url)],
      });
      continue;
    }

    const normalizedUrl = normalizeAssetUrl(asset.url);
    const existing = grouped.get(groupKey);
    const candidateAssetIds = isUnifiedCacheAsset(asset) ? [] : [asset.id];

    if (!existing) {
      grouped.set(groupKey, {
        ...asset,
        contentHash: getAssetContentHash(asset),
        dedupeAssetIds: candidateAssetIds,
        dedupeUrls: [normalizedUrl],
      });
      continue;
    }

    const mergedAssetIds = new Set([...(existing.dedupeAssetIds || []), ...candidateAssetIds]);
    const mergedUrls = new Set([...(existing.dedupeUrls || []), normalizedUrl]);
    const shouldReplaceRepresentative =
      (isUnifiedCacheAsset(existing) && !isUnifiedCacheAsset(asset)) ||
      (isUnifiedCacheAsset(existing) === isUnifiedCacheAsset(asset) && asset.createdAt > existing.createdAt);

    const representative = shouldReplaceRepresentative ? asset : existing;
    const fallbackName = representative.name || existing.name || asset.name;

    grouped.set(groupKey, {
      ...representative,
      name: fallbackName,
      size: representative.size || existing.size || asset.size,
      contentHash: getAssetContentHash(representative) || existing.contentHash || getAssetContentHash(asset),
      createdAt: Math.max(existing.createdAt, asset.createdAt),
      thumbnail: representative.thumbnail || existing.thumbnail || asset.thumbnail,
      dedupeAssetIds: Array.from(mergedAssetIds),
      dedupeUrls: Array.from(mergedUrls),
    });
  }

  return Array.from(grouped.values());
}

function mergeVisibleAsset(prevAssets: Asset[], nextAsset: Asset): Asset[] {
  const localKey = getLocalDedupeKey(nextAsset);
  const remainingAssets = prevAssets.filter((asset) => {
    if (asset.id === nextAsset.id) {
      return false;
    }
    if (!localKey) {
      return true;
    }
    return getLocalDedupeKey(asset) !== localKey;
  });

  const mergedAsset = localKey
    ? mergeLocalAssets([nextAsset, ...prevAssets.filter(asset => getLocalDedupeKey(asset) === localKey)])[0]
    : nextAsset;

  return [mergedAsset, ...remainingAssets].sort((a, b) => b.createdAt - a.createdAt);
}

function getLocalCleanupTargets(asset: Asset): { assetIds: string[]; urls: string[]; dedupeKey?: string } {
  const dedupeKey = getLocalDedupeKey(asset);
  const urls = Array.from(new Set((asset.dedupeUrls || [asset.url]).map(normalizeAssetUrl)));
  const assetIds = Array.from(new Set(asset.dedupeAssetIds || (isUnifiedCacheAsset(asset) ? [] : [asset.id])));
  return { assetIds, urls, dedupeKey };
}

/**
 * Asset Provider Component
 * 素材Provider组件
 */
export function AssetProvider({ children }: AssetProviderProps) {
  // 核心数据
  const [assets, setAssets] = useState<Asset[]>([]);

  // UI状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 筛选和排序
  const [filters, setFiltersState] = useState<FilterState>(DEFAULT_FILTER_STATE);

  // 选择
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  // 存储状态
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);

  // 同步状态 - 已同步到 Gist 的 URL 集合
  const [syncedUrls, setSyncedUrls] = useState<Set<string>>(new Set());

  // ref 供初始化 effect 延迟调用 loadAssets
  const loadAssetsRef = useRef<(() => void) | null>(null);

  /**
   * Initialize service on mount
   * 组件挂载时初始化服务
   */
  useEffect(() => {
    const initService = async () => {
      try {
        await assetStorageService.initialize();
        await audioPlaylistService.initialize();
        // 初始化完成后自动加载资产到 global store，供画布卡片等脱离 Context 的组件使用
        loadAssetsRef.current?.();
      } catch (err) {
        console.error('Failed to initialize asset storage service:', err);
        const error = err as Error;
        setError(error.message);
      }
    };

    initService();

    // Cleanup on unmount
    return () => {
      assetStorageService.cleanup();
    };
  }, []);

  /**
   * Convert completed task to Asset
   * 将已完成的任务转换为素材
   */
  const taskToAssets = useCallback((task: {
    id: string;
    type: TaskType;
    result: {
      url: string;
      urls?: string[];
      format?: string;
      size?: number;
      duration?: number;
      previewImageUrl?: string;
      title?: string;
      providerTaskId?: string;
      primaryClipId?: string;
      clipIds?: string[];
      clips?: Array<{
        id?: string;
        clipId?: string;
        title?: string;
        audioUrl: string;
        imageUrl?: string;
        imageLargeUrl?: string;
        duration?: number | null;
      }>;
    };
    params: { prompt?: string; model?: string; title?: string };
    completedAt?: number;
    createdAt: number;
    remoteId?: string;
  }): Asset[] => {
    const assetType = task.type === TaskType.IMAGE
      ? AssetTypeEnum.IMAGE
      : task.type === TaskType.AUDIO
      ? AssetTypeEnum.AUDIO
      : AssetTypeEnum.VIDEO;

    const mimeType = task.type === TaskType.AUDIO
      ? 'audio/mpeg'
      : task.result.format === 'mp4'
      ? 'video/mp4'
      : task.result.format === 'webm'
      ? 'video/webm'
      : `image/${task.result.format || 'png'}`;

    if (task.type === TaskType.AUDIO) {
      const clipAssets = (task.result.clips || [])
        .map((clip, index): Asset | null => {
          const audioUrl =
            typeof clip.audioUrl === 'string' && clip.audioUrl.trim()
              ? clip.audioUrl
              : task.result.urls?.[index];
          if (!audioUrl) {
            return null;
          }

          const fallbackBaseName =
            task.result.title ||
            task.params.title ||
            task.params.prompt?.substring(0, 30) ||
            'AI音频';
          const clipKey = clip.clipId || clip.id || String(index);
          const clipDuration =
            typeof clip.duration === 'number' ? clip.duration : task.result.duration;

          return {
            id: `${task.id}::${clipKey}`,
            taskId: task.id,
            type: AssetTypeEnum.AUDIO,
            source: AssetSourceEnum.AI_GENERATED,
            url: audioUrl,
            name:
              clip.title ||
              ((task.result.clips?.length || task.result.urls?.length || 0) > 1
                ? `${fallbackBaseName} ${index + 1}`
                : fallbackBaseName),
            mimeType,
            createdAt: task.completedAt || task.createdAt,
            size: task.result.size,
            prompt: task.params.prompt,
            modelName: task.params.model,
            duration: clipDuration,
            clipId: clip.clipId || clip.id,
            providerTaskId: task.result.providerTaskId || task.remoteId || task.id,
            thumbnail:
              clip.imageLargeUrl ||
              clip.imageUrl ||
              task.result.previewImageUrl,
          };
        })
        .filter((asset): asset is Asset => asset !== null);

      if (clipAssets.length > 0) {
        return clipAssets;
      }
    }

    const name = task.type === TaskType.AUDIO
      ? (task.result.title || task.params.title || task.params.prompt?.substring(0, 30) || 'AI音频')
      : (task.params.prompt?.substring(0, 30) || 'AI生成');

    return [{
      id: task.id,
      taskId: task.id,
      type: assetType,
      source: AssetSourceEnum.AI_GENERATED,
      url: task.result.url,
      name,
      mimeType,
      createdAt: task.completedAt || task.createdAt,
      size: task.result.size,
      prompt: task.params.prompt,
      modelName: task.params.model,
      duration:
        task.type === TaskType.AUDIO ? task.result.duration : undefined,
      providerTaskId:
        task.type === TaskType.AUDIO
          ? task.result.providerTaskId || task.remoteId || task.id
          : undefined,
      clipId:
        task.type === TaskType.AUDIO
          ? task.result.primaryClipId || task.result.clipIds?.[0]
          : undefined,
      ...(task.result.previewImageUrl && { thumbnail: task.result.previewImageUrl }),
    }];
  }, []);

  /**
   * 从 IndexedDB 获取本地缓存的媒体资源
   * 优化：不再逐个访问 Cache Storage，直接使用 IndexedDB 元数据
   * 这大幅提升了素材库的加载速度
   */
  const getAssetsFromCacheStorage = useCallback(async (
    taskContext?: CacheAssetTaskContext
  ): Promise<CacheAssetLoadResult> => {
    try {
      // 直接从 IndexedDB 获取所有缓存媒体的元数据
      // 这比遍历 Cache Storage 快得多
      const cachedMediaList = await unifiedCacheService.getAllCachedMedia();

      const assets: Asset[] = [];
      const metadataByNormalizedUrl = new Map<string, CachedMedia>();
      
      for (const item of cachedMediaList) {
        // 统一使用 pathname
        const pathname = item.url.startsWith('/') ? item.url : (() => {
          try {
            return new URL(item.url).pathname;
          } catch {
            return item.url;
          }
        })();
        
        const isAituCache = isLegacyCacheUrl(pathname);
        const isAssetLibrary = isAssetLibraryUrl(pathname);
        const isAIGeneratedAudio = isAIGeneratedAudioUrl(pathname);
        
        if (!isAituCache && !isAssetLibrary && !isAIGeneratedAudio) continue;

        const normalizedPathname = normalizeAssetUrl(pathname);
        metadataByNormalizedUrl.set(normalizedPathname, item);
        const isDuplicatedByCompletedTask = Boolean(
          taskContext &&
          (
            taskContext.completedTaskUrls.has(normalizedPathname) ||
            (item.metadata?.taskId && taskContext.completedTaskIds.has(item.metadata.taskId))
          )
        );

        if (isDuplicatedByCompletedTask) continue;

        const filename = pathname.split('/').pop() || '';

        // 跳过辅助缓存条目（如音频封面图 *-cover.png / *-cover_1.jpg）
        if (/-cover(?:_\d+)?\.\w+$/i.test(filename)) continue;

        const isVideo = item.type === 'video' ||
                        pathname.includes('/video/') ||
                        /\.(mp4|webm|mov)$/i.test(pathname);
        const isAudio = item.type === 'audio' ||
                        isAIGeneratedAudio ||
                        pathname.startsWith('/__aitu_cache__/audio/') ||
                        /\.(mp3|wav|ogg|aac|flac)$/i.test(pathname);

        if (isPlaybackCachePollution(item, filename, isAudio)) continue;

        const assetSource =
          isAIGeneratedAudio || hasAIGeneratedCacheMetadata(item)
            ? AssetSourceEnum.AI_GENERATED
            : AssetSourceEnum.LOCAL;

        const assetType = isAudio ? AssetTypeEnum.AUDIO
          : isVideo ? AssetTypeEnum.VIDEO
          : AssetTypeEnum.IMAGE;

        // 音频素材：尝试查找对应的封面图缓存
        let thumbnail: string | undefined;
        if (isAudio && item.metadata?.taskId) {
          const coverUrl = `/__aitu_cache__/image/${item.metadata.taskId}-cover.png`;
          const hasCover = cachedMediaList.some(m => {
            const mPath = m.url.startsWith('/') ? m.url : (() => { try { return new URL(m.url).pathname; } catch { return m.url; } })();
            return mPath === coverUrl;
          });
          if (hasCover) thumbnail = coverUrl;
        }

        assets.push({
          id: `unified-cache-${filename}`,
          type: assetType,
          source: assetSource,
          url: normalizedPathname,
          name: item.metadata?.name || filename,
          mimeType: item.mimeType,
          createdAt: item.cachedAt,
          size: item.size,
          contentHash: item.contentHash || getAssetContentHash({ url: normalizedPathname }),
          taskId: item.metadata?.taskId,
          providerTaskId:
            typeof item.metadata?.providerTaskId === 'string'
              ? item.metadata.providerTaskId
              : item.metadata?.taskId,
          clipId:
            typeof item.metadata?.clipId === 'string'
              ? item.metadata.clipId
              : undefined,
          duration:
            typeof item.metadata?.duration === 'number'
              ? item.metadata.duration
              : undefined,
          ...(thumbnail && { thumbnail }),
        });
      }
      
      return {
        assets,
        metadataByNormalizedUrl,
      };
    } catch (error) {
      console.error('[AssetContext] Failed to get assets from IndexedDB:', error);
      return {
        assets: [],
        metadataByNormalizedUrl: new Map(),
      };
    }
  }, []);

  /**
   * Load Assets
   * 加载所有素材
   * 合并本地上传的素材、任务队列中已完成的 AI 生成任务、以及 Cache Storage 中的媒体
   */
  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. 加载本地上传的素材（只包含 LOCAL 来源）
      const localAssets = await assetStorageService.getAllAssets();

      // 2. 从任务队列获取已完成的 AI 生成任务
      // 统一从 IndexedDB 直接读取，SW 模式和降级模式使用同一个数据库
      const completedTasks = await taskStorageReader.getAllTasks({ status: TaskStatus.COMPLETED });
      const preliminaryAiAssets = completedTasks
        .filter((task): task is typeof task & { result: NonNullable<typeof task.result> } =>
          (task.type === TaskType.IMAGE || task.type === TaskType.VIDEO || task.type === TaskType.AUDIO) &&
          !!task.result?.url
        )
        .flatMap(taskToAssets);
      const completedTaskIds = new Set(completedTasks.map(task => task.id));
      const aiAssetUrls = new Set(preliminaryAiAssets.map(asset => normalizeAssetUrl(asset.url)));

      // 3. 从 Cache Storage 获取媒体（优先级最低，用于补充）
      const {
        assets: cacheStorageAssets,
        metadataByNormalizedUrl,
      } = await getAssetsFromCacheStorage({
        completedTaskIds,
        completedTaskUrls: aiAssetUrls,
      });
      const aiAssets = preliminaryAiAssets.map((asset) => {
        const cachedMetadata = metadataByNormalizedUrl.get(normalizeAssetUrl(asset.url));
        const cachedDuration =
          typeof cachedMetadata?.metadata?.duration === 'number'
            ? cachedMetadata.metadata.duration
            : undefined;
        const cachedClipId =
          typeof cachedMetadata?.metadata?.clipId === 'string'
            ? cachedMetadata.metadata.clipId
            : undefined;
        const cachedProviderTaskId =
          typeof cachedMetadata?.metadata?.providerTaskId === 'string'
            ? cachedMetadata.metadata.providerTaskId
            : cachedMetadata?.metadata?.taskId;

        return {
          ...asset,
          contentHash:
            getAssetContentHash(asset) || cachedMetadata?.contentHash,
          duration: asset.duration ?? cachedDuration,
          clipId: asset.clipId || cachedClipId,
          providerTaskId: asset.providerTaskId || cachedProviderTaskId,
          taskId: asset.taskId || cachedMetadata?.metadata?.taskId,
        };
      });
      const localCacheAssets = cacheStorageAssets.filter(
        asset => asset.source === AssetSourceEnum.LOCAL
      );
      const generatedCacheAssets = cacheStorageAssets.filter(
        asset => asset.source === AssetSourceEnum.AI_GENERATED
      );

      // 4. 本地来源按内容去重；AI 结果保持独立
      const groupedLocalAssets = mergeLocalAssets([
        ...localAssets,
        ...localCacheAssets,
      ]);
      const supplementalGeneratedAssets = generatedCacheAssets.filter(
        (asset) => asset.type === AssetTypeEnum.AUDIO || !aiAssetUrls.has(normalizeAssetUrl(asset.url))
      );
      const aiAudioAssets = aiAssets.filter((asset) => asset.type === AssetTypeEnum.AUDIO);
      const generatedAudioAssets = supplementalGeneratedAssets.filter(
        (asset) => asset.type === AssetTypeEnum.AUDIO
      );
      const mergedAIAudioAssets = mergeAIGeneratedAudioAssets([
        ...aiAudioAssets,
        ...generatedAudioAssets,
      ]);
      const nonAudioGeneratedAssets = supplementalGeneratedAssets.filter(
        (asset) => asset.type !== AssetTypeEnum.AUDIO
      );
      const nonAudioAiAssets = aiAssets.filter(
        (asset) => asset.type !== AssetTypeEnum.AUDIO
      );

      // 5. 合并所有来源，按创建时间倒序排列
      const allAssets = [
        ...groupedLocalAssets,
        ...nonAudioGeneratedAssets,
        ...nonAudioAiAssets,
        ...mergedAIAudioAssets,
      ].sort(
        (a, b) => b.createdAt - a.createdAt
      );

      setAssets(allAssets);

      // 7. 延迟异步填充缺失的文件大小（不阻塞加载）
      // 使用 requestIdleCallback 在浏览器空闲时执行
      const fillMissingSizes = () => {
        const assetsNeedingSize = allAssets.filter(a => !a.size || a.size === 0);
        if (assetsNeedingSize.length === 0) return;

        // 分批获取，每批最多 10 个，避免一次性发起太多请求
        const batchSize = 10;
        let currentIndex = 0;

        const processBatch = async () => {
          const batch = assetsNeedingSize.slice(currentIndex, currentIndex + batchSize);
          if (batch.length === 0) return;

          const sizePromises = batch.map(async (asset) => {
            const size = await getAssetSizeFromCache(asset.url);
            return { id: asset.id, size };
          });

          const sizeResults = await Promise.all(sizePromises);
          const sizeMap = new Map(
            sizeResults
              .filter(r => r.size !== null && r.size > 0)
              .map(r => [r.id, r.size as number])
          );

          if (sizeMap.size > 0) {
            setAssets(prev =>
              prev.map(asset =>
                sizeMap.has(asset.id)
                  ? { ...asset, size: sizeMap.get(asset.id) }
                  : asset
              )
            );
          }

          currentIndex += batchSize;
          if (currentIndex < assetsNeedingSize.length) {
            // 继续处理下一批
            if ('requestIdleCallback' in window) {
              (window as Window).requestIdleCallback(processBatch);
            } else {
              setTimeout(processBatch, 50);
            }
          }
        };

        // 启动第一批
        if ('requestIdleCallback' in window) {
          (window as Window).requestIdleCallback(processBatch);
        } else {
          setTimeout(processBatch, 100);
        }
      };

      // 使用 requestIdleCallback 延迟执行，不阻塞加载
      if ('requestIdleCallback' in window) {
        (window as Window).requestIdleCallback(fillMissingSizes, { timeout: 3000 });
      } else {
        setTimeout(fillMissingSizes, 200);
      }
    } catch (err: unknown) {
      console.error('Failed to load assets:', err);
      setError(err instanceof Error ? err.message : String(err));
      MessagePlugin.error({
        content: '加载素材失败，请刷新页面重试',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, [taskToAssets, getAssetsFromCacheStorage]);

  // 供初始化 effect 延迟调用
  loadAssetsRef.current = loadAssets;

  /**
   * Check Storage Quota
   * 检查存储配额
   */
  const checkStorageQuota = useCallback(async () => {
    try {
      const status = await getStorageStatus();
      setStorageStatus(status);

      // 如果接近限制，显示警告
      if (status.isCritical) {
        MessagePlugin.warning({
          content: `本地存储空间已使用 ${status.quota.percentUsed.toFixed(1)}%，即将达到上限。请删除一些旧素材。`,
          duration: 5000,
        });
      } else if (status.isNearLimit) {
        MessagePlugin.info({
          content: `本地存储空间已使用 ${status.quota.percentUsed.toFixed(1)}%，接近上限。`,
          duration: 3000,
        });
      }
    } catch (err: unknown) {
      console.error('Failed to check storage quota:', err);
    }
  }, []);

  /**
   * Add Asset
   * 添加新素材
   */
  const addAsset = useCallback(
    async (
      file: File | Blob,
      type: AssetType,
      source: AssetSource,
      name?: string,
    ): Promise<Asset> => {
      // console.log('[AssetContext] addAsset called with:', {
      //   fileName: file instanceof File ? file.name : 'Blob',
      //   type,
      //   source,
      //   name,
      //   fileSize: file.size,
      //   fileType: file.type,
      // });

      setLoading(true);
      setError(null);

      try {
        // 生成默认名称
        const assetName =
          name ||
          (file instanceof File ? file.name : `asset-${Date.now()}`);

        const mimeType =
          file instanceof File ? file.type : (file.type || 'application/octet-stream');

        // console.log('[AssetContext] Calling assetStorageService.addAsset...');
        const asset = await assetStorageService.addAsset({
          type,
          source,
          name: assetName,
          blob: file,
          mimeType,
        });

        // console.log('[AssetContext] Asset added to storage:', asset);

        // 更新状态
        setAssets((prev) => mergeVisibleAsset(prev, asset));
        // console.log('[AssetContext] Assets state updated');

        // 检查存储配额
        // console.log('[AssetContext] Checking storage quota...');
        await checkStorageQuota();

        MessagePlugin.success({
          content: '素材添加成功',
          duration: 2000,
        });

        // console.log('[AssetContext] addAsset completed successfully');
        return asset;
      } catch (err: unknown) {
        console.error('[AssetContext] Failed to add asset:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error.message);

        if (error.name === 'QuotaExceededError') {
          MessagePlugin.error({
            content: '本地存储空间不足，请删除一些旧素材',
            duration: 5000,
          });
        } else if (error.name === 'ValidationError') {
          MessagePlugin.error({
            content: error.message,
            duration: 3000,
          });
        } else {
          MessagePlugin.error({
            content: '添加素材失败',
            duration: 3000,
          });
        }

        throw err;
      } finally {
        setLoading(false);
      }
    },
    [checkStorageQuota],
  );

  /**
   * Remove Asset
   * 删除素材
   * 本地素材：从 IndexedDB 删除
   * AI 生成素材：从任务队列删除
   * 缓存素材：从 unified-cache 删除
   */
  const removeAsset = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const asset = assets.find(a => a.id === id);
      const cleanupTargets = asset ? getLocalCleanupTargets(asset) : null;

      if (id.startsWith('unified-cache-')) {
        if (cleanupTargets) {
          await Promise.all(cleanupTargets.urls.map((url) => unifiedCacheService.deleteCache(url)));
        }
      } else if (asset?.source === AssetSourceEnum.AI_GENERATED) {
        // AI 生成的素材：删除任务 + 清理缓存
        taskQueueService.deleteTask(asset.taskId || id);
        if (asset.url) {
          await unifiedCacheService.deleteCache(asset.url).catch((e) => {
            console.debug('[AssetContext] AI asset cache delete skipped:', e);
          });
        }
      } else {
        if (cleanupTargets) {
          await Promise.all(cleanupTargets.assetIds.map((assetId) => assetStorageService.removeAsset(assetId)));
          const storedAssetUrls = new Set(
            assets
              .filter(existingAsset => cleanupTargets.assetIds.includes(existingAsset.id))
              .map(existingAsset => normalizeAssetUrl(existingAsset.url))
          );
          const cacheOnlyUrls = cleanupTargets.urls.filter((url) => !storedAssetUrls.has(normalizeAssetUrl(url)));
          await Promise.all(cacheOnlyUrls.map((url) => unifiedCacheService.deleteCache(url).catch((e) => {
            console.debug('[AssetContext] Local cache delete skipped:', e);
          })));
        } else {
          await assetStorageService.removeAsset(id);
        }
      }

      await audioPlaylistService.removeAssetFromAllPlaylists(id).catch((playlistError) => {
        console.error('[AssetContext] Failed to remove asset from playlists:', playlistError);
      });

      // 更新状态
      setAssets((prev) => prev.filter((a) =>
        cleanupTargets?.dedupeKey
          ? getLocalDedupeKey(a) !== cleanupTargets.dedupeKey
          : a.id !== id
      ));

      // 如果删除的是当前选中的素材，清除选中状态
      setSelectedAssetId((prev) => (prev === id ? null : prev));

      // 检查存储配额
      await checkStorageQuota();

      MessagePlugin.success({
        content: '素材删除成功',
        duration: 2000,
      });
    } catch (err) {
      console.error('Failed to remove asset:', err);
      const error = err as Error;
      setError(error.message);

      if (error.name === 'NotFoundError') {
        MessagePlugin.warning({
          content: '素材未找到，可能已被删除',
          duration: 3000,
        });
      } else {
        MessagePlugin.error({
          content: '删除素材失败',
          duration: 3000,
        });
      }

      throw err;
    } finally {
      setLoading(false);
    }
  }, [assets, checkStorageQuota]);

  /**
   * Remove Multiple Assets (Batch Delete)
   * 批量删除素材 - 区分本地素材、AI 生成素材和缓存素材
   */
  const removeAssets = useCallback(async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    const requestedCount = ids.length;

    setLoading(true);
    setError(null);

    try {
      const successIds: string[] = [];
      const errors: { id: string; error: Error }[] = [];

      // 区分本地素材、AI 生成素材和缓存素材
      const localIds: string[] = [];
      const aiIds: string[] = [];
      const cacheIds: string[] = [];
      const localUrlSet = new Set<string>();
      const localDedupeKeys = new Set<string>();

      for (const id of ids) {
        const asset = assets.find(a => a.id === id);
        if (asset?.source === AssetSourceEnum.AI_GENERATED) {
          aiIds.push(id);
          continue;
        }

        if (asset) {
          const cleanupTargets = getLocalCleanupTargets(asset);
          cleanupTargets.assetIds.forEach(assetId => localIds.push(assetId));
          cleanupTargets.urls.forEach(url => localUrlSet.add(normalizeAssetUrl(url)));
          if (cleanupTargets.dedupeKey) {
            localDedupeKeys.add(cleanupTargets.dedupeKey);
          }
          if (id.startsWith('unified-cache-')) {
            cacheIds.push(id);
          }
          continue;
        }

        if (id.startsWith('unified-cache-')) {
          cacheIds.push(id);
        } else {
          localIds.push(id);
        }
      }

      // 删除缓存素材：使用素材的实际 URL
      for (const id of cacheIds) {
        try {
          const asset = assets.find(a => a.id === id);
          if (asset) {
            const cleanupTargets = getLocalCleanupTargets(asset);
            await Promise.all(cleanupTargets.urls.map((url) => unifiedCacheService.deleteCache(url)));
          }
          await audioPlaylistService.removeAssetFromAllPlaylists(id);
          successIds.push(id);
        } catch (err) {
          console.error(`Failed to remove cache asset ${id}:`, err);
          errors.push({ id, error: err as Error });
        }
      }

      // 删除 AI 生成的素材：删除任务 + 清理缓存
      for (const id of aiIds) {
        try {
          const asset = assets.find(a => a.id === id);
          taskQueueService.deleteTask(asset?.taskId || id);
          if (asset?.url) {
            await unifiedCacheService.deleteCache(asset.url).catch((e) => {
              console.debug('[AssetContext] AI asset cache delete skipped:', e);
            });
          }
          await audioPlaylistService.removeAssetFromAllPlaylists(id);
          successIds.push(id);
        } catch (err) {
          console.error(`Failed to remove AI asset ${id}:`, err);
          errors.push({ id, error: err as Error });
        }
      }

      // 并行删除本地素材
      const uniqueLocalIds = Array.from(new Set(localIds));

      if (uniqueLocalIds.length > 0) {
        const deleteResults = await Promise.allSettled(
          uniqueLocalIds.map(id => assetStorageService.removeAsset(id))
        );

        deleteResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            successIds.push(uniqueLocalIds[index]);
          } else {
            console.error(`Failed to remove asset ${uniqueLocalIds[index]}:`, result.reason);
            errors.push({ id: uniqueLocalIds[index], error: result.reason as Error });
          }
        });

        const storedAssetUrls = new Set(
          assets
            .filter(asset => uniqueLocalIds.includes(asset.id))
            .map(asset => normalizeAssetUrl(asset.url))
        );

        await Promise.all(Array.from(localUrlSet)
          .filter((url) => !storedAssetUrls.has(normalizeAssetUrl(url)))
          .map((url) =>
          unifiedCacheService.deleteCache(url).catch((e) => {
            console.debug('[AssetContext] Batch local cache delete skipped:', e);
          })
        ));

        await Promise.all(
          uniqueLocalIds
            .filter((id) => successIds.includes(id))
            .map((id) =>
              audioPlaylistService.removeAssetFromAllPlaylists(id).catch((playlistError) => {
                console.error('[AssetContext] Failed to remove asset from playlists:', playlistError);
              })
            )
        );
      }

      // 更新状态 - 只移除成功删除的素材
      setAssets((prev) => prev.filter((asset) => {
        if (successIds.includes(asset.id)) {
          return false;
        }
        const dedupeKey = getLocalDedupeKey(asset);
        return dedupeKey ? !localDedupeKeys.has(dedupeKey) : true;
      }));

      // 如果删除的包含当前选中的素材,清除选中状态
      if (selectedAssetId && successIds.includes(selectedAssetId)) {
        setSelectedAssetId(null);
      }

      // 检查存储配额
      await checkStorageQuota();

      // 显示结果消息
      if (errors.length === 0) {
        MessagePlugin.success({
          content: `成功删除 ${requestedCount} 个素材`,
          duration: 2000,
        });
      } else {
        MessagePlugin.warning({
          content: `已处理 ${requestedCount} 个素材，存在 ${errors.length} 个删除失败`,
          duration: 3000,
        });
      }
    } catch (err) {
      console.error('Batch remove assets error:', err);
      const error = err as Error;
      setError(error.message);
      MessagePlugin.error({
        content: '批量删除失败',
        duration: 3000,
      });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [assets, selectedAssetId, checkStorageQuota]);

  /**
   * Rename Asset
   * 重命名素材
   * 支持两种来源的素材：
   * - unified-cache-* ID：使用 unifiedCacheService 更新元数据
   * - 其他 ID：使用 assetStorageService 更新
   */
  const renameAsset = useCallback(
    async (id: string, newName: string): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        // 根据 ID 前缀判断使用哪个服务
        if (id.startsWith('unified-cache-')) {
          // 从 unified-cache 获取的素材
          const asset = assets.find(a => a.id === id);
          if (asset) {
            const success = await unifiedCacheService.updateCachedMedia(asset.url, {
              metadata: { name: newName }
            });
            if (!success) {
              throw new Error('更新缓存元数据失败');
            }
          }
        } else {
          // 从 assetStorageService 获取的素材
          await assetStorageService.renameAsset(id, newName);
        }

        // 更新状态
        setAssets((prev) =>
          prev.map((asset) =>
            asset.id === id ? { ...asset, name: newName } : asset,
          ),
        );

        MessagePlugin.success({
          content: '重命名成功',
          duration: 2000,
        });
      } catch (err: unknown) {
        console.error('Failed to rename asset:', err);
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error.message);

        if (error.name === 'NotFoundError') {
          MessagePlugin.warning({
            content: '素材未找到，可能已被删除',
            duration: 3000,
          });
        } else if (error.name === 'ValidationError') {
          MessagePlugin.error({
            content: error.message,
            duration: 3000,
          });
        } else {
          MessagePlugin.error({
            content: '重命名失败',
            duration: 3000,
          });
        }

        throw err;
      } finally {
        setLoading(false);
      }
    },
    [assets],
  );

  /**
   * Set Filters
   * 设置筛选条件
   */
  const setFilters = useCallback((newFilters: Partial<FilterState>) => {
    setFiltersState((prev) => ({
      ...prev,
      ...newFilters,
    }));
  }, []);

  /**
   * Load Synced URLs
   * 从远程加载已同步的 URL 集合
   */
  const loadSyncedUrls = useCallback(async () => {
    try {
      const { mediaSyncService } = await import('../services/github-sync/media-sync-service');
      const urls = await mediaSyncService.getRemoteSyncedUrls();
      setSyncedUrls(urls);
      console.log('[AssetContext] Loaded synced URLs:', urls.size);
    } catch (error) {
      console.warn('[AssetContext] Failed to load synced URLs:', error);
      // 不设置错误状态，同步状态加载失败不影响主功能
    }
  }, []);

  // 同步 assets 到模块级 store，供 CardElement 等脱离 Context 的组件使用
  useEffect(() => {
    setGlobalAssetMap(new Map(assets.map((a) => [a.id, a])));
  }, [assets]);

  // Context value
  const value = useMemo<AssetContextValue>(
    () => ({
      // State
      assets,
      loading,
      error,
      filters,
      selectedAssetId,
      storageStatus,
      syncedUrls,

      // Actions
      loadAssets,
      addAsset,
      removeAsset,
      removeAssets,
      renameAsset,
      setFilters,
      setSelectedAssetId,
      checkStorageQuota,
      loadSyncedUrls,
    }),
    [
      assets,
      loading,
      error,
      filters,
      selectedAssetId,
      storageStatus,
      syncedUrls,
      loadAssets,
      addAsset,
      removeAsset,
      removeAssets,
      renameAsset,
      setFilters,
      checkStorageQuota,
      loadSyncedUrls,
    ],
  );

  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>;
}

/**
 * Use Assets Hook
 * 使用素材Context的Hook
 */
export function useAssets(): AssetContextValue {
  const context = useContext(AssetContext);

  if (!context) {
    throw new Error('useAssets must be used within AssetProvider');
  }

  return context;
}
