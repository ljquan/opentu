import {
  DEFAULT_TTS_SETTINGS,
  inferSpeechLanguage,
  markdownToPlainText,
} from '../hooks/useTextToSpeech';
import { ttsSettings } from '../utils/settings-manager';

export interface ReadingPlaybackOrigin {
  kind: 'kb-note' | 'card';
  id: string;
  boardId?: string;
}

export interface ReadingSubtitleSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  charStart: number;
  charEnd: number;
}

export interface ReadingPlaybackSource {
  elementId: string;
  readingSourceId: string;
  title: string;
  plainText: string;
  segments: ReadingSubtitleSegment[];
  preferredLanguage: string;
  previewImageUrl?: string;
  origin: ReadingPlaybackOrigin;
}

export interface CreateReadingPlaybackSourceOptions {
  elementId: string;
  title?: string;
  content: string;
  origin: ReadingPlaybackOrigin;
  previewImageUrl?: string;
  preferredLanguage?: string;
}

function normalizeReadingText(content: string): string {
  return markdownToPlainText(content)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const normalized = paragraph.trim();
  if (!normalized) {
    return [];
  }

  const coarseSegments = normalized
    .split(/(?<=[。！？!?；;])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  return coarseSegments.flatMap((segment) => {
    if (segment.length <= 56) {
      return [segment];
    }

    return segment
      .split(/(?<=[，、,:：])/u)
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => {
        if (part.length <= 56) {
          return [part];
        }

        const chunks: string[] = [];
        for (let index = 0; index < part.length; index += 56) {
          chunks.push(part.slice(index, index + 56).trim());
        }
        return chunks.filter(Boolean);
      });
  });
}

function estimateSegmentDurationMs(text: string, rate: number): number {
  // The player exposes up to 10x for long notes. Keep subtitle timing aligned
  // with the actual speech rate instead of flattening all speeds above 2x.
  const normalizedRate = Math.max(0.5, Math.min(rate || 1, 10));
  const cjkCount = (text.match(/[\u4e00-\u9fff]/gu) || []).length;
  const latinWordCount = (text.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) || []).length;
  const digitCount = (text.match(/\d/g) || []).length;
  const punctuationCount = (text.match(/[，。！？!?；;、,:：]/gu) || []).length;
  const otherCount = Math.max(
    0,
    text.replace(/\s+/g, '').length - cjkCount - digitCount - text.replace(/[^A-Za-z]/g, '').length
  );

  const baseDuration =
    cjkCount * 210
    + latinWordCount * 320
    + digitCount * 140
    + otherCount * 90
    + punctuationCount * 180
    + 420;

  return Math.max(900, Math.min(12000, Math.round(baseDuration / normalizedRate)));
}

function hashText(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function buildReadingSubtitleSegments(
  content: string,
  rate = DEFAULT_TTS_SETTINGS.rate
): ReadingSubtitleSegment[] {
  const plainText = normalizeReadingText(content);
  if (!plainText) {
    return [];
  }

  const paragraphs = plainText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const segments = paragraphs.flatMap((paragraph) => splitParagraphIntoSentences(paragraph));
  const resolvedSegments = (segments.length > 0 ? segments : [plainText]).filter(Boolean);

  let currentOffset = 0;
  let currentTimeMs = 0;

  return resolvedSegments.map((segment, index) => {
    const normalizedSegment = segment.trim();
    const durationMs = estimateSegmentDurationMs(normalizedSegment, rate);
    const charStart = currentOffset;
    currentOffset += normalizedSegment.length;

    const next: ReadingSubtitleSegment = {
      id: `segment-${index + 1}`,
      text: normalizedSegment,
      startMs: currentTimeMs,
      endMs: currentTimeMs + durationMs,
      charStart,
      charEnd: currentOffset,
    };

    currentTimeMs += durationMs;
    return next;
  });
}

export function createReadingPlaybackSource(
  options: CreateReadingPlaybackSourceOptions
): ReadingPlaybackSource | null {
  const plainText = normalizeReadingText(options.content);
  if (!plainText) {
    return null;
  }

  const settings = {
    ...DEFAULT_TTS_SETTINGS,
    ...(ttsSettings.get() || {}),
  };
  const title = options.title?.trim() || '朗读轨道';
  const segments = buildReadingSubtitleSegments(plainText, settings.rate);
  const sourceHash = hashText(`${title}\n${plainText}`);

  return {
    elementId: options.elementId,
    readingSourceId: `${options.origin.kind}:${options.origin.id}:${sourceHash}`,
    title,
    plainText,
    segments,
    preferredLanguage: options.preferredLanguage || inferSpeechLanguage(plainText),
    previewImageUrl: options.previewImageUrl,
    origin: options.origin,
  };
}
