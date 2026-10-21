import type { PlaitElement } from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { isVideoElement } from '../plugins/with-video';
import { isToolElement } from '../plugins/with-tool';
import { isAudioNodeElement } from '../types/audio-node.types';
import { isCardElement } from '../types/card.types';
import type { CanvasImageDetailsSource } from './canvas-image-details';
import { readLocalImageOperation } from './local-image-operation';

export function getCanvasGenerationDetailsSource(
  element?: PlaitElement
): CanvasImageDetailsSource | undefined {
  if (!element || isToolElement(element)) return undefined;
  const kind = isAudioNodeElement(element)
    ? 'audio'
    : isVideoElement(element)
    ? 'video'
    : PlaitDrawElement.isDrawElement(element) &&
      PlaitDrawElement.isImage(element)
    ? 'image'
    : isCardElement(element) ||
      (PlaitDrawElement.isDrawElement(element) &&
        PlaitDrawElement.isText(element))
    ? 'text'
    : undefined;
  if (!kind) return undefined;
  const readString = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value : undefined;
  const readNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  const validLocalOperation =
    kind === 'image'
      ? readLocalImageOperation(element.localImageOperation)
      : undefined;
  return {
    id: element.id,
    kind,
    url: readString(kind === 'audio' ? element.audioUrl : element.url),
    generationTaskId: readString(element.generationTaskId),
    prompt:
      readString(element.generationPrompt) ||
      readString(element.aiPrompt) ||
      readString(element.prompt),
    duration:
      kind === 'audio' || kind === 'video'
        ? readNumber(element.duration)
        : undefined,
    localOperation: validLocalOperation,
    width:
      validLocalOperation?.outputWidth ??
      (kind === 'image' || kind === 'video'
        ? readNumber(element.width)
        : undefined),
    height:
      validLocalOperation?.outputHeight ??
      (kind === 'image' || kind === 'video'
        ? readNumber(element.height)
        : undefined),
  };
}
