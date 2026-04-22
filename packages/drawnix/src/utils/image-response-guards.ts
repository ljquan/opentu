const BLOCKED_IMAGE_MARKERS = [
  'PROHIBITED_CONTENT',
  'prompt_blocked',
  'blocked by Google Gemini',
];

function containsBlockedMarker(value: string): boolean {
  return BLOCKED_IMAGE_MARKERS.some((marker) => value.includes(marker));
}

function collectCandidateStrings(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCandidateStrings(item));
  }

  if (typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates: string[] = [];
  const relevantKeys = [
    'revised_prompt',
    'message',
    'error',
    'reason',
    'code',
    'status',
    'detail',
    'text',
  ];

  for (const key of relevantKeys) {
    const fieldValue = record[key];
    if (typeof fieldValue === 'string' && fieldValue) {
      candidates.push(fieldValue);
    }
  }

  if (Array.isArray(record.data)) {
    candidates.push(...collectCandidateStrings(record.data));
  }

  return candidates;
}

export function getBlockedImageErrorMessage(value: unknown): string | undefined {
  const candidates = collectCandidateStrings(value);
  if (candidates.some((candidate) => containsBlockedMarker(candidate))) {
    return '内容被拒绝：包含违禁内容';
  }

  return undefined;
}
