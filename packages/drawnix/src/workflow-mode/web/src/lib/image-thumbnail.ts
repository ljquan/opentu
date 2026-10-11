export const CANVAS_IMAGE_PREVIEW_MAX_EDGE = 768;

type ImageSourceChoice = {
    previewUrl?: string;
    originalUrl: string;
    naturalWidth?: number;
    naturalHeight?: number;
    renderedWidth: number;
    renderedHeight: number;
    scale: number;
    devicePixelRatio?: number;
    previewMaxEdge?: number;
};

// Small previews keep panning cheap, but they look soft once the node is magnified.
// Use the original only when the on-screen size actually needs more pixels than the preview holds.
export function pickImageSource({ previewUrl, originalUrl, naturalWidth, naturalHeight, renderedWidth, renderedHeight, scale, devicePixelRatio = globalThis.devicePixelRatio || 1, previewMaxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE }: ImageSourceChoice) {
    if (!previewUrl) return originalUrl;
    const naturalLongEdge = Math.max(naturalWidth || 0, naturalHeight || 0);
    const previewLongEdge = naturalLongEdge > 0 ? Math.min(previewMaxEdge, naturalLongEdge) : previewMaxEdge;
    const requiredLongEdge = Math.max(renderedWidth, renderedHeight) * scale * devicePixelRatio;
    return requiredLongEdge > previewLongEdge ? originalUrl : previewUrl;
}

export function getThumbnailDimensions(width: number, height: number, maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function createImageThumbnail(blob: Blob, maxEdge = CANVAS_IMAGE_PREVIEW_MAX_EDGE): Promise<Blob | undefined> {
    return new Promise((resolve, reject) => {
        let expired = false;
        let bitmap: ImageBitmap | undefined;
        let canvas: HTMLCanvasElement | undefined;
        const cleanup = () => {
            bitmap?.close();
            bitmap = undefined;
            if (canvas) { canvas.width = 0; canvas.height = 0; }
        };
        const timer = window.setTimeout(() => {
            expired = true;
            cleanup();
            resolve(undefined);
        }, 10_000);
        const render = async () => {
            try {
                const decoded = await createImageBitmap(blob);
                if (expired) { decoded.close(); return undefined; }
                bitmap = decoded;
                const { width, height } = getThumbnailDimensions(bitmap.width, bitmap.height, maxEdge);
                if (width === bitmap.width && height === bitmap.height) return undefined;
                canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d");
                if (!context) return undefined;
                context.drawImage(bitmap, 0, 0, width, height);
                bitmap.close();
                bitmap = undefined;
                const outputCanvas = canvas;
                return await new Promise<Blob | undefined>(done => outputCanvas.toBlob(result => done(result || undefined), "image/webp", 0.86));
            } finally { cleanup(); }
        };
        void render().then(result => {
            window.clearTimeout(timer);
            if (!expired) resolve(result);
        }, error => {
            window.clearTimeout(timer);
            if (!expired) reject(error);
        });
    });
}
