import {
  PlaitBoard,
  Point,
  getRectangleByElements,
} from '@plait/core';
import { getFileExtension } from '@aitu/utils';
import type { DataURL } from '../types';
import {
  getInsertionPointForSelectedElements,
  getInsertionPointBelowBottommostElement,
  scrollToPointIfNeeded,
} from '../utils/selection-utils';
import { analytics } from '../utils/posthog-analytics';
import { cacheRemoteUrl } from '../services/media-executor/fallback-utils';
import { isVirtualMediaUrl } from '../utils/virtual-media-url';
import { createHash, getAudioCacheKeySeed } from './audio-cache-key';
import {
  AUDIO_NODE_DEFAULT_HEIGHT,
  AUDIO_NODE_DEFAULT_WIDTH,
  isAudioNodeElement,
  type AudioNodeMetadata,
} from '../types/audio-node.types';
import { AudioNodeTransforms } from '../plugins/with-audio-node';
import type { CanvasAudioPlaybackSource } from '../services/canvas-audio-playback-service';

export const AUDIO_CARD_DEFAULT_WIDTH = AUDIO_NODE_DEFAULT_WIDTH;
export const AUDIO_CARD_DEFAULT_HEIGHT = AUDIO_NODE_DEFAULT_HEIGHT;
const AUDIO_CARD_ADAPTIVE_MIN_WIDTH = 380;
const AUDIO_CARD_ADAPTIVE_MAX_WIDTH = 520;

export type AudioCardMetadata = AudioNodeMetadata;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function measureVisualTextUnits(value?: string): number {
  if (!value) {
    return 0;
  }

  let units = 0;
  for (const char of value) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) {
      units += 2;
    } else if (/[A-Z0-9]/.test(char)) {
      units += 1.12;
    } else if (/\s/.test(char)) {
      units += 0.45;
    } else {
      units += 1;
    }
  }
  return units;
}

function extractAudioCardPreviewText(metadata: AudioCardMetadata): string {
  const normalizedTags = metadata.tags
    ?.split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');

  if (normalizedTags) {
    return normalizedTags;
  }

  const promptPreview = metadata.prompt
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  return promptPreview || '画布音频';
}

function resolveAdaptiveAudioCardWidth(metadata: AudioCardMetadata): number {
  const titleUnits = measureVisualTextUnits(metadata.title || '未命名音频');
  const previewUnits = measureVisualTextUnits(extractAudioCardPreviewText(metadata));
  const dominantUnits = Math.max(titleUnits * 1.08, previewUnits);
  const estimatedWidth = Math.round(304 + clamp(dominantUnits, 0, 48) * 4.6);
  return clamp(
    estimatedWidth,
    AUDIO_CARD_ADAPTIVE_MIN_WIDTH,
    AUDIO_CARD_ADAPTIVE_MAX_WIDTH
  );
}

export function resolveAudioCardDimensions(
  metadata: AudioCardMetadata = {}
): { width: number; height: number } {
  const explicitWidth = metadata.width;
  const explicitHeight = metadata.height;
  const width =
    typeof explicitWidth === 'number' &&
    Number.isFinite(explicitWidth) &&
    explicitWidth > 0 &&
    explicitWidth !== AUDIO_CARD_DEFAULT_WIDTH
      ? explicitWidth
      : resolveAdaptiveAudioCardWidth(metadata);
  const height =
    typeof explicitHeight === 'number' &&
    Number.isFinite(explicitHeight) &&
    explicitHeight > 0
      ? explicitHeight
      : AUDIO_CARD_DEFAULT_HEIGHT;

  return { width, height };
}

interface AudioImageElement {
  id?: string;
  url: DataURL;
  width: number;
  height: number;
  isAudio: true;
  audioType: 'music-card';
  audioUrl: string;
  audioTitle?: string;
  audioDuration?: number;
  audioTags?: string;
  audioModelVersion?: string;
  previewImageUrl?: string;
  prompt?: string;
  audioProviderTaskId?: string;
  audioClipId?: string;
  audioClipIds?: string[];
}

