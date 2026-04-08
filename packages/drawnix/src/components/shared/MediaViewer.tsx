/**
 * MediaViewer Component (Legacy Wrapper)
 *
 * 此文件现在是对 UnifiedMediaViewer 的向后兼容 wrapper。
 * 新代码应直接使用 UnifiedMediaViewer。
 *
 * @deprecated 请使用 UnifiedMediaViewer 代替
 */

import React from 'react';
import { UnifiedMediaViewer, type MediaItem as UnifiedMediaItem } from './media-preview';

export interface MediaItem {
  /** 媒体 URL */
  url: string;
  /** 媒体类型 */
  type: 'image' | 'video' | 'audio';
  /** 可选的标题 */
  title?: string;
  /** 可选的描述 */
  alt?: string;
  /** 音频/视频封面 */
  posterUrl?: string;
  /** 媒体时长（秒） */
  duration?: number;
  /** 生成提示词 */
  prompt?: string;
  /** 音频风格标签 */
  tags?: string;
  /** 下载时显示的演唱者/作者 */
  artist?: string;
  /** 下载时显示的专辑 */
  album?: string;
}

export interface MediaViewerProps {
  /** 是否显示 */
  visible: boolean;
  /** 媒体列表 */
  items: MediaItem[];
  /** 初始索引（从 0 开始） */
  initialIndex?: number;
  /** 关闭回调 */
  onClose: () => void;
  /** 索引变化回调 */
  onIndexChange?: (index: number) => void;
  /** 是否显示工具栏（仅图片） */
  showToolbar?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 是否显示标题 */
  showTitle?: boolean;
  /** 视频是否自动播放 */
  videoAutoPlay?: boolean;
  /** 视频是否循环播放 */
  videoLoop?: boolean;
}

/**
 * 统一的媒体预览组件 - 向后兼容 wrapper
 * @deprecated 请使用 UnifiedMediaViewer 代替
 */
export const MediaViewer: React.FC<MediaViewerProps> = ({
  visible,
  items,
  initialIndex = 0,
  onClose,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onIndexChange,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showToolbar = true,
  className = '',
  showTitle = true,
  videoAutoPlay = true,
  videoLoop = true,
}) => {
  // 转换为新的 MediaItem 类型
  const convertedItems: UnifiedMediaItem[] = items.map((item, index) => ({
    id: `media-${index}`,
    url: item.url,
    type: item.type,
    title: item.title,
    alt: item.alt,
    posterUrl: item.posterUrl,
    duration: item.duration,
    prompt: item.prompt,
    tags: item.tags,
    artist: item.artist,
    album: item.album,
  }));

  return (
    <UnifiedMediaViewer
      visible={visible}
      items={convertedItems}
      initialMode="single"
      initialIndex={initialIndex}
      onClose={onClose}
      showThumbnails={items.length > 1}
      className={className}
      showTitle={showTitle}
      videoAutoPlay={videoAutoPlay}
      videoLoop={videoLoop}
    />
  );
};

export default MediaViewer;
