/** Shared provider diagnostics; image exports remain compatible with existing callers. */
export {
  createImageApiError as createGenerationApiError,
  readImageApiError as readGenerationApiError,
  toImageTaskError as toGenerationTaskError,
  getImageFailureDetails as getGenerationFailureDetails,
  extractImageErrorDiagnostics as extractGenerationErrorDiagnostics,
} from './image-error-details';
export type { ImageErrorDiagnostics as GenerationErrorDiagnostics } from './image-error-details';

/** Match the visible fields, with indented continuation lines for multiline errors. */
export function formatGenerationErrorReport(
  rows: readonly (readonly [string, string])[]
): string {
  return rows
    .map(
      ([label, value]) =>
        `${label}：${value.replace(/\r\n?/g, '\n').replace(/\n/g, '\n  ')}`
    )
    .join('\n');
}
