import { describe, expect, it } from 'vitest';
import { settingsPopoverPosition } from '../src/components/canvas/settings-popover-position';

describe('settings popover viewport positioning', () => {
    it('keeps a requested top-right anchor when space is available', () => {
        expect(settingsPopoverPosition({ left: 600, right: 800, top: 500, bottom: 532, width: 200 }, 'topRight', 1024, 768)).toEqual({ width: 356, left: 444, bottom: 276, maxHeight: 480 });
    });

    it('moves a top popover below an anchor near the top edge', () => {
        expect(settingsPopoverPosition({ left: 20, right: 220, top: 50, bottom: 82, width: 200 }, 'topLeft', 1024, 768)).toEqual({ width: 356, left: 20, top: 90, maxHeight: 666 });
    });

    it('moves a bottom popover above an anchor near the bottom edge', () => {
        expect(settingsPopoverPosition({ left: 20, right: 220, top: 660, bottom: 692, width: 200 }, 'bottomLeft', 1024, 768)).toEqual({ width: 356, left: 20, bottom: 116, maxHeight: 640 });
    });

    it('fits narrow mobile viewports and clamps centered alignment', () => {
        expect(settingsPopoverPosition({ left: 260, right: 310, top: 300, bottom: 332, width: 50 }, 'top', 320, 640)).toEqual({ width: 296, left: 12, top: 340, maxHeight: 288 });
    });

    it('does not force a minimum height in a short viewport', () => {
        const result = settingsPopoverPosition({ left: 20, right: 100, top: 90, bottom: 122, width: 80 }, 'topLeft', 320, 200);
        expect(result).toEqual({ width: 296, left: 12, bottom: 118, maxHeight: 70 });
    });

    it('keeps an offscreen anchor from positioning the panel outside the viewport', () => {
        const result = settingsPopoverPosition({ left: -100, right: -20, top: -80, bottom: -48, width: 80 }, 'topLeft', 320, 640);
        expect(result).toEqual({ width: 296, left: 12, top: 12, maxHeight: 616 });
    });
});
