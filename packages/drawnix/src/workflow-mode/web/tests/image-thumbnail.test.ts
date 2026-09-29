import { expect, test } from "bun:test";

import { pickImageSource } from "../src/lib/image-thumbnail";

const base = {
    previewUrl: "data:image/webp;base64,preview",
    originalUrl: "data:image/png;base64,original",
    naturalWidth: 4000,
    naturalHeight: 3000,
    renderedWidth: 420,
    renderedHeight: 315,
};

test("uses the preview while it has enough pixels for the rendered size", () => {
    expect(pickImageSource({ ...base, scale: 1, devicePixelRatio: 1 })).toBe(base.previewUrl);
});

test("falls back to the original once the rendered size outgrows the preview", () => {
    expect(pickImageSource({ ...base, scale: 3, devicePixelRatio: 2 })).toBe(base.originalUrl);
});

test("uses the original when no preview exists", () => {
    expect(pickImageSource({ ...base, previewUrl: undefined, scale: 1, devicePixelRatio: 1 })).toBe(base.originalUrl);
});
