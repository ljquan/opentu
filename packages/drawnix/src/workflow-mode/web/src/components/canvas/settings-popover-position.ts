type SettingsPopoverPlacement = 'topLeft' | 'top' | 'topRight' | 'bottomLeft' | 'bottom' | 'bottomRight';

type AnchorRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width'>;

export function settingsPopoverPosition(
    anchor: AnchorRect,
    placement: SettingsPopoverPlacement | undefined,
    viewportWidth: number,
    viewportHeight: number,
) {
    const horizontalMargin = Math.min(12, viewportWidth / 2);
    const verticalMargin = Math.min(12, viewportHeight / 2);
    const gap = 8;
    const width = Math.max(0, Math.min(356, viewportWidth - horizontalMargin * 2));
    const alignment = placement ?? 'topLeft';
    const alignedLeft = alignment === 'top' || alignment === 'bottom'
        ? anchor.left + anchor.width / 2 - width / 2
        : alignment.endsWith('Right') ? anchor.right - width : anchor.left;
    const left = Math.max(horizontalMargin, Math.min(viewportWidth - width - horizontalMargin, alignedLeft));
    const above = anchor.top - gap - verticalMargin;
    const below = viewportHeight - anchor.bottom - gap - verticalMargin;
    let useTop = alignment.startsWith('top');

    // Prefer the requested side unless a constrained panel gains room by flipping.
    const requestedSpace = useTop ? above : below;
    const otherSpace = useTop ? below : above;
    if (requestedSpace < 320 && otherSpace > requestedSpace) useTop = !useTop;

    const offset = Math.max(verticalMargin, Math.min(
        viewportHeight - verticalMargin,
        useTop ? viewportHeight - anchor.top + gap : anchor.bottom + gap,
    ));
    const maxHeight = Math.max(0, viewportHeight - offset - verticalMargin);
    return useTop
        ? { width, left, bottom: offset, maxHeight }
        : { width, left, top: offset, maxHeight };
}
