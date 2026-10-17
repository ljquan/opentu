import { DrawnixExportedData, DrawnixExportedType } from './types';

export const isValidDrawnixData = (
  data?: unknown
): data is DrawnixExportedData => {
  const record = data as Partial<DrawnixExportedData> | undefined;
  return (
    !!record &&
    record.type === DrawnixExportedType.drawnix &&
    Array.isArray(record.elements) &&
    !!record.viewport && typeof record.viewport === 'object' &&
    isValidElements(record.elements)
  );
};

function isValidElements(elements: unknown[], depth = 0): boolean {
  if (depth > 32 || elements.length > 100_000) return false;
  return elements.every((element) => {
    if (!element || typeof element !== 'object' || Array.isArray(element)) return false;
    const value = element as Record<string, unknown>;
    if (value.type !== undefined &&
      (typeof value.type !== 'string' || value.type.length > 80)) return false;
    if (value.component !== undefined &&
      (typeof value.component !== 'string' || !/^[A-Za-z0-9_.:/-]{1,160}$/.test(value.component))) return false;
    if (value.type === 'tool' && value.url !== undefined) {
      if (typeof value.url !== 'string') return false;
      try {
        if (!['http:', 'https:'].includes(new URL(value.url, 'https://opentu.invalid').protocol)) return false;
      } catch { return false; }
    }
    return !value.children || (Array.isArray(value.children) && isValidElements(value.children, depth + 1));
  });
}
