/**
 * Backup Part Manager
 * 主应用基于共享分片核心做轻量适配。
 */

import type { BackupManifest, ExportResult } from './types';
import {
  PART_SIZE_THRESHOLD,
  SharedBackupPartManager,
} from '../../../../../apps/web/public/sw-debug/shared/backup-part-manager-core.js';

export { PART_SIZE_THRESHOLD };

interface QueuedZipFile {
  path: string;
  content: unknown;
  options?: unknown;
}

class LazyJSZipFolder {
  constructor(
    private readonly zip: LazyJSZip,
    private readonly folderPath: string
  ) {}

  file(path: string, content: unknown, options?: unknown): this {
    this.zip.addFile(`${this.folderPath}/${path}`, content, options);
    return this;
  }
}

class LazyJSZip {
  private zip: unknown;
  private queuedFiles: Array<QueuedZipFile | undefined> = [];

  addFile(path: string, content: unknown, options?: unknown): void {
    if (this.zip) {
      (this.zip as any).file(path, content, options);
      return;
    }
    this.queuedFiles.push({ path, content, options });
  }

  file(path: string, content: unknown, options?: unknown): this {
    this.addFile(path, content, options);
    return this;
  }

  folder(path: string): LazyJSZipFolder {
    return new LazyJSZipFolder(this, path);
  }

  async generateAsync(options: unknown): Promise<Blob> {
    const zip = await this.materialize();
    return (zip as any).generateAsync(options);
  }

  private async materialize(): Promise<unknown> {
    if (this.zip) {
      return this.zip;
    }

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (let i = 0; i < this.queuedFiles.length; i++) {
      const queuedFile = this.queuedFiles[i];
      if (!queuedFile) {
        continue;
      }
      zip.file(queuedFile.path, queuedFile.content as any, queuedFile.options as any);
      this.queuedFiles[i] = undefined;
    }
    this.queuedFiles = [];
    this.zip = zip;
    return zip;
  }
}

export class BackupPartManager extends SharedBackupPartManager {
  constructor(baseFilename: string, backupId: string) {
    super(baseFilename, backupId, {
      source: 'app',
      revokeDelayMs: 1200,
      interPartPauseMs: 500,
      finalPartPauseMs: 700,
      preserveAssetEntryDate: true,
      ZipCtor: LazyJSZip,
    });
  }

  override finalizeAll(manifest: BackupManifest): Promise<ExportResult> {
    return super.finalizeAll(manifest) as Promise<ExportResult>;
  }
}
