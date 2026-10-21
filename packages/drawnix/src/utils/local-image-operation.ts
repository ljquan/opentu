export interface LocalImageOperationDetails {
  type: 'resize';
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  algorithm: 'high' | 'bilinear' | 'nearest';
  createdAt: number;
  sourcePrompt?: string;
}

/** Project only supported local processing fields into persisted image metadata. */
export function readLocalImageOperation(
  value: unknown
): LocalImageOperationDetails | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'resize' ||
    ![
      record.sourceWidth,
      record.sourceHeight,
      record.outputWidth,
      record.outputHeight,
    ].every(
      (dimension) =>
        typeof dimension === 'number' &&
        Number.isInteger(dimension) &&
        dimension > 0
    ) ||
    typeof record.createdAt !== 'number' ||
    !Number.isFinite(record.createdAt) ||
    record.createdAt <= 0 ||
    !['high', 'bilinear', 'nearest'].includes(String(record.algorithm))
  )
    return undefined;
  return {
    type: 'resize',
    sourceWidth: record.sourceWidth as number,
    sourceHeight: record.sourceHeight as number,
    outputWidth: record.outputWidth as number,
    outputHeight: record.outputHeight as number,
    algorithm: record.algorithm as LocalImageOperationDetails['algorithm'],
    createdAt: record.createdAt,
    ...(typeof record.sourcePrompt === 'string' && record.sourcePrompt.trim()
      ? { sourcePrompt: record.sourcePrompt.trim() }
      : {}),
  };
}
