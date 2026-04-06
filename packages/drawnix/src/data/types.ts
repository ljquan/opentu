import { PlaitElement, Viewport } from '@plait/core';

/**
 * 嵌入式媒体数据
 * 用于保存文件时将虚拟 URL 对应的媒体数据内嵌到文件中
 * 确保文件在其他设备上也能正常显示
 */
export interface EmbeddedMediaItem {
  /** 虚拟 URL（如 /__aitu_cache__/image/xxx.jpg 或 /asset-library/xxx） */
  url: string;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** MIME 类型 */
  mimeType: string;
  /** Base64 编码的媒体数据（不含 data: 前缀） */
  data: string;
  /** 首次缓存/创建时间 */
  cachedAt?: number;
  /** 最近访问/更新时间 */
  lastUsed?: number;
  /** 原始任务 ID，便于二次导出时复原真实时间 */
  taskId?: string;
}

export interface DrawnixExportedData {
  type: DrawnixExportedType.drawnix;
  version: number;
  source: 'web';
  elements: PlaitElement[];
  viewport: Viewport;
  /** 嵌入式媒体数据（可选，用于跨设备分享） */
  embeddedMedia?: EmbeddedMediaItem[];
}

export enum DrawnixExportedType {
    drawnix = 'drawnix'
}
