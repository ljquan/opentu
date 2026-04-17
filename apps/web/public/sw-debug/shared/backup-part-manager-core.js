import { BACKUP_SIGNATURE, BACKUP_VERSION } from './backup-core.js';

export const PART_SIZE_THRESHOLD = 500 * 1024 * 1024;

async function defaultDownloadBlob(blob, filename, revokeDelayMs = 0) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (revokeDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, revokeDelayMs));
  }
  URL.revokeObjectURL(url);
}

function normalizeEntryDate(timestamp) {
  if (!timestamp || Number.isNaN(timestamp) || timestamp <= 0) {
    return new Date();
  }
  const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export class SharedBackupPartManager {
  constructor(baseFilename, backupId, options = {}) {
    this.baseFilename = baseFilename;
    this.backupId = backupId;
    this.options = {
      source: 'app',
      revokeDelayMs: 0,
      interPartPauseMs: 500,
      finalPartPauseMs: 500,
      preserveAssetEntryDate: false,
      downloadBlob: defaultDownloadBlob,
      ZipCtor: null,
      ...options,
    };
    if (!this.options.ZipCtor) {
      throw new Error('SharedBackupPartManager requires ZipCtor');
    }
    this.partIndex = 1;
    this.currentZip = new this.options.ZipCtor();
    this.currentSize = 0;
    this.downloadedParts = [];
    this.part1Zip = this.currentZip;
  }

  addFile(path, content) {
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    this.currentZip.file(path, data);
    this.currentSize += new Blob([data]).size;
  }

  async addAssetBlob(path, blob, metaPath, metaContent, createdAt) {
    const metaStr = typeof metaContent === 'string' ? metaContent : JSON.stringify(metaContent, null, 2);
    const newSize = blob.size + new Blob([metaStr]).size;
    const fileOptions =
      this.options.preserveAssetEntryDate && createdAt
        ? { date: normalizeEntryDate(createdAt) }
        : undefined;

    if (this.currentSize + newSize > PART_SIZE_THRESHOLD && this.currentSize > 0) {
      await this.finalizePart();
      this.startNewPart();
    }

    const assetsFolder = this.currentZip.folder('assets');
    assetsFolder.file(metaPath, metaStr, fileOptions);
    assetsFolder.file(path, blob, fileOptions);
    this.currentSize += newSize;
  }

  async finalizePart() {
    const partManifest = {
      signature: BACKUP_SIGNATURE,
      version: BACKUP_VERSION,
      createdAt: Date.now(),
      source: this.options.source,
      backupId: this.backupId,
      partIndex: this.partIndex,
      totalParts: null,
      isFinalPart: false,
      includes: { prompts: false, projects: false, assets: true, tasks: false, knowledgeBase: false },
    };

    const zipToUse = this.partIndex === 1 ? this.part1Zip : this.currentZip;
    zipToUse.file('manifest.json', JSON.stringify(partManifest, null, 2));

    if (this.partIndex === 1) return;

    const blob = await this.currentZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const filename = `${this.baseFilename}_part${this.partIndex}.zip`;
    if (this.downloadedParts.length > 0 && this.options.interPartPauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.interPartPauseMs));
    }
    await this.options.downloadBlob(blob, filename, this.options.revokeDelayMs);
    this.downloadedParts.push({ filename, size: blob.size });
  }

  startNewPart() {
    this.partIndex += 1;
    this.currentZip = new this.options.ZipCtor();
    this.currentSize = 0;
  }

  async finalizeAll(manifest) {
    const isMultiPart = this.partIndex > 1;

    if (!isMultiPart) {
      const finalManifest = {
        ...manifest,
        backupId: this.backupId,
        partIndex: 1,
        totalParts: 1,
        isFinalPart: true,
      };
      this.part1Zip.file('manifest.json', JSON.stringify(finalManifest, null, 2));

      const blob = await this.part1Zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const filename = `${this.baseFilename}.zip`;
      await this.options.downloadBlob(blob, filename, this.options.revokeDelayMs);
      return { files: [{ filename, size: blob.size }], totalParts: 1, stats: manifest.stats };
    }

    const part1Manifest = {
      ...manifest,
      backupId: this.backupId,
      partIndex: 1,
      totalParts: null,
      isFinalPart: false,
    };
    this.part1Zip.file('manifest.json', JSON.stringify(part1Manifest, null, 2));
    const part1Blob = await this.part1Zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const part1Filename = `${this.baseFilename}_part1.zip`;
    await this.options.downloadBlob(part1Blob, part1Filename, this.options.revokeDelayMs);
    this.downloadedParts.unshift({ filename: part1Filename, size: part1Blob.size });

    if (this.currentSize > 0) {
      const finalManifest = {
        ...manifest,
        backupId: this.backupId,
        partIndex: this.partIndex,
        totalParts: this.partIndex,
        isFinalPart: true,
      };
      this.currentZip.file('manifest.json', JSON.stringify(finalManifest, null, 2));
      const blob = await this.currentZip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const filename = `${this.baseFilename}_part${this.partIndex}.zip`;
      if (this.options.finalPartPauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.options.finalPartPauseMs));
      }
      await this.options.downloadBlob(blob, filename, this.options.revokeDelayMs);
      this.downloadedParts.push({ filename, size: blob.size });
    }

    return { files: this.downloadedParts, totalParts: this.partIndex, stats: manifest.stats };
  }
}
