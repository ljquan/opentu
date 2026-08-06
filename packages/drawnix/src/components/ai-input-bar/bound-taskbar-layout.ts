const DESKTOP_TASKBAR_MAX_WIDTH = 720;
const DESKTOP_VIEWPORT_HORIZONTAL_GUTTER = 96;

export function getBoundTaskbarWidth(
  measuredWidth: number | undefined,
  viewportWidth: number
): number {
  if (measuredWidth && measuredWidth > 0) {
    return measuredWidth;
  }

  return Math.max(
    0,
    Math.min(
      DESKTOP_TASKBAR_MAX_WIDTH,
      viewportWidth - DESKTOP_VIEWPORT_HORIZONTAL_GUTTER
    )
  );
}
