import { describe, expect, it, vi } from "vitest";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { buildLog as buildImageLog, normalizeLogConfig as normalizeImageLogConfig } from "../src/pages/image";
import { buildLog as buildVideoLog, buildVideoConfig, normalizeLog as normalizeVideoLog, serializeLog as serializeVideoLog } from "../src/pages/video";
import { nativeImageCount, singleImageConfig, getNativeParameterValues } from "../src/integration/native-parameters";

vi.mock("../src/services/file-storage", () => ({ resolveMediaUrl: vi.fn(async (key, fallback) => key ? `blob:restored-${key}` : fallback), deleteStoredMedia: vi.fn(), uploadMediaFile: vi.fn() }));
vi.mock("../src/services/image-storage", () => ({ resolveImageUrl: vi.fn(async (_key, fallback) => fallback), ensureImagePreview: vi.fn(), subscribeImagePreviews: vi.fn(() => () => {}), getImagePreviewRevision: vi.fn(() => 0), previewUrlFor: vi.fn(), uploadImage: vi.fn(), deleteStoredImages: vi.fn() }));

const imageModel = "native::image";
const videoModel = "native::video";
const config: AiConfig = {
    ...defaultConfig, model: imageModel, imageModel, videoModel, size: "2K", vquality: "768P", videoSeconds: "15", count: "9",
    nativeParams: JSON.stringify({ [`image::${imageModel}`]: { n: 3 }, [`video::${videoModel}`]: { size: "2K", duration: 15 } }),
    channels: [{ id: "native", name: "Native", opentuProfileId: null, baseUrl: "", apiKey: "", apiFormat: "openai", models: [
        { name: "image", capability: "image", parameters: [{ id: "n", label: "数量", valueType: "number", min: 1, max: 10, defaultValue: 1 }] },
        { name: "video", capability: "video", parameters: [{ id: "size", label: "分辨率", valueType: "string", defaultValue: "768P" }, { id: "duration", label: "时长", valueType: "number", defaultValue: 5 }] },
    ] }],
};

describe("native workbench snapshots", () => {
    it("uses native image count once while preserving the complete log parameters", () => {
        const count = nativeImageCount(config);
        expect(count).toBe(3);
        const requests = Array.from({ length: count! }, () => singleImageConfig(config));
        expect(requests.map((request) => getNativeParameterValues(request, imageModel, "image").n)).toEqual([1, 1, 1]);
        const log = buildImageLog({ prompt: "image", model: imageModel, config: { ...config, count: String(count) }, references: [], durationMs: 1, successCount: 3, failCount: 0, status: "success", images: [] });
        const restored = normalizeImageLogConfig(JSON.parse(JSON.stringify(log)));
        expect(restored.nativeParams).toBe(config.nativeParams);
        expect(restored.model).toBe(imageModel);
        expect(restored.count).toBe("3");
    });

    it("keeps the selected video identity and raw settings instead of normalizing another model", () => {
        const snapshot = buildVideoConfig(config, videoModel);
        expect(snapshot).toMatchObject({ model: videoModel, videoModel, size: "2K", vquality: "768P", videoSeconds: "15", nativeParams: config.nativeParams });
        expect(getNativeParameterValues(snapshot, videoModel, "video")).toEqual({ size: "2K", duration: 15 });
    });

    it("round-trips video parameters, summary and all reference media in order", async () => {
        const snapshot = buildVideoConfig(config, videoModel);
        const log = buildVideoLog({
            prompt: "video", model: videoModel, config: snapshot, references: [], durationMs: 0, status: "pending",
            referenceVideos: [{ id: "v1", name: "one.mp4", type: "video/mp4", url: "blob:old-video", storageKey: "video:one" }],
            referenceAudios: [{ id: "a1", name: "one.mp3", type: "audio/mpeg", url: "blob:old-audio", storageKey: "audio:one" }, { id: "a2", name: "two.mp3", type: "audio/mpeg", url: "https://example.test/two.mp3" }],
        });
        const serialized = serializeVideoLog(log);
        expect(serialized.referenceVideos?.[0].url).toBe("");
        expect(serialized.referenceAudios?.[1].url).toBe("https://example.test/two.mp3");
        const restored = await normalizeVideoLog(JSON.parse(JSON.stringify(serialized)));
        expect(restored.config.nativeParams).toBe(config.nativeParams);
        expect(restored.resolution).toBe("768P");
        expect(restored.parameterSummary).toContain("2K");
        expect(restored.referenceVideos?.[0].url).toBe("blob:restored-video:one");
        expect(restored.referenceAudios?.map((item) => item.id)).toEqual(["a1", "a2"]);
        expect(restored.referenceAudios?.[0].url).toBe("blob:restored-audio:one");
    });

    it("keeps custom video scripts on their existing normalization path", () => {
        const scripted = { ...config, channels: config.channels.map((channel) => ({ ...channel, models: channel.models.map((model) => ({ ...model, script: "return {}" })) })) };
        const snapshot = buildVideoConfig(scripted, videoModel);
        expect(snapshot.vquality).not.toBe("768P");
        expect(snapshot.model).toBe(videoModel);
    });
});
