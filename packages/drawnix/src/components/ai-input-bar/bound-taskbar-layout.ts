const DESKTOP_TASKBAR_MAX_WIDTH = 720;
const DESKTOP_VIEWPORT_HORIZONTAL_GUTTER = 96;
const EXPANDED_TASKBAR_FALLBACK_HEIGHT = 260;
const COLLAPSED_TASKBAR_FALLBACK_HEIGHT = 76;

export function clampBoundTaskbarPosition(
  targetTop: number,
  targetBottom: number,
  estimatedHeight: number,
  viewportHeight: number,
  viewportMargin = 12,
  gap = 8,
  viewportTop = 0
): number {
  const minTop = viewportTop + viewportMargin;
  const maxTop = Math.max(
    minTop,
    viewportTop + viewportHeight - viewportMargin - estimatedHeight
  );
  const belowTop = targetBottom + gap;
  if (belowTop <= maxTop && belowTop >= minTop) return belowTop;

  const aboveTop = targetTop - estimatedHeight - gap;
  return Math.min(maxTop, Math.max(minTop, aboveTop));
}

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

export function getBoundTaskbarHeight(
  measuredHeight: number | undefined,
  expanded: boolean
): number {
  if (measuredHeight && measuredHeight > 0) {
    return measuredHeight;
  }

  return expanded
    ? EXPANDED_TASKBAR_FALLBACK_HEIGHT
    : COLLAPSED_TASKBAR_FALLBACK_HEIGHT;
}
