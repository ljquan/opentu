import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, resolveModelChannel, resolveModelScript, type AiConfig, type ModelCapability } from "../src/stores/use-config-store";
import { requestGeneration, requestImageQuestion } from "../src/services/api/image";
import { createVideoGenerationTask } from "../src/services/api/video";
import { requestAudioGeneration, storeGeneratedAudioResult } from "../src/services/api/audio";
import { isNativeResult, requestNative } from "../src/services/api/opentu";
import { runModelPlugin } from "../src/services/api/model-plugin";
import { uploadMediaFile } from "../src/services/file-storage";
import { audioResultNodes } from "../src/lib/canvas/canvas-audio-results";
import { CanvasNodeType } from "../src/types/canvas";
import type { NativeParameter } from "../../shared/native-parameters";

vi.mock("../src/services/api/opentu", async (original) => ({ ...await original<object>(), requestNative: vi.fn() }));
vi.mock("../src/services/api/model-plugin", () => ({ runModelPlugin: vi.fn(), normalizePluginImages: vi.fn() }));
vi.mock("../src/services/image-storage", () => ({ imageToDataUrl: vi.fn(async (image) => image.dataUrl) }));
vi.mock("../src/services/file-storage", () => ({ uploadMediaFile: vi.fn(), getMediaBlob: vi.fn(), resolveMediaUrl: vi.fn() }));

