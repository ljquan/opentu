import React, { useMemo, type CSSProperties } from 'react';
import { AudioNodeContent } from '../audio-node-element/AudioNodeContent';
import type { Asset } from '../../types/asset.types';
import type { PlaitAudioNode } from '../../types/audio-node.types';
import type { CanvasAudioPlaybackSource } from '../../services/canvas-audio-playback-service';

interface MarkdownAudioAssetCardProps {
  asset: Asset;
  style?: CSSProperties;
}

export const MarkdownAudioAssetCard: React.FC<MarkdownAudioAssetCardProps> = ({ asset, style }) => {
  const element = useMemo<PlaitAudioNode>(() => ({
    id: `markdown-audio-${asset.id}`,
    type: 'audio',
    points: [[0, 0], [340, 128]],
    children: [],
    audioUrl: asset.url,
    title: asset.name,
    previewImageUrl: asset.thumbnail,
    prompt: asset.prompt,
    createdAt: asset.createdAt,
  }), [asset]);

  const queue = useMemo<CanvasAudioPlaybackSource[]>(() => [{
    elementId: element.id,
    audioUrl: asset.url,
    title: asset.name,
    previewImageUrl: asset.thumbnail,
  }], [asset.name, asset.thumbnail, asset.url, element.id]);

  return (
    <div className="collimind-markdown-audio-card" style={style}>
      <AudioNodeContent element={element} selected={false} canvasQueue={queue} />
    </div>
  );
};