function getInsertionPointFromSavedSelection(
  board: PlaitBoard,
  cardWidth: number
): Point | undefined {
  const appState = (board as any).appState;
  const savedElementIds = appState?.lastSelectedElementIds || [];

  if (savedElementIds.length === 0) {
    return undefined;
  }

  const elements = savedElementIds
    .map((id: string) => board.children.find((el: any) => el.id === id))
    .filter(Boolean);

  if (elements.length === 0) {
    return undefined;
  }

  try {
    const boundingRect = getRectangleByElements(board, elements, false);
    const centerX = boundingRect.x + boundingRect.width / 2;
    const insertionY = boundingRect.y + boundingRect.height + 50;
    return [centerX - cardWidth / 2, insertionY] as Point;
  } catch (error) {
    console.warn('[audio] Failed to calculate insertion point from saved selection:', error);
    return undefined;
  }
}

function blobToDataUrl(blob: Blob): Promise<DataURL> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as DataURL);
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob as data URL'));
    reader.readAsDataURL(blob);
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatAudioDuration(duration?: number): string {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return '--:--';
  }

  const totalSeconds = Math.round(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildWaveform(seedSource: string): string {
  const seed = createHash(seedSource);
  const bars: string[] = [];
  const baseX = 122;
  const baseY = 83;
  const gap = 7;
  const barWidth = 4;

  for (let index = 0; index < 22; index++) {
    const height = 10 + ((seed >> (index % 12)) % 18) + (index % 4);
    const y = baseY - Math.round(height / 2);
    const isActive = index < 8;
    bars.push(
      `<rect x="${baseX + index * gap}" y="${y}" width="${barWidth}" height="${height}" rx="2" fill="${
        isActive ? '#2563eb' : '#d7dee9'
      }" opacity="${isActive ? '1' : '0.95'}" />`
    );
  }

  return bars.join('');
}

function buildArtworkMarkup(
  artworkDataUrl: string | null,
  width: number,
  height: number,
  titleSeed: string
): string {
  const artworkSize = 84;
  const artworkX = 18;
  const artworkY = (height - artworkSize) / 2;
  const seed = createHash(titleSeed);
  const glowColor = seed % 2 === 0 ? '#fb923c' : '#60a5fa';

  const baseLayer = `
    <rect x="${artworkX}" y="${artworkY}" width="${artworkSize}" height="${artworkSize}" rx="20" fill="#0f172a" />
    <rect x="${artworkX}" y="${artworkY}" width="${artworkSize}" height="${artworkSize}" rx="20" fill="url(#artworkGradient)" opacity="0.92" />
    <circle cx="${artworkX + artworkSize - 18}" cy="${artworkY + 18}" r="12" fill="${glowColor}" opacity="0.85" />
    <rect x="${artworkX + 15}" y="${artworkY + 16}" width="6" height="52" rx="3" fill="#ffffff" opacity="0.85" />
    <rect x="${artworkX + 28}" y="${artworkY + 22}" width="5" height="40" rx="2.5" fill="#ffffff" opacity="0.7" />
    <rect x="${artworkX + 40}" y="${artworkY + 28}" width="5" height="28" rx="2.5" fill="#ffffff" opacity="0.54" />
  `;

  if (!artworkDataUrl) {
    return baseLayer;
  }

  return `
    ${baseLayer}
    <clipPath id="artworkClip">
      <rect x="${artworkX}" y="${artworkY}" width="${artworkSize}" height="${artworkSize}" rx="20" />
    </clipPath>
    <image href="${escapeXml(artworkDataUrl)}" x="${artworkX}" y="${artworkY}" width="${artworkSize}" height="${artworkSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#artworkClip)" />
    <rect x="${artworkX}" y="${artworkY}" width="${artworkSize}" height="${artworkSize}" rx="20" fill="url(#artworkFade)" />
  `;
}

async function resolveArtworkDataUrl(previewImageUrl?: string): Promise<string | null> {
  if (!previewImageUrl) {
    return null;
  }

  let resolvedUrl = previewImageUrl;
  if (
    previewImageUrl.startsWith('http://') ||
    previewImageUrl.startsWith('https://')
  ) {
    try {
      const cachedUrl = await cacheRemoteUrl(
        previewImageUrl,
        `audio-cover-${Date.now()}`,
        'image',
        'png'
      );
      resolvedUrl = cachedUrl || previewImageUrl;
    } catch (error) {
      console.warn('[audio] Failed to cache preview image, falling back to original URL:', error);
    }
  }

  try {
    const response = await fetch(resolvedUrl, { credentials: 'omit' });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch (error) {
    console.warn('[audio] Failed to resolve preview image as data URL:', error);
    return null;
  }
}

function buildAudioCardSvg(
  metadata: Required<Pick<AudioCardMetadata, 'width' | 'height'>> &
    AudioCardMetadata,
  artworkDataUrl: string | null
): string {
  const width = metadata.width;
  const height = metadata.height;
  const title = escapeXml(truncateText(metadata.title || 'Untitled Track', 28));
  const subtitle = escapeXml(
    truncateText(metadata.tags || metadata.prompt || 'Canvas audio asset', 34)
  );
  const duration = escapeXml(formatAudioDuration(metadata.duration));
  const modelVersion = escapeXml(
    truncateText(
      metadata.mv ? metadata.mv.replace(/^chirp-/, '').toUpperCase() : 'SUNO',
      10
    )
  );
  const waveform = buildWaveform(
    `${metadata.title || ''}-${metadata.tags || ''}-${metadata.prompt || ''}`
  );
  const artworkMarkup = buildArtworkMarkup(
    artworkDataUrl,
    width,
    height,
    `${metadata.title || ''}-${metadata.previewImageUrl || ''}`
  );

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="cardBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fffdfa" />
          <stop offset="100%" stop-color="#f6f8fc" />
        </linearGradient>
        <linearGradient id="artworkGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1f2937" />
          <stop offset="55%" stop-color="#1d4ed8" />
          <stop offset="100%" stop-color="#f97316" />
        </linearGradient>
        <linearGradient id="artworkFade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.08" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.28" />
        </linearGradient>
        <filter id="cardShadow" x="-20%" y="-30%" width="140%" height="180%">
          <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#cfd7e6" flood-opacity="0.4" />
        </filter>
      </defs>
      <rect x="6" y="8" width="${width - 12}" height="${height - 16}" rx="24" fill="url(#cardBg)" stroke="#e8edf5" stroke-width="1.25" filter="url(#cardShadow)" />
      <rect x="8" y="10" width="${width - 16}" height="${height - 20}" rx="22" fill="#ffffff" fill-opacity="0.55" />
      ${artworkMarkup}
      <g transform="translate(122 26)">
        <text x="0" y="0" font-size="16" font-weight="700" font-family="Inter, system-ui, sans-serif" fill="#111827" dominant-baseline="hanging">${title}</text>
        <text x="0" y="24" font-size="11" font-weight="500" font-family="Inter, system-ui, sans-serif" fill="#6b7280" dominant-baseline="hanging">${subtitle}</text>
      </g>
      <rect x="${width - 70}" y="22" width="46" height="22" rx="11" fill="#f3f6fb" stroke="#e4ebf5" />
      <text x="${width - 47}" y="33" text-anchor="middle" font-size="10" font-weight="700" font-family="Inter, system-ui, sans-serif" fill="#4b5563" dominant-baseline="middle">${modelVersion}</text>
      <circle cx="44" cy="${height - 30}" r="16" fill="#2563eb" />
      <polygon points="40,${height - 38} 40,${height - 22} 52,${height - 30}" fill="#ffffff" />
      <text x="${width - 26}" y="${height - 30}" text-anchor="end" font-size="12" font-weight="700" font-family="JetBrains Mono, ui-monospace, monospace" fill="#111827" dominant-baseline="middle">${duration}</text>
      <line x1="122" y1="${height - 30}" x2="${width - 78}" y2="${height - 30}" stroke="#edf2f8" stroke-width="8" stroke-linecap="round" />
      <line x1="122" y1="${height - 30}" x2="176" y2="${height - 30}" stroke="#c8dafd" stroke-width="8" stroke-linecap="round" />
      ${waveform}
    </svg>
  `.trim();
}

function svgToDataUrl(svg: string): DataURL {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}` as DataURL;
}

function isLegacyAudioImageElement(element: any): element is AudioImageElement {
  if (!element) {
    return false;
  }

  if (element.isAudio === true || element.audioType === 'music-card') {
    return true;
  }

  return typeof element.audioUrl === 'string' && element.audioUrl.length > 0;
}

export function isAudioElement(element: any): boolean {
  return isAudioNodeElement(element) || isLegacyAudioImageElement(element);
}

export function getAudioPlaybackSourceFromElement(
  element: any
): CanvasAudioPlaybackSource | null {
  if (isAudioNodeElement(element)) {
    return {
      elementId: element.id,
      audioUrl: element.audioUrl,
      title: element.title,
      duration: element.duration,
      previewImageUrl: element.previewImageUrl,
      clipId: element.clipId,
      providerTaskId: element.providerTaskId,
      clipIds: element.clipIds,
    };
  }

  if (isLegacyAudioImageElement(element)) {
    return {
      elementId: element.id,
      audioUrl: element.audioUrl,
      title: element.audioTitle,
      duration: element.audioDuration,
      previewImageUrl: element.previewImageUrl,
      clipId: element.audioClipId,
      providerTaskId: element.audioProviderTaskId,
      clipIds: element.audioClipIds,
    };
  }

  return null;
}

export function getCanvasAudioPlaybackQueue(
  elements: any[] | undefined | null
): CanvasAudioPlaybackSource[] {
  if (!Array.isArray(elements) || elements.length === 0) {
    return [];
  }

  return elements
    .map((element) => getAudioPlaybackSourceFromElement(element))
    .filter((source): source is CanvasAudioPlaybackSource => Boolean(source?.audioUrl));
}

export async function buildAudioImageElement(
  audioUrl: string,
  metadata: AudioCardMetadata = {}
): Promise<AudioImageElement> {
  const { width, height } = resolveAudioCardDimensions(metadata);
  const artworkDataUrl = await resolveArtworkDataUrl(metadata.previewImageUrl);
  const svg = buildAudioCardSvg({ ...metadata, width, height }, artworkDataUrl);

  return {
    url: svgToDataUrl(svg),
    width,
    height,
    isAudio: true,
    audioType: 'music-card',
    audioUrl,
    audioTitle: metadata.title,
    audioDuration: metadata.duration,
    audioTags: metadata.tags,
    audioModelVersion: metadata.mv,
    previewImageUrl: metadata.previewImageUrl,
    prompt: metadata.prompt,
    audioProviderTaskId: metadata.providerTaskId,
    audioClipId: metadata.clipId,
    audioClipIds: metadata.clipIds,
  };
}

export async function insertAudioFromUrl(
  board: PlaitBoard | null,
  audioUrl: string,
  metadata: AudioCardMetadata = {},
  startPoint?: Point,
  isDrop?: boolean,
  skipScroll?: boolean
): Promise<void> {
  if (!board) {
    throw new Error('Board is required for audio insertion');
  }

  let resolvedAudioUrl = audioUrl;
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    try {
      const cacheKeySeed = getAudioCacheKeySeed(audioUrl, {
        clipId: metadata.clipId,
        providerTaskId: metadata.providerTaskId,
      });
      const ext = getFileExtension(audioUrl);
      resolvedAudioUrl = await cacheRemoteUrl(
        audioUrl,
        cacheKeySeed,
        'audio',
        ext !== 'bin' ? ext : 'mp3'
      );
    } catch (error) {
      console.warn('[audio] Failed to cache audio before insertion:', error);
    }
  }

  const { width, height } = resolveAudioCardDimensions(metadata);
  let insertionPoint = startPoint;

  if (!startPoint && !isDrop) {
    insertionPoint = getInsertionPointFromSavedSelection(board, width);

    if (!insertionPoint) {
      const calculatedPoint = getInsertionPointForSelectedElements(board);
      if (calculatedPoint) {
        insertionPoint = [
          calculatedPoint[0] - width / 2,
          calculatedPoint[1],
        ] as Point;
      } else {
        insertionPoint = getInsertionPointBelowBottommostElement(board, width);
      }
    }
  }

  const finalPoint = insertionPoint || [100, 100] as Point;
  AudioNodeTransforms.insertAudioNode(board, {
    audioUrl: resolvedAudioUrl,
    position: finalPoint,
    size: {
      width,
      height,
    },
    metadata: {
      ...metadata,
      width,
      height,
    },
  });

  analytics.track('asset_insert_canvas', {
    type: 'audio',
    source: isVirtualMediaUrl(resolvedAudioUrl) ? 'local' : 'external',
    width,
    height,
  });

  if (finalPoint && !isDrop && !skipScroll) {
    const centerPoint: Point = [
      finalPoint[0] + width / 2,
      finalPoint[1] + height / 2,
    ];
    requestAnimationFrame(() => {
      scrollToPointIfNeeded(board, centerPoint);
    });
  }
}

export function getAudioFileDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.addEventListener('loadedmetadata', () => {
      const d = audio.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : undefined);
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    });
    audio.src = url;
  });
}

