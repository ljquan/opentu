import { unifiedCacheService } from '../../services/unified-cache-service';
import type { MusicAnalysisSourceSnapshot } from './types';

function sanitizeExtension(value?: string): string {
  const normalized = (value || '').trim().toLowerCase();
  return normalized.replace(/[^a-z0-9]/g, '') || 'mp3';
}

function inferAudioExtension(file: File): string {
  const nameExt = file.name.split('.').pop();
  if (nameExt && nameExt.length <= 8) {
    return sanitizeExtension(nameExt);
  }

  return sanitizeExtension(file.type.split('/')[1]);
}

export async function cacheAudioSource(
  file: File,
  cacheKey?: string
): Promise<MusicAnalysisSourceSnapshot> {
  const ext = inferAudioExtension(file);
  const safeKey =
    cacheKey ||
    `music-analyzer-source-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  const cacheUrl = `/__aitu_cache__/audio/${safeKey}.${ext}`;

  await unifiedCacheService.cacheMediaFromBlob(cacheUrl, file, 'audio', {
    metadata: {
      source: 'music-analyzer-input',
      fileName: file.name,
      mimeType: file.type || 'audio/mpeg',
      size: file.size,
    },
  });

  return {
    type: 'upload',
    cacheUrl,
    fileName: file.name || `music-source.${ext}`,
    mimeType: file.type || 'audio/mpeg',
    size: file.size,
  };
}

export async function restoreAudioFileFromSnapshot(
  snapshot?: MusicAnalysisSourceSnapshot | null
): Promise<File | null> {
  if (!snapshot || snapshot.type !== 'upload') {
    return null;
  }

  const blob = await unifiedCacheService.getCachedBlob(snapshot.cacheUrl);
  if (!blob) {
    return null;
  }

  return new File([blob], snapshot.fileName || 'music-source.mp3', {
    type: snapshot.mimeType || blob.type || 'audio/mpeg',
    lastModified: Date.now(),
  });
}
