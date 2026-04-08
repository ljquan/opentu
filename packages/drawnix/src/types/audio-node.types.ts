import type { PlaitElement, Point } from '@plait/core';

export const AUDIO_NODE_DEFAULT_WIDTH = 340;
export const AUDIO_NODE_DEFAULT_HEIGHT = 128;

export interface AudioNodeMetadata {
  title?: string;
  duration?: number;
  previewImageUrl?: string;
  tags?: string;
  mv?: string;
  prompt?: string;
  providerTaskId?: string;
  clipId?: string;
  clipIds?: string[];
  width?: number;
  height?: number;
}

export interface AudioNodeCreateOptions {
  audioUrl: string;
  position: Point;
  size?: { width: number; height: number };
  metadata?: AudioNodeMetadata;
}

export interface PlaitAudioNode extends PlaitElement {
  type: 'audio';
  points: [Point, Point];
  audioUrl: string;
  title?: string;
  duration?: number;
  previewImageUrl?: string;
  tags?: string;
  modelVersion?: string;
  prompt?: string;
  providerTaskId?: string;
  clipId?: string;
  clipIds?: string[];
  createdAt: number;
}

export const isAudioNodeElement = (element: any): element is PlaitAudioNode => {
  return element?.type === 'audio' && typeof element.audioUrl === 'string';
};