/**
 * 从音频文件中提取内嵌封面图（ID3v2 APIC frame）
 * 只读取文件头部，不加载整个文件到内存
 */
export async function extractAudioCoverArt(file: File): Promise<Blob | null> {
  try {
    // 只读前 512KB，足够覆盖大多数 ID3 标签
    const headerSize = Math.min(file.size, 512 * 1024);
    const buffer = await file.slice(0, headerSize).arrayBuffer();
    const view = new DataView(buffer);

    // 检查 ID3v2 头: "ID3"
    if (view.byteLength < 10) return null;
    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
      return null;
    }

    // ID3v2 标签大小（syncsafe integer）
    const tagSize =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f);

    const majorVersion = view.getUint8(3);
    const end = Math.min(10 + tagSize, view.byteLength);
    let offset = 10;

    // 跳过扩展头
    const flags = view.getUint8(5);
    if (majorVersion >= 3 && (flags & 0x40)) {
      if (offset + 4 > end) return null;
      const extSize = view.getUint32(offset);
      offset += extSize;
    }

    // 遍历帧查找 APIC
    while (offset + 10 < end) {
      const frameId = String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1),
        view.getUint8(offset + 2), view.getUint8(offset + 3)
      );

      if (frameId === '\0\0\0\0') break; // 填充区

      let frameSize: number;
      if (majorVersion >= 4) {
        // ID3v2.4: syncsafe integer
        frameSize =
          ((view.getUint8(offset + 4) & 0x7f) << 21) |
          ((view.getUint8(offset + 5) & 0x7f) << 14) |
          ((view.getUint8(offset + 6) & 0x7f) << 7) |
          (view.getUint8(offset + 7) & 0x7f);
      } else {
        // ID3v2.3: regular integer
        frameSize = view.getUint32(offset + 4);
      }

      if (frameSize <= 0 || offset + 10 + frameSize > end) break;

      if (frameId === 'APIC') {
        const frameData = new Uint8Array(buffer, offset + 10, frameSize);
        const encoding = frameData[0];
        let pos = 1;

        // 读取 MIME type（null-terminated ASCII）
        let mimeType = '';
        while (pos < frameData.length && frameData[pos] !== 0) {
          mimeType += String.fromCharCode(frameData[pos]);
          pos++;
        }
        pos++; // 跳过 null terminator

        // 跳过 picture type (1 byte)
        pos++;

        // 跳过 description（null-terminated，编码决定终止符宽度）
        if (encoding === 1 || encoding === 2) {
          // UTF-16: 双字节 null terminator
          while (pos + 1 < frameData.length && !(frameData[pos] === 0 && frameData[pos + 1] === 0)) {
            pos += 2;
          }
          pos += 2;
        } else {
          // Latin-1 / UTF-8: 单字节 null terminator
          while (pos < frameData.length && frameData[pos] !== 0) {
            pos++;
          }
          pos++;
        }

        if (pos < frameData.length) {
          const imageData = frameData.slice(pos);
          const resolvedMime = mimeType || 'image/jpeg';
          return new Blob([imageData], { type: resolvedMime });
        }
      }

      offset += 10 + frameSize;
    }

    return null;
  } catch {
    return null;
  }
}
