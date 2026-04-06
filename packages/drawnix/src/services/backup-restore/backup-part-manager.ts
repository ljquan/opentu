/**
 * Backup Part Manager
 * 管理备份分片逻辑，从 sw-debug 的 JS 版移植为 TypeScript
 */

import JSZip from 'jszip';
import { BACKUP_SIGNATURE, BACKUP_VERSION, BackupManifest, ExportResult } from './types';

/** 分片阈值：500MB 未压缩大小 */
export const PART_SIZE_THRESHOLD = 500 * 1024 * 1024;

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 避免浏览器在多文件下载时过早释放 URL 导致丢包
  await new Promise(resolve => setTimeout(resolve, 1200));
  URL.revokeObjectURL(url);
}

/**
 * BackupPartManager - 管理备份分片
 * Part1 延迟下载：保留在内存中直到确定是否需要拆分
 */
export class BackupPartManager {
  private baseFilename: string;
  private backupId: string;
  private partIndex = 1;
  private currentZip: JSZip;
  private currentSize = 0;
  private downloadedParts: Array<{ filename: string; size: number }> = [];
  private part1Zip: JSZip;

  constructor(baseFilename: string, backupId: string) {
    this.baseFilename = baseFilename;
    this.backupId = backupId;
    this.currentZip = new JSZip();
    this.part1Zip = this.currentZip;
  }

  /** 添加文件到当前 ZIP（非素材，不触发分片） */
  addFile(path: string, content: string | object): void {
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    this.currentZip.file(path, data);
    this.currentSize += new Blob([data]).size;
  }

  private normalizeEntryDate(timestamp?: number): Date {
    if (!timestamp || Number.isNaN(timestamp) || timestamp <= 0) {
      return new Date();
    }
    // 兼容秒级时间戳输入
    const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  /** 添加素材 blob，超阈值时自动 finalize 当前分片 */
  async addAssetBlob(
    path: string,
    blob: Blob,
    metaPath: string,
    metaContent: string | object,
    createdAt?: number
  ): Promise<void> {
    const metaStr = typeof metaContent === 'string' ? metaContent : JSON.stringify(metaContent, null, 2);
    const newSize = blob.size + new Blob([metaStr]).size;
    const entryDate = this.normalizeEntryDate(createdAt);

    if (this.currentSize + newSize > PART_SIZE_THRESHOLD && this.currentSize > 0) {
      await this.finalizePart();
      this.startNewPart();
    }

    const assetsFolder = this.currentZip.folder('assets')!;
    assetsFolder.file(metaPath, metaStr, { date: entryDate });
    assetsFolder.file(path, blob, { date: entryDate });
    this.currentSize += newSize;
  }

  /** finalize 当前分片并下载（Part1 延迟下载，其他分片立即下载） */
  private async finalizePart(): Promise<void> {
    const partManifest = {
      signature: BACKUP_SIGNATURE,
      version: BACKUP_VERSION,
      createdAt: Date.now(),
      source: 'app',
      backupId: this.backupId,
      partIndex: this.partIndex,
      totalParts: null,
      isFinalPart: false,
      includes: { prompts: false, projects: false, assets: true, knowledgeBase: false },
    };
    
    // 对于所有分片都生成manifest，但Part1延迟下载
    const zipToUse = this.partIndex === 1 ? this.part1Zip : this.currentZip;
    zipToUse.file('manifest.json', JSON.stringify(partManifest, null, 2));

    // 只有非Part1分片立即下载
    if (this.partIndex === 1) return;

    const blob = await this.currentZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const filename = `${this.baseFilename}_part${this.partIndex}.zip`;
    if (this.downloadedParts.length > 0) {
      await new Promise(r => setTimeout(r, 500));
    }
    await downloadBlob(blob, filename);
    this.downloadedParts.push({ filename, size: blob.size });
  }

  private startNewPart(): void {
    this.partIndex++;
    this.currentZip = new JSZip();
    this.currentSize = 0;
  }

  /**
   * 完成所有分片
   */
  async finalizeAll(manifest: BackupManifest): Promise<ExportResult> {
    const isMultiPart = this.partIndex > 1;

    if (!isMultiPart) {
      manifest.backupId = this.backupId;
      manifest.partIndex = 1;
      manifest.totalParts = 1;
      manifest.isFinalPart = true;
      this.part1Zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      const blob = await this.part1Zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const filename = `${this.baseFilename}.zip`;
      await downloadBlob(blob, filename);
      return { files: [{ filename, size: blob.size }], totalParts: 1, stats: manifest.stats };
    }

    // 多分片：先下载 Part1
    const part1Manifest = { ...manifest, backupId: this.backupId, partIndex: 1, totalParts: null, isFinalPart: false };
    this.part1Zip.file('manifest.json', JSON.stringify(part1Manifest, null, 2));
    const part1Blob = await this.part1Zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const part1Filename = `${this.baseFilename}_part1.zip`;
    await downloadBlob(part1Blob, part1Filename);
    this.downloadedParts.unshift({ filename: part1Filename, size: part1Blob.size });

    // 下载最后一个分片
    if (this.currentSize > 0) {
      const finalManifest = { ...manifest, backupId: this.backupId, partIndex: this.partIndex, totalParts: this.partIndex, isFinalPart: true };
      this.currentZip.file('manifest.json', JSON.stringify(finalManifest, null, 2));
      const blob = await this.currentZip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const filename = `${this.baseFilename}_part${this.partIndex}.zip`;
      await new Promise(r => setTimeout(r, 700));
      await downloadBlob(blob, filename);
      this.downloadedParts.push({ filename, size: blob.size });
    }

    return { files: this.downloadedParts, totalParts: this.partIndex, stats: manifest.stats };
  }
}
