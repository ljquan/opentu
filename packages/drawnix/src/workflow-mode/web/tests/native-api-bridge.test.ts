import { afterEach, describe, expect, it, vi } from "vitest";
import { requestNative } from "../src/services/api/opentu";
import { defaultConfig } from "../src/stores/use-config-store";
import { generateNative } from "../../host/native-generation";
import { cancelNativeRequests, executeNative } from "../../host/native-runtime";
import type { GenerationRequest, GenerationResult } from "../../shared/generation-bridge";

vi.mock("../../host/native-generation", () => ({ generateNative: vi.fn() }));
const config = {
    ...defaultConfig, model: "native::music",
    channels: [{ id: "native", name: "Native", opentuProfileId: "profile", baseUrl: "", apiKey: "", apiFormat: "openai" as const, models: [{ name: "music", capability: "audio" as const, parameters: [], referenceInputs: {} }] }],
};
const textConfig = { ...config, model: "native::gpt-5.5", channels: [{ ...config.channels[0], models: [{ name: "gpt-5.5", capability: "text" as const, parameters: [], referenceInputs: {} }] }] };
const textRequest = { capability: "text" as const, prompt: "hello", images: [] };
const audioRequest = { capability: "audio" as const, prompt: "music", images: [] };
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe("direct native generation", () => {
    it("passes the exact channel/model and waits for long-running text without a bridge timeout", async () => {
        vi.useFakeTimers();
        let complete!: (result: GenerationResult) => void;
        vi.mocked(generateNative).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const promise = requestNative(textConfig, textConfig.model, textRequest);
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(generateNative).toHaveBeenCalledOnce();
        expect(generateNative).toHaveBeenCalledWith({ ...textRequest, channelId: "native", model: "gpt-5.5" }, expect.any(AbortSignal));
        complete({ resultKind: "text", text: "late" });
        await expect(promise).resolves.toEqual({ resultKind: "text", text: "late" });
        expect(vi.getTimerCount()).toBe(0);
    });
    it("accepts lyrics and rejects empty or mismatched results", async () => {
        vi.mocked(generateNative).mockResolvedValueOnce({ resultKind: "lyrics", text: "Verse" });
        await expect(requestNative(config, config.model, audioRequest)).resolves.toEqual({ resultKind: "lyrics", text: "Verse" });
        vi.mocked(generateNative).mockResolvedValueOnce({ resultKind: "text", text: " " });
        await expect(requestNative(textConfig, textConfig.model, textRequest)).rejects.toThrow("有效生成结果");
        vi.mocked(generateNative).mockResolvedValueOnce({ resultKind: "video", urls: ["https://example.test/v.mp4"] });
        await expect(requestNative(config, config.model, audioRequest)).rejects.toThrow("有效生成结果");
    });
    it.each(["signal", "mode-exit"])("cancels on %s and ignores late results", async (source) => {
        let complete!: (result: GenerationResult) => void;
        let runningSignal!: AbortSignal;
        vi.mocked(generateNative).mockImplementationOnce((_request, signal) => {
            runningSignal = signal;
            return new Promise(resolve => { complete = resolve; });
        });
        const controller = new AbortController();
        const promise = requestNative(config, config.model, audioRequest, controller.signal);
        const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
        if (source === "signal") controller.abort();
        else if (source === "pagehide") window.dispatchEvent(new Event("pagehide"));
        else cancelNativeRequests();
        complete({ resultKind: "audio", urls: ["https://example.test/a.mp3"] });
        await rejected;
        expect(runningSignal.aborted).toBe(true);
    });
    it("does not mistake pagehide for an explicit cancellation", async () => {
        vi.mocked(generateNative).mockResolvedValue({ resultKind: "audio", urls: ["https://example.test/a.mp3"] });
        const promise = requestNative(config, config.model, audioRequest);
        window.dispatchEvent(new Event("pagehide"));
        await expect(promise).resolves.toMatchObject({ resultKind: "audio" });
    });
    it("does not start pre-cancelled, invalid or unsupported requests", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(requestNative(config, config.model, audioRequest, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        await expect(executeNative({ ...textRequest, channelId: "native", model: "m", images: null } as unknown as GenerationRequest)).rejects.toThrow("生成参数无效");
        await expect(requestNative(config, config.model, { ...audioRequest, videos: ["https://example.test/v.mp4"] })).rejects.toThrow("videos");
        expect(generateNative).not.toHaveBeenCalled();
    });
    it("redacts text errors and does not expose media request details", async () => {
        vi.mocked(generateNative).mockRejectedValueOnce(new Error("HTTP 403: model unavailable sk-secret"));
        await expect(requestNative(textConfig, textConfig.model, textRequest)).rejects.toThrow("HTTP 403: model unavailable [redacted]");
        vi.mocked(generateNative).mockRejectedValueOnce(new Error("secret request"));
        await expect(requestNative(config, config.model, audioRequest)).rejects.toThrow("OpenTu 生成失败，请检查渠道模型绑定、额度和请求参数。");
    });
    it("removes cancellation listeners once a request completes", async () => {
        const controller = new AbortController();
        let runningSignal!: AbortSignal;
        vi.mocked(generateNative).mockImplementationOnce(async (_request, signal) => {
            runningSignal = signal;
            return { resultKind: "audio", urls: ["https://example.test/a.mp3"] };
        });
        await requestNative(config, config.model, audioRequest, controller.signal);
        controller.abort();
        window.dispatchEvent(new Event("pagehide"));
        expect(runningSignal.aborted).toBe(false);
    });
});
