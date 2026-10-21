import type { ModelConfig } from '../constants/model-config';

type SortableModelConfig = ModelConfig & {
  sortOrder?: number;
};

type ModelSortOptions = {
  fallbackOrderMap?: ReadonlyMap<string, number>;
  newImageFamilies?: ReadonlySet<string>;
};

type VersionVector = number[];

const MODEL_NAME_IGNORED_TOKENS = new Set([
  'vip',
  'async',
  'hd',
  'uhd',
  'flash',
  'preview',
  'pro',
]);

const RECOMMENDED_IMAGE_IDS: readonly string[] = [
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare',
];

function getImageModelOrder(model: ModelConfig) {
  const tokens = model.id.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)*/g) || [];
  const isVersion = (token: string, index: number) =>
    /^\d/.test(token) && !/^\d{6,}$/.test(token) && tokens[index + 1] !== 'k';
  const start = tokens.findIndex(isVersion);
  const version: VersionVector = [];
  let end = start;
  if (start >= 0) {
    while (end < tokens.length && isVersion(tokens[end], end)) {
      version.push(...tokens[end].split('.').map(Number));
      end += 1;
    }
  }
  while (version.length > 1 && version[version.length - 1] === 0) version.pop();
  const familyTokens = start < 0 ? tokens : tokens.slice(0, start);
  let family = familyTokens
    .filter((token) => !MODEL_NAME_IGNORED_TOKENS.has(token) && token !== 'v')
    .join('-');
  // GPT-4o Image is a legacy family, not version 4 of GPT Image.
  if (/^gpt-\d+[a-z]-image/.test(model.id.toLowerCase()))
    family = 'gpt-image-legacy';
  const suffix = start < 0 ? [] : tokens.slice(end);
  const isVariant =
    Boolean(model.isVip) ||
    suffix.some(
      (token) =>
        token !== 'image' &&
        token !== 'images' &&
        token !== 'preview' &&
        !/^\d{6,}$/.test(token)
    );
  return { family: family || model.id.toLowerCase(), version, isVariant };
}

function getImageFamilyKey(model: ModelConfig): string {
  const { family, version } = getImageModelOrder(model);
  return JSON.stringify([
    model.sourceProfileId || '',
    model.vendor,
    family,
    version,
  ]);
}

function hasImageNewPriority(
  model: ModelConfig,
  options: ModelSortOptions
): boolean {
  return (
    model.type === 'image' &&
    (hasNewTag(model) ||
      Boolean(options.newImageFamilies?.has(getImageFamilyKey(model))))
  );
}

export function createModelDisplayComparator(
  models: readonly ModelConfig[],
  options: ModelSortOptions = {}
): (left: ModelConfig, right: ModelConfig) => number {
  const newImageFamilies = new Set(
    models
      .filter((model) => model.type === 'image' && hasNewTag(model))
      .map(getImageFamilyKey)
  );
  return (left, right) =>
    compareModelsByDisplayPriority(left, right, {
      ...options,
      newImageFamilies,
    });
}

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

function getRecommendedScore(model: ModelConfig): number | null {
  if (model.type === 'image') {
    const index = RECOMMENDED_IMAGE_IDS.indexOf(model.id);
    return index >= 0 ? RECOMMENDED_IMAGE_IDS.length - index : null;
  }
  return Number.isFinite(model.recommendedScore)
    ? Number(model.recommendedScore)
    : null;
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
  if (model.type === 'image') return getImageModelOrder(model).version;
  const source = [model.id, model.label, model.shortLabel, model.shortCode]
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

function getModelNameOrderKey(model: ModelConfig): string {
  if (model.type === 'image') return getImageModelOrder(model).family;
  const source = [model.shortLabel, model.label, model.id]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const tokens = source.match(/[a-z0-9]+(?:\.[a-z0-9]+)?/g) || [];
  const filteredTokens = tokens.filter((token) => {
    if (MODEL_NAME_IGNORED_TOKENS.has(token)) {
      return false;
    }
    if (/^\d+s$/.test(token)) {
      return false;
    }
    if (/^\d+k$/.test(token)) {
      return false;
    }
    if (/^\d{6,}$/.test(token)) {
      return false;
    }
    if (/^v?\d+(?:\.\d+)+$/.test(token)) {
      return false;
    }
    if (/^\d+$/.test(token)) {
      return false;
    }
    return true;
  });

  return filteredTokens.join(' ').trim() || source.trim();
}

function getQualityWeight(model: ModelConfig): number {
  if (model.type === 'image') return 0;
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
  if (model.type === 'image') return 0;
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

  const newImageDiff =
    Number(hasImageNewPriority(right, options)) -
    Number(hasImageNewPriority(left, options));
  if (newImageDiff !== 0) return newImageDiff;

  const leftRecommendedScore = getRecommendedScore(left);
  const rightRecommendedScore = getRecommendedScore(right);
  if (leftRecommendedScore !== null || rightRecommendedScore !== null) {
    if (leftRecommendedScore === null) return 1;
    if (rightRecommendedScore === null) return -1;
    if (leftRecommendedScore !== rightRecommendedScore) {
      return rightRecommendedScore - leftRecommendedScore;
    }
  }

  const leftIsNew = left.type !== 'image' && hasNewTag(left);
  const rightIsNew = right.type !== 'image' && hasNewTag(right);
  if (leftIsNew !== rightIsNew) {
    return leftIsNew ? -1 : 1;
  }

  const leftNameKey = getModelNameOrderKey(left);
  const rightNameKey = getModelNameOrderKey(right);
  const nameKeyDiff = leftNameKey.localeCompare(rightNameKey, 'zh-Hans-CN');
  if (nameKeyDiff !== 0) {
    return nameKeyDiff;
  }

  const versionDiff = compareVersionVectorsDesc(
    getBestVersionVector(left),
    getBestVersionVector(right)
  );
  if (versionDiff !== 0) {
    return versionDiff;
  }

  const leftVariant =
    left.type === 'image' && getImageModelOrder(left).isVariant;
  const rightVariant =
    right.type === 'image' && getImageModelOrder(right).isVariant;
  if (leftVariant !== rightVariant) return leftVariant ? 1 : -1;

  const tierDiff = getTierWeight(right) - getTierWeight(left);
  if (tierDiff !== 0) {
    return tierDiff;
  }

  const qualityDiff = getQualityWeight(right) - getQualityWeight(left);
  if (qualityDiff !== 0) {
    return qualityDiff;
  }

  const leftVip = left.type !== 'image' && Boolean(left.isVip);
  const rightVip = right.type !== 'image' && Boolean(right.isVip);
  if (leftVip !== rightVip) {
    return leftVip ? -1 : 1;
  }

  const imageNameDiff = (left.type === 'image' ? left.id : '').localeCompare(
    right.type === 'image' ? right.id : '',
    'zh-Hans-CN',
    { numeric: true }
  );
  if (imageNameDiff !== 0) return imageNameDiff;

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
  return [...models].sort(createModelDisplayComparator(models, options));
}
