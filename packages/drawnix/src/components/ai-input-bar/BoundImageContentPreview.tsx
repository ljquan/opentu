import React, { useEffect, useState } from 'react';
import type { PlaitBoard } from '@plait/core';
import {
  SelectedContentPreview,
  type SelectedContentPreviewProps,
} from '../shared/SelectedContentPreview';
import {
  AI_SELECTION_CONTENT_REFRESH_EVENT,
  getImageMaskEditForAI,
} from '../../utils/selection-utils';
import { findMaskBrushesForImage, isMaskBrushEligibleImage } from '../../utils/ai-mask-brush';

interface MaskPreviewTarget {
  type: string;
  elementId: string;
  url: string;
  semanticReplacement?: unknown;
}

type MaskEdit = Awaited<ReturnType<typeof getImageMaskEditForAI>>;

interface Props extends SelectedContentPreviewProps {
  board: PlaitBoard | null;
  target: MaskPreviewTarget | null;
}

export const BoundImageContentPreview: React.FC<Props> = ({ board, target, ...props }) => {
  const elementId = target?.type === 'image' && !target.semanticReplacement
    ? target.elementId : undefined;
  const sourceUrl = target?.url;
  const [preview, setPreview] = useState<{
    elementId: string;
    sourceUrl: string;
    maskEdit: MaskEdit;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!board || !elementId || !sourceUrl) return;
    let disposed = false;
    let revision = 0;
    let signature: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      const image = board.children.find((element) => element.id === elementId);
      const masks = image?.url === sourceUrl && isMaskBrushEligibleImage(image)
        ? findMaskBrushesForImage(board, image) : [];
      // Pointer releases on toolbar/input controls must not re-encode unchanged masks.
      const nextSignature = JSON.stringify([
        image?.url, image?.points, image?.aiMaskInverted,
        masks.map((mask) => [mask.id, mask.points, mask.strokeWidth, mask.brushShape]),
      ]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      const currentRevision = ++revision;
      setPreview(null);
      if (masks.length === 0) return;
      try {
        const maskEdit = await getImageMaskEditForAI(board, elementId);
        if (!disposed && revision === currentRevision) {
          setPreview({ elementId, sourceUrl, maskEdit });
        }
      } catch {
        if (!disposed && revision === currentRevision) {
          signature = undefined;
          setPreview({ elementId, sourceUrl, maskEdit: null, error: '蒙版预览失败' });
        }
      }
    };
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 50);
    };
    void refresh();
    document.addEventListener('pointerup', scheduleRefresh);
    document.addEventListener('keyup', scheduleRefresh);
    document.addEventListener(AI_SELECTION_CONTENT_REFRESH_EVENT, scheduleRefresh);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('pointerup', scheduleRefresh);
      document.removeEventListener('keyup', scheduleRefresh);
      document.removeEventListener(AI_SELECTION_CONTENT_REFRESH_EVENT, scheduleRefresh);
    };
  }, [board, elementId, sourceUrl]);

  const currentPreview = preview && preview.elementId === elementId && preview.sourceUrl === sourceUrl
    ? preview : null;
  const items = currentPreview?.maskEdit
    ? props.items.map((item) => item.type === 'image' && item.url === sourceUrl
      ? { ...item, ...currentPreview.maskEdit } : item)
    : props.items;
  return <>
    {currentPreview?.error && <span role="alert">{
      props.language === 'en' ? 'Mask preview failed' : currentPreview.error
    }</span>}
    <SelectedContentPreview {...props} items={items} />
  </>;
};