function configFor(capability: ModelCapability, parameters: NativeParameter[], values: Record<string, string | number | boolean> = {}): AiConfig {
    return {
        ...defaultConfig, model: "native::model", systemPrompt: "", nativeParams: JSON.stringify({ [`${capability}::native::model`]: values }),
        channels: [{ id: "native", name: "Native", opentuProfileId: "profile", baseUrl: "", apiKey: "", apiFormat: "openai", models: [{ name: "model", capability, parameters }] }],
    };
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("native API execution", () => {
    it("preserves native image dimensions and quality without pixel normalization", async () => {
        const config = configFor("image", [
            { id: "size", label: "Size", valueType: "string", defaultValue: "adaptive" },
            { id: "quality", label: "Quality", valueType: "string", defaultValue: "2K" },
        ]);
        vi.mocked(requestNative).mockResolvedValue({ resultKind: "image", urls: ["https://example.test/a.png", "https://example.test/b.png"] });
        const result = await requestGeneration(config, "image");
        expect(requestNative).toHaveBeenCalledWith(config, "native::model", { capability: "image", prompt: "image", images: [], params: { size: "adaptive", quality: "2K" } }, undefined);
        expect(result).toHaveLength(2);
    });

    it("preserves MiniMax resolution, duration, ratio and API version", async () => {
        const values = { resolution: "768P", duration: 15, ratio: "16:9", api_version: "V2" };
        const parameters = Object.entries(values).map(([id, defaultValue]) => ({ id, label: id, valueType: typeof defaultValue === "number" ? "number" as const : "string" as const, defaultValue }));
        const config = configFor("video", parameters);
        config.channels[0].models[0].referenceInputs = { videos: { formats: ["url"] }, audios: { formats: ["url", "data", "asset"] } };
        vi.mocked(requestNative).mockResolvedValue({ resultKind: "video", urls: ["https://example.test/v.mp4"] });
        await createVideoGenerationTask(config, "video", [], { videos: [{ id: "v", name: "v.mp4", type: "video/mp4", url: "https://example.test/ref.mp4" }], audios: [{ id: "a", name: "a.mp3", type: "audio/mpeg", url: "https://example.test/ref.mp3" }] });
        expect(requestNative).toHaveBeenCalledWith(config, "native::model", { capability: "video", prompt: "video", images: [], videos: ["https://example.test/ref.mp4"], audios: ["https://example.test/ref.mp3"], params: values }, undefined);
    });

    it("preserves system instructions, user and assistant history, images and sampling settings", async () => {
        const config = { ...configFor("text", [{ id: "temperature", label: "Temperature", valueType: "number", defaultValue: 0.2 }]), systemPrompt: "Be precise" };
        vi.mocked(requestNative).mockResolvedValue({ resultKind: "text", text: "Answer" });
        const onDelta = vi.fn();
        await requestImageQuestion(config, [{ role: "user", content: "First" }, { role: "assistant", content: "Previous" }, { role: "user", content: [{ type: "text", text: "Next" }, { type: "image_url", image_url: { url: "https://example.test/ref.png" } }] }], onDelta);
        expect(requestNative).toHaveBeenCalledWith(config, "native::model", {
            capability: "text", prompt: "Next", images: ["https://example.test/ref.png"], params: { temperature: 0.2 },
            messages: [{ role: "system", content: "Be precise" }, { role: "user", content: "First" }, { role: "assistant", content: "Previous" }, { role: "user", content: "Next" }],
        }, undefined);
        expect(onDelta).toHaveBeenCalledWith("Answer");
    });

    it("rejects invalid explicit values before dispatch", async () => {
        const config = configFor("video", [{ id: "duration", label: "Duration", valueType: "number", min: 4, max: 15 }], { duration: 20 });
        await expect(createVideoGenerationTask(config, "video")).rejects.toThrow("Duration");
        expect(requestNative).not.toHaveBeenCalled();
    });

    it("keeps custom model scripts ahead of native dispatch", async () => {
        const config = configFor("text", []);
        config.channels[0].apiKey = "test";
        config.channels[0].baseUrl = "https://example.test";
        config.channels[0].models[0].script = "return 'script result'";
        vi.mocked(runModelPlugin).mockResolvedValue("script result");
        expect(await requestImageQuestion(config, [{ role: "user", content: "Prompt" }], vi.fn())).toBe("script result");
        expect(requestNative).not.toHaveBeenCalled();
        expect(runModelPlugin).toHaveBeenCalled();
    });

    it("does not let a same-name text script override native image generation", async () => {
        const config = configFor("image", []);
        config.channels[0].models.unshift({ name: "model", capability: "text", script: "return 'text'", parameters: [] });
        vi.mocked(requestNative).mockResolvedValue({ resultKind: "image", urls: ["https://example.test/image.png"] });
        await requestGeneration(config, "image");
        expect(requestNative).toHaveBeenCalledWith(config, "native::model", expect.objectContaining({ capability: "image" }), undefined);
        expect(runModelPlugin).not.toHaveBeenCalled();
        expect(resolveModelScript(config, "native::model", "text")).toBe("return 'text'");
        expect(resolveModelScript(config, "native::model", "image")).toBe("");
    });

    it("resolves an unqualified same-name model in the channel matching its capability", () => {
        const config = configFor("image", []);
        config.channels.unshift({ ...config.channels[0], id: "text", models: [{ name: "model", capability: "text", script: "return 'text'" }] });
        expect(resolveModelChannel(config, "model", "image").id).toBe("native");
        expect(resolveModelChannel(config, "model", "text").id).toBe("text");
    });

    it("rejects local reference videos for a URL-only model before dispatch", async () => {
        const config = configFor("video", []);
        config.channels[0].models[0].referenceInputs = { videos: { formats: ["url"] } };
        await expect(createVideoGenerationTask(config, "video", [], { videos: [{ id: "v", name: "local.mp4", type: "video/mp4", url: "blob:local", storageKey: "video:local" }] })).rejects.toThrow("格式");
        expect(requestNative).not.toHaveBeenCalled();
    });

    it("preserves supported asset audio identifiers", async () => {
        const config = configFor("video", []);
        config.channels[0].models[0].referenceInputs = { audios: { formats: ["url", "data", "asset"] } };
        vi.mocked(requestNative).mockResolvedValue({ resultKind: "video", urls: ["https://example.test/v.mp4"] });
        await createVideoGenerationTask(config, "video", [], { audios: [{ id: "a", name: "asset", type: "audio/mpeg", url: "asset://audio-123" }] });
        expect(requestNative).toHaveBeenCalledWith(config, "native::model", expect.objectContaining({ audios: ["asset://audio-123"] }), undefined);
    });
});

describe("audio and lyrics results", () => {
    it("returns lyrics without attempting an audio download", async () => {
        const config = configFor("audio", []);
        vi.mocked(requestNative).mockResolvedValue({ resultKind: "lyrics", text: "Verse\nChorus" });
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect(await storeGeneratedAudioResult(await requestAudioGeneration(config, "lyrics"))).toEqual({ kind: "lyrics", text: "Verse\nChorus" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("stores every native clip in original order", async () => {
        const config = configFor("audio", []);
        vi.mocked(requestNative).mockResolvedValue({ resultKind: "audio", urls: ["https://example.test/one.mp3", "https://example.test/two.mp3"] });
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["audio"], { type: "audio/mpeg" }) })));
        vi.mocked(uploadMediaFile).mockResolvedValueOnce({ url: "blob:one", storageKey: "audio:one", bytes: 5, mimeType: "audio/mpeg" }).mockResolvedValueOnce({ url: "blob:two", storageKey: "audio:two", bytes: 5, mimeType: "audio/mpeg" });
        const result = await storeGeneratedAudioResult(await requestAudioGeneration(config, "music"));
        expect(result.kind).toBe("audio");
        if (result.kind === "audio") expect(result.clips.map((clip) => clip.storageKey)).toEqual(["audio:one", "audio:two"]);
    });

    it("creates separate audio nodes and a text node for lyrics while preserving retry settings", () => {
        const config = configFor("audio", []);
        const node = { id: "target", type: CanvasNodeType.Audio, title: "Music", position: { x: 100, y: 100 }, width: 320, height: 120 };
        const clips = ["one", "two"].map((name) => ({ url: `blob:${name}`, storageKey: `audio:${name}`, bytes: 5, mimeType: "audio/mpeg" }));
        const nodes = audioResultNodes(node, { kind: "audio", clips }, config, "music");
        expect(nodes).toHaveLength(2);
        expect(nodes[0].id).toBe("target");
        expect(nodes[1].id).not.toBe("target");
        expect(nodes.map((item) => item.metadata?.content)).toEqual(["blob:one", "blob:two"]);
        expect(nodes[1].position.y).toBeGreaterThan(nodes[0].position.y + nodes[0].height);
        const [lyrics] = audioResultNodes(node, { kind: "lyrics", text: "Verse" }, config, "lyrics");
        expect(lyrics.type).toBe(CanvasNodeType.Text);
        expect(lyrics.metadata).toMatchObject({ content: "Verse", generationMode: "audio", model: config.model, nativeParams: config.nativeParams, status: "success" });
    });

    it("rejects canceled downloads instead of retaining a remote fallback", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(storeGeneratedAudioResult({ kind: "audio", clips: ["https://example.test/a.mp3"] }, "mp3", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });

    it("preserves a playable remote clip when cross-origin downloading is blocked", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
        expect(await storeGeneratedAudioResult({ kind: "audio", clips: ["https://example.test/a.mp3"] })).toMatchObject({ kind: "audio", clips: [{ url: "https://example.test/a.mp3", storageKey: "" }] });
    });

    it("does not turn a provider HTTP error into a successful audio node", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        await expect(storeGeneratedAudioResult({ kind: "audio", clips: ["https://example.test/missing.mp3"] })).rejects.toThrow();
        expect(uploadMediaFile).not.toHaveBeenCalled();
    });

    it("validates result kind and every clip URL", () => {
        expect(isNativeResult({ resultKind: "lyrics", text: "Verse" }, "audio")).toBe(true);
        expect(isNativeResult({ resultKind: "lyrics", text: "Verse" }, "video")).toBe(false);
        expect(isNativeResult({ resultKind: "image", urls: ["https://example.test/a.png"] }, "audio")).toBe(false);
        expect(isNativeResult({ resultKind: "audio", urls: ["https://example.test/a.mp3", "javascript:void(0)"] }, "audio")).toBe(false);
    });
});
