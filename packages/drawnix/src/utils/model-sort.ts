import type { ModelConfig } from '../constants/model-config';

type SortableModelConfig = ModelConfig & {
  sortOrder?: number;
};

type ModelSortOptions = {
  fallbackOrderMap?: ReadonlyMap<string, number>;
};

type VersionVector = number[];

function getModelSortKey(model: ModelConfig): string {
  return model.selectionKey || model.id;
}

function getExplicitSortOrder(model: ModelConfig): number | null {
  const sortOrder = (model as SortableModelConfig).sortOrder;
  return Number.isFinite(sortOrder) ? Number(sortOrder) : null;
}

function hasNewTag(model: ModelConfig): boolean {
  return model.tags?.includes('new') ?? false;
}

function extractVersionCandidates(text: string): VersionVector[] {
  const tokens = text.toLowerCase().match(/[a-z0-9.]+/g) || [];
  const candidates: VersionVector[] = [];
  let numericRun: number[] = [];

  const pushNumericRun = () => {
    if (numericRun.length > 0) {
      candidates.push(numericRun);
      numericRun = [];
    }
  };

  for (const token of tokens) {
    if (/^v?\d+(?:\.\d+)+$/.test(token)) {
      pushNumericRun();
      candidates.push(
        token
          .replace(/^v/, '')
          .split('.')
          .map((part) => Number(part))
      );
      continue;
    }

    if (/^\d+$/.test(token)) {
      numericRun.push(Number(token));
      continue;
    }

    const prefixedVersion = token.match(/^v(\d+)$/);
    if (prefixedVersion) {
      pushNumericRun();
      candidates.push([Number(prefixedVersion[1])]);
      continue;
    }

    const suffixedVersion = token.match(/^(\d+)(?:o|omni|mini)$/);
    if (suffixedVersion) {
      pushNumericRun();
      candidates.push([Number(suffixedVersion[1])]);
      continue;
    }

    pushNumericRun();
  }

  pushNumericRun();
  return candidates;
}

function compareVersionVectorsDesc(
  left: VersionVector,
  right: VersionVector
): number {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function getBestVersionVector(model: ModelConfig): VersionVector {
  const source = [
    model.id,
    model.label,
    model.shortLabel,
    model.shortCode,
  ]
    .filter(Boolean)
    .join(' ');

  const candidates = extractVersionCandidates(source);
  if (candidates.length === 0) {
    return [];
  }

  return candidates.reduce((best, candidate) =>
    compareVersionVectorsDesc(candidate, best) < 0 ? candidate : best
  );
}

function getQualityWeight(model: ModelConfig): number {
  const source = [
    model.id,
    model.label,
    model.shortLabel,
    model.shortCode,
    model.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(?:8k|uhd)\b/.test(source)) return 4;
  if (/\b4k\b/.test(source)) return 3;
  if (/\b2k\b/.test(source)) return 2;
  if (/\bhd\b/.test(source)) return 1;
  return 0;
}

function getTierWeight(model: ModelConfig): number {
  const source = [
    model.id,
    model.label,
    model.shortLabel,
    model.shortCode,
    model.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bpro\b/.test(source)) return 3;
  if (/\bultra\b/.test(source)) return 2;
  if (/\bmax\b/.test(source)) return 1;
  return 0;
}

export function compareModelsByDisplayPriority(
  left: ModelConfig,
  right: ModelConfig,
  options: ModelSortOptions = {}
): number {
  const leftSortOrder = getExplicitSortOrder(left);
  const rightSortOrder = getExplicitSortOrder(right);
  if (leftSortOrder !== null || rightSortOrder !== null) {
    if (leftSortOrder === null) return 1;
    if (rightSortOrder === null) return -1;
    if (leftSortOrder !== rightSortOrder) {
      return leftSortOrder - rightSortOrder;
    }
  }

  const leftIsNew = hasNewTag(left);
  const rightIsNew = hasNewTag(right);
  if (leftIsNew !== rightIsNew) {
    return leftIsNew ? -1 : 1;
  }

  const versionDiff = compareVersionVectorsDesc(
    getBestVersionVector(left),
    getBestVersionVector(right)
  );
  if (versionDiff !== 0) {
    return versionDiff;
  }

  const tierDiff = getTierWeight(right) - getTierWeight(left);
  if (tierDiff !== 0) {
    return tierDiff;
  }

  const qualityDiff = getQualityWeight(right) - getQualityWeight(left);
  if (qualityDiff !== 0) {
    return qualityDiff;
  }

  if (left.isVip !== right.isVip) {
    return left.isVip ? -1 : 1;
  }

  const fallbackOrderMap = options.fallbackOrderMap;
  if (fallbackOrderMap) {
    const leftIndex = fallbackOrderMap.get(getModelSortKey(left));
    const rightIndex = fallbackOrderMap.get(getModelSortKey(right));
    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
    }
  }

  const leftName = (left.shortLabel || left.label || left.id).toLowerCase();
  const rightName = (right.shortLabel || right.label || right.id).toLowerCase();
  return leftName.localeCompare(rightName, 'zh-Hans-CN');
}

export function sortModelsByDisplayPriority(
  models: ModelConfig[],
  options: ModelSortOptions = {}
): ModelConfig[] {
  return [...models].sort((left, right) =>
    compareModelsByDisplayPriority(left, right, options)
  );
}
