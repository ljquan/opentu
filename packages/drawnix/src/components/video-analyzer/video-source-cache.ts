import { unifiedCacheService } from '../../services/unified-cache-service';
import type { AnalysisSourceSnapshot } from './types';

function sanitizeExtension(value?: string): string {
  const normalized = (value || '').trim().toLowerCase();
  return normalized.replace(/[^a-z0-9]/g, '') || 'mp4';
}

function inferVideoExtension(file: File): string {
  const nameExt = file.name.split('.').pop();
  if (nameExt && nameExt.length <= 8) {
    return sanitizeExtension(nameExt);
  }

  const mimeSubtype = file.type.split('/')[1];
  return sanitizeExtension(mimeSubtype);
}

export async function cacheVideoSource(
  file: File,
  cacheKey?: string
): Promise<AnalysisSourceSnapshot> {
  const ext = inferVideoExtension(file);
  const safeKey =
    cacheKey ||
    `video-analyzer-source-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  const cacheUrl = `/__aitu_cache__/video/${safeKey}.${ext}`;

  await unifiedCacheService.cacheMediaFromBlob(cacheUrl, file, 'video', {
    metadata: {
      source: 'video-analyzer-input',
      fileName: file.name,
      mimeType: file.type || 'video/mp4',
      size: file.size,
    },
  });

  return {
    type: 'upload',
    cacheUrl,
    fileName: file.name || `video-source.${ext}`,
    mimeType: file.type || 'video/mp4',
    size: file.size,
  };
}

export async function restoreVideoFileFromSnapshot(
  snapshot?: AnalysisSourceSnapshot | null
): Promise<File | null> {
  if (!snapshot || snapshot.type !== 'upload') {
    return null;
  }

  const blob = await unifiedCacheService.getCachedBlob(snapshot.cacheUrl);
  if (!blob) {
    return null;
  }

  return new File([blob], snapshot.fileName || 'video-source.mp4', {
    type: snapshot.mimeType || blob.type || 'video/mp4',
    lastModified: Date.now(),
  });
}
