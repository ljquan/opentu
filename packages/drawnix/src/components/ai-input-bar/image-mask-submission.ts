import type { PlaitBoard } from '@plait/core';
import { getImageMaskEditForAI } from '../../utils/selection-utils';

interface MaskSubmissionContent {
  type: string;
  url?: string;
  maskImage?: string;
  width?: number;
  height?: number;
}

interface MaskSubmissionTarget {
  type: string;
  elementId: string;
  url: string;
  semanticReplacement?: unknown;
}

/** Resolve the selected image's mask independently of where its result is inserted. */
export async function prepareImageMaskSubmission<T extends MaskSubmissionContent>(
  board: PlaitBoard | null,
  target: MaskSubmissionTarget | null,
  generationType: string,
  content: T[]
): Promise<{
  content: T[];
  maskEdit: Awaited<ReturnType<typeof getImageMaskEditForAI>>;
}> {
  if (
    !board || generationType !== 'image' || target?.type !== 'image' ||
    target.semanticReplacement
  ) {
    return { content, maskEdit: null };
  }
  const index = content.findIndex(
    (item) => item.type === 'image' && item.url === target.url
  );
  if (index < 0) return { content, maskEdit: null };

  // Credential handoffs already contain a snapshot; don't replace it with newer strokes.
  const source = content[index];
  const maskEdit = source.maskImage
    ? { url: target.url, maskImage: source.maskImage, width: source.width, height: source.height }
    : await getImageMaskEditForAI(board, target.elementId);
  return {
    content: maskEdit
      ? content.map((item, itemIndex) => itemIndex === index ? { ...item, ...maskEdit } : item)
      : content,
    maskEdit,
  };
}
