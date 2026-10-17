export const PART_SIZE_THRESHOLD: number;
export class SharedBackupPartManager {
    constructor(baseFilename: any, backupId: any, options?: {});
    baseFilename: any;
    backupId: any;
    options: {
        source: string;
        revokeDelayMs: number;
        interPartPauseMs: number;
        finalPartPauseMs: number;
        preserveAssetEntryDate: boolean;
        downloadBlob: typeof defaultDownloadBlob;
        ZipCtor: any;
    };
    partIndex: number;
    currentZip: any;
    currentSize: number;
    downloadedParts: any[];
    part1Zip: any;
    addFile(path: any, content: any): void;
    addAssetBlob(path: any, blob: any, metaPath: any, metaContent: any, createdAt: any): Promise<void>;
    finalizePart(): Promise<void>;
    startNewPart(): void;
    finalizeAll(manifest: any): Promise<{
        files: any[];
        totalParts: number;
        stats: any;
    }>;
}
declare function defaultDownloadBlob(blob: any, filename: any, revokeDelayMs?: number): Promise<void>;
export {};
