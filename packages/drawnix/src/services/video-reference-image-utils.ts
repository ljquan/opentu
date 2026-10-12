import { compressImageBlob, normalizeImageBlobToSize } from '@aitu/utils';
import { readKeepOriginalImageEnabled } from './reference-image-settings';

const MAX_VIDEO_REFERENCE_IMAGE_BYTES = 1 * 1024 * 1024;

export async function prepareVideoReferenceImageBlob(
  blob: Blob,
  size?: string | null
): Promise<Blob> {
  const keepOriginal = readKeepOriginalImageEnabled();
  if (!blob.type.startsWith('image/')) {
    return blob;
  }

  let processedBlob = blob;

  try {
    processedBlob = await normalizeImageBlobToSize(processedBlob, size, {
      fit: 'cover',
      outputType: 'image/png',
    });
  } catch (error) {
    console.warn(
      '[prepareVideoReferenceImageBlob] Failed to normalize image dimensions:',
      error
    );
  }

  if (!keepOriginal && processedBlob.size > MAX_VIDEO_REFERENCE_IMAGE_BYTES) {
    try {
      processedBlob = await compressImageBlob(
        processedBlob,
        MAX_VIDEO_REFERENCE_IMAGE_BYTES / (1024 * 1024)
      );
    } catch (error) {
      console.warn(
        '[prepareVideoReferenceImageBlob] Failed to compress image:',
        error
      );
    }
  }

  return processedBlob;
}
