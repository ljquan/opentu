import { computeSegmentPlan } from '../../utils/segment-plan';
import type { DurationOption } from '../../types/video.types';
import type {
  PptExplainerSpeaker,
  PptExplainerTurn,
} from './types';

export interface PptExplainerSubtitleCue {
  text: string;
  speakerName?: string;
  startSeconds: number;
  endSeconds: number;
}

export interface PptExplainerNarrationSegment {
  requestDurationSeconds: number;
  outputDurationSeconds: number;
  turns: PptExplainerTurn[];
  subtitleCues: PptExplainerSubtitleCue[];
}

const MAX_SUBTITLE_CUE_CHARS = 30;

function splitTextAtNaturalBreaks(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^。！？!?；;，,\n]+[。！？!?；;，,]?/g) || [normalized];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const value = sentence.trim();
    for (let offset = 0; offset < value.length; offset += MAX_SUBTITLE_CUE_CHARS) {
      const chunk = value.slice(offset, offset + MAX_SUBTITLE_CUE_CHARS).trim();
      if (chunk) chunks.push(chunk);
    }
  }
  return chunks;
}

function splitTurnsIntoAtoms(turns: readonly PptExplainerTurn[]) {
  return turns.flatMap((turn) =>
    splitTextAtNaturalBreaks(turn.text).map((text) => ({
      speakerId: turn.speakerId,
      text,
    }))
  );
}

function allocateOutputDurations(
  targetSeconds: number,
  requestDurations: readonly number[]
): number[] {
  let remaining = targetSeconds;
  return requestDurations.map((requestDuration) => {
    const outputDuration = Math.min(requestDuration, remaining);
    remaining -= outputDuration;
    return outputDuration;
  });
}

function allocateAtoms(
  atoms: Array<{ speakerId: string; text: string }>,
  outputDurations: readonly number[]
): PptExplainerTurn[][] {
  if (atoms.length < outputDurations.length) {
    const expanded: typeof atoms = [];
    const targetChars = Math.max(
      1,
      Math.floor(
        atoms.reduce((sum, atom) => sum + atom.text.length, 0) /
          outputDurations.length
      )
    );
    for (const atom of atoms) {
      for (let offset = 0; offset < atom.text.length; offset += targetChars) {
        const text = atom.text.slice(offset, offset + targetChars).trim();
        if (text) expanded.push({ ...atom, text });
      }
    }
    atoms = expanded;
  }
  if (atoms.length < outputDurations.length) {
    throw new Error('每页讲稿过短，无法覆盖用户指定的讲解时长');
  }

  const totalWeight = outputDurations.reduce((sum, value) => sum + value, 0);
  const totalChars = atoms.reduce((sum, atom) => sum + atom.text.length, 0);
  const result: PptExplainerTurn[][] = [];
  let atomIndex = 0;
  let consumedChars = 0;

  for (let segmentIndex = 0; segmentIndex < outputDurations.length; segmentIndex += 1) {
    const remainingSegments = outputDurations.length - segmentIndex;
    const segment: PptExplainerTurn[] = [];
    const targetChars =
      (totalChars * outputDurations[segmentIndex]) / Math.max(1, totalWeight);

    while (atomIndex < atoms.length) {
      const atom = atoms[atomIndex];
      segment.push({ ...atom });
      atomIndex += 1;
      consumedChars += atom.text.length;
      const atomsAfter = atoms.length - atomIndex;
      if (
        atomsAfter >= remainingSegments - 1 &&
        (consumedChars >= targetChars || atomsAfter === remainingSegments - 1)
      ) {
        break;
      }
    }
    result.push(segment);
    consumedChars = 0;
  }
  return result;
}

function buildSubtitleCues(
  turns: readonly PptExplainerTurn[],
  outputDurationSeconds: number,
  speakerNames: ReadonlyMap<string, string>
): PptExplainerSubtitleCue[] {
  const totalCharacters = turns.reduce(
    (sum, turn) => sum + Math.max(1, turn.text.replace(/\s/g, '').length),
    0
  );
  let cursor = 0;
  return turns.map((turn, index) => {
    const startSeconds = cursor;
    const weight = Math.max(1, turn.text.replace(/\s/g, '').length);
    cursor =
      index === turns.length - 1
        ? outputDurationSeconds
        : cursor + (outputDurationSeconds * weight) / totalCharacters;
    return {
      text: turn.text,
      speakerName: speakerNames.get(turn.speakerId) || turn.speakerId,
      startSeconds,
      endSeconds: cursor,
    };
  });
}

export function planPptExplainerSlideTimeline(options: {
  turns: readonly PptExplainerTurn[];
  speakers: readonly PptExplainerSpeaker[];
  secondsPerSlide: number;
  durationOptions: DurationOption[];
}): PptExplainerNarrationSegment[] {
  const plan = computeSegmentPlan(
    options.secondsPerSlide,
    options.durationOptions
  );
  const outputDurations = allocateOutputDurations(
    options.secondsPerSlide,
    plan.segments
  );
  const segmentTurns = allocateAtoms(
    splitTurnsIntoAtoms(options.turns),
    outputDurations
  );
  const speakerNames = new Map(
    options.speakers.map((speaker) => [speaker.id, speaker.displayName])
  );

  return plan.segments.map((requestDurationSeconds, index) => ({
    requestDurationSeconds,
    outputDurationSeconds: outputDurations[index],
    turns: segmentTurns[index],
    subtitleCues: buildSubtitleCues(
      segmentTurns[index],
      outputDurations[index],
      speakerNames
    ),
  }));
}

export const pptExplainerTimelineInternals = {
  allocateOutputDurations,
  buildSubtitleCues,
  splitTextAtNaturalBreaks,
};
