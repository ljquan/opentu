import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestNative } from "../src/services/api/opentu";
import { defaultConfig } from "../src/stores/use-config-store";
import { GENERATE_CANCEL, GENERATE_RESPONSE } from "../../shared/generation-bridge";

const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent")!;
const host = { postMessage: vi.fn() };
const config = {
    ...defaultConfig, model: "native::music",
    channels: [{ id: "native", name: "Native", opentuProfileId: "profile", baseUrl: "", apiKey: "", apiFormat: "openai" as const, models: [{ name: "music", capability: "audio" as const, parameters: [], referenceInputs: {} }] }],
};

beforeEach(() => { host.postMessage.mockReset(); Object.defineProperty(window, "parent", { configurable: true, value: host }); });
afterEach(() => { vi.useRealTimers(); Object.defineProperty(window, "parent", parentDescriptor); });

function respond(requestId: string, payload: unknown, origin = window.location.origin) {
    window.dispatchEvent(new MessageEvent("message", { source: host as unknown as Window, origin, data: { type: GENERATE_RESPONSE, requestId, payload } }));
}

describe("native generation bridge", () => {
    const textConfig = { ...config, model: "native::gpt-5.5", channels: [{ ...config.channels[0], models: [{ name: "gpt-5.5", capability: "text" as const, parameters: [], referenceInputs: {} }] }] };

    it("keeps waiting beyond three minutes and accepts the eventual text response", async () => {
        vi.useFakeTimers();
        const promise = requestNative(textConfig, textConfig.model, { capability: "text", prompt: "hello", images: [] });
        const { requestId } = host.postMessage.mock.calls[0][0];
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(host.postMessage).toHaveBeenCalledTimes(1);
        respond(requestId, { resultKind: "text", text: "late" });
        await expect(promise).resolves.toEqual({ resultKind: "text", text: "late" });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("accepts valid text and rejects empty text", async () => {
        vi.useFakeTimers();
        const promise = requestNative(textConfig, textConfig.model, { capability: "text", prompt: "hello", images: [] });
        respond(host.postMessage.mock.calls[0][0].requestId, { resultKind: "text", text: "answer" });
        await expect(promise).resolves.toEqual({ resultKind: "text", text: "answer" });
        expect(host.postMessage).toHaveBeenCalledTimes(1);
        const empty = requestNative(textConfig, textConfig.model, { capability: "text", prompt: "hello", images: [] });
        respond(host.postMessage.mock.calls[1][0].requestId, { resultKind: "text", text: " " });
        await expect(empty).rejects.toThrow("有效生成结果");
        expect(vi.getTimerCount()).toBe(0);
    });
    it("accepts lyrics and ignores responses from another origin or request", async () => {
        const promise = requestNative(config, config.model, { capability: "audio", prompt: "lyrics", images: [], params: {} });
        const { requestId } = host.postMessage.mock.calls[0][0];
        respond(requestId, { resultKind: "lyrics", text: "wrong origin" }, "https://untrusted.test");
        respond("another-request", { resultKind: "lyrics", text: "wrong request" });
        respond(requestId, { resultKind: "lyrics", text: "Verse" });
        await expect(promise).resolves.toEqual({ resultKind: "lyrics", text: "Verse" });
    });

    it("sends cancellation and rejects late results", async () => {
        const controller = new AbortController();
        const promise = requestNative(config, config.model, { capability: "audio", prompt: "music", images: [] }, controller.signal);
        const { requestId } = host.postMessage.mock.calls[0][0];
        const rejected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
        controller.abort();
        respond(requestId, { resultKind: "audio", urls: ["https://example.test/a.mp3"] });
        await rejected;
        expect(host.postMessage).toHaveBeenLastCalledWith({ type: GENERATE_CANCEL, requestId }, window.location.origin);
    });

    it("rejects unsupported reference inputs before posting to host", async () => {
        await expect(requestNative(config, config.model, { capability: "audio", prompt: "music", images: [], videos: ["https://example.test/v.mp4"] })).rejects.toThrow("videos");
        expect(host.postMessage).not.toHaveBeenCalled();
    });

    it("rejects a result whose media kind does not match the request", async () => {
        const promise = requestNative(config, config.model, { capability: "audio", prompt: "music", images: [] });
        const rejected = expect(promise).rejects.toThrow("有效生成结果");
        const { requestId } = host.postMessage.mock.calls[0][0];
        respond(requestId, { resultKind: "video", urls: ["https://example.test/v.mp4"] });
        await rejected;
    });
});
