/**
 * Download Utilities
 *
 * Centralized download logic for images, videos, and other media files
 * Supports single file download and batch download as ZIP
 */

import JSZip from 'jszip';
import {
  sanitizeFilename,
  isVolcesDomain,
  getFileExtension,
  downloadFromBlob,
  downloadFile,
  openInNewTab,
  processBatchWithConcurrency,
  normalizeImageDataUrl,
} from '@aitu/utils';

/**
 * Download a media file with auto-generated filename from prompt
 * For Volces (火山引擎) domains that don't support CORS, opens in new tab instead
 *
 * @param url - The URL of the media file
 * @param prompt - The prompt text to use for filename
 * @param format - File extension (e.g., 'png', 'mp4', 'webp')
 * @param fallbackName - Fallback name if prompt is empty
 * @returns Promise that resolves when download is complete, or object with opened flag for new tab
 */
export async function downloadMediaFile(
  url: string,
  prompt: string,
  format: string,
  fallbackName: string = 'media'
): Promise<{ opened: boolean } | void> {
  const normalizedUrl = normalizeImageDataUrl(url);

  // For Volces domains (火山引擎), open in new tab due to CORS restrictions
  if (isVolcesDomain(normalizedUrl)) {
    openInNewTab(normalizedUrl);
    return { opened: true };
  }

  const sanitizedPrompt = sanitizeFilename(prompt);
  const filename = `${sanitizedPrompt || fallbackName}.${format}`;
  return downloadFile(normalizedUrl, filename);
}

/**
 * 批量下载项接口
 */
export interface BatchDownloadItem {
  /** 文件 URL */
  url: string;
  /** 文件类型 */
  type: 'image' | 'video';
  /** 可选文件名 */
  filename?: string;
}

/**
 * 批量下载为 ZIP 文件
 * 使用并发限制避免同时发起过多网络请求
 *
 * @param items - 下载项数组
 * @param zipFilename - 可选的 ZIP 文件名
 * @returns Promise
 */
export async function downloadAsZip(items: BatchDownloadItem[], zipFilename?: string): Promise<void> {
  if (items.length === 0) {
    throw new Error('No files to download');
  }

  const zip = new JSZip();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const finalZipName = zipFilename || `aitu_download_${timestamp}.zip`;

  // 添加文件到 ZIP 根目录（限制并发数为 3）
  await processBatchWithConcurrency(
    items,
    async (item, index) => {
      try {
        const assetUrl =
          item.type === 'image' ? normalizeImageDataUrl(item.url) : item.url;
        const response = await fetch(assetUrl, { referrerPolicy: 'no-referrer' });
        if (!response.ok) {
          console.warn(`Failed to fetch ${assetUrl}: ${response.status}`);
          return;
        }
        const blob = await response.blob();
        const ext = getFileExtension(assetUrl, blob.type);

        const prefix = item.type === 'image' ? 'image' : 'video';
        const filename = item.filename || `${prefix}_${index + 1}.${ext}`;

        zip.file(filename, blob);
      } catch (error) {
        console.error(`Failed to add file to zip:`, error);
      }
    },
    3 // 并发限制为 3
  );

  // 生成 ZIP 并下载
  const content = await zip.generateAsync({ type: 'blob' });
  downloadFromBlob(content, finalZipName);
}

/**
 * 智能下载：单个直接下载，多个打包为 ZIP
 *
 * @param items - 下载项数组
 * @param zipFilename - 可选的 ZIP 文件名（仅在多文件时使用）
 * @returns Promise
 */
export async function smartDownload(items: BatchDownloadItem[], zipFilename?: string): Promise<void> {
  if (items.length === 0) {
    throw new Error('No files to download');
  }

  if (items.length === 1) {
    const item = items[0];
    const assetUrl = item.type === 'image' ? normalizeImageDataUrl(item.url) : item.url;
    // Use getFileExtension to detect correct extension (handles SVG, PNG, etc.)
    const ext = getFileExtension(assetUrl) || (item.type === 'image' ? 'png' : 'mp4');
    const filename = item.filename || `${item.type}_download.${ext}`;
    await downloadFile(assetUrl, filename);
  } else {
    await downloadAsZip(items, zipFilename);
  }
}
