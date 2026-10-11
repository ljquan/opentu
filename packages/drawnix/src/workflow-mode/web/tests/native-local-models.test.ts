import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllBuiltInModelConfigs } from "../../../constants/model-config";
import { localModelContract } from "../../host/local-model-contract";
import { defaultConfig, type AiConfig, type ModelCapability } from "../src/stores/use-config-store";
import { getNativeParameterValues, nativeModel, setNativeParameterValue } from "../src/integration/native-parameters";
import { requestGeneration, requestImageQuestion } from "../src/services/api/image";
import { requestAudioGeneration } from "../src/services/api/audio";
import { queryLocalImageTask, requestLocalModelImage } from "../src/services/api/local-model";

function configFor(name: string, capability: ModelCapability, values: Record<string, string | number | boolean> = {}, apiFormat: "openai" | "gemini" = "openai"): AiConfig {
    const config: AiConfig = {
        ...defaultConfig,
        model: `local::${name}`,
        [`${capability}Model`]: `local::${name}`,
        channels: [{ id: "local", name: "Local", apiFormat, apiKey: "local-key", baseUrl: "https://local-provider.example", models: [{ name, capability }] }],
    };
    for (const [key, value] of Object.entries(values)) config.nativeParams = setNativeParameterValue(config, config.model, capability, key, value);
    return config;
}
const json = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("OpenTu complete local model parameters", () => {
    const models = getAllBuiltInModelConfigs().filter((model) => model.type !== "video");
    it.each(models.map((model) => [model.id, model.type] as const))("%s (%s) uses the shared model contract", (name, capability) => {
        const config = configFor(name, capability);
        const contract = nativeModel(config, capability);
        expect(contract, name).toBeDefined();
        expect(contract?.parameters?.length).toBeGreaterThan(0);
        if (!contract?.unavailableReason) expect(() => getNativeParameterValues(config, config.model, capability)).not.toThrow();
    });
    it("sends GPT Image dedicated settings with the configured local credentials", async () => {
        const fetcher = vi.fn().mockResolvedValue(json({ data: [{ url: "https://result.example/image.png", width: 1024, height: 1024 }] }));
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gpt-image-2", "image", { n: 2, background: "transparent", output_format: "png", moderation: "low" });
        config.channels[0].baseUrl = "https://api.openai.com";
        await requestGeneration(config, "test");
        expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations");
        expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer local-key");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: "gpt-image-2", n: 2, background: "transparent", output_format: "png", moderation: "low" });
    });
    it("sends Gemini image resolution through the existing direct provider path", async () => {
        const fetcher = vi.fn().mockResolvedValue(json({ data: [{ url: "https://result.example/image.png" }] }));
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gemini-3-pro-image-preview", "image", { quality: "2k" });
        await requestGeneration(config, "test");
        expect(fetcher.mock.calls[0][0]).toBe("https://local-provider.example/v1/images/generations");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: "gemini-3-pro-image-preview", quality: "2k" });
    });
    it("sends Nano Banana 2.1 Thinking and image size through generateContent", async () => {
        const fetcher = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ fileData: { fileUri: "https://result.example/image.jpg", mimeType: "image/jpeg" } }] } }] }));
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gemini-nano-banana-2.1", "image", { quality: "2k", size: "16x9", thinking: "high" }, "gemini");
        await requestGeneration(config, "test");
        expect(fetcher.mock.calls[0][0]).toBe("https://local-provider.example/v1beta/models/gemini-nano-banana-2.1:generateContent");
        expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig).toMatchObject({
            responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" }, thinkingConfig: { thinkingLevel: "high" },
        });
    });
    it.each(["https://api.tu-zi.com", "https://api.tu-zi.com/v1"])("uses the Nano Banana 2.1 binding on an OpenAI Tuzi channel %s", async (baseUrl) => {
        const fetcher = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ fileData: { fileUri: "https://result.example/image.jpg" } }] } }] }));
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gemini-nano-banana-2.1", "image", { quality: "1k", thinking: "minimal" });
        config.channels[0].baseUrl = baseUrl;
        expect(nativeModel(config, "image")?.referenceInputs?.images?.maxCount).toBe(14);
        await requestLocalModelImage(config, "edit", ["data:image/png;base64,AAAA"]);
        expect(fetcher.mock.calls[0][0]).toBe("https://api.tu-zi.com/v1beta/models/gemini-nano-banana-2.1:generateContent");
        expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer local-key");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
            contents: [{ parts: [{ text: "edit" }, { inline_data: { mime_type: "image/png", data: "AAAA" } }] }],
            generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } },
        });
        fetcher.mockClear();
        await expect(requestLocalModelImage(config, "edit", Array(15).fill("data:image/png;base64,AAAA"))).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("sends Seedream resolution through its existing adapter", async () => {
        const fetcher = vi.fn().mockResolvedValue(json({ data: [{ url: "https://result.example/image.png" }] }));
        vi.stubGlobal("fetch", fetcher);
        await requestGeneration(configFor("doubao-seedream-4-5-251128", "image", { seedream_quality: "4k" }), "test");
        expect(fetcher.mock.calls[0][0]).toBe("https://local-provider.example/v1/images/generations");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: "doubao-seedream-4-5-251128" });
    });
    it("sends text sampling and max output tokens, retaining conversation and system prompt", async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, body: null, json: async () => ({ output_text: "Answer" }) });
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gpt-5.6-sol", "text", { temperature: 0.2, top_p: 0.8, max_tokens: 123 });
        config.systemPrompt = "Be precise";
        expect(await requestImageQuestion(config, [{ role: "user", content: "Question" }], vi.fn())).toBe("Answer");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
            temperature: 0.2,
            top_p: 0.8,
            max_output_tokens: 123,
            input: [
                { role: "system", content: "Be precise" },
                { role: "user", content: "Question" },
            ],
        });
    });
    it("uses standard text parameters for discovered models outside the built-in catalog", async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, body: null, json: async () => ({ output_text: "Answer" }) });
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("deepseek-v4.1-preview", "text", { temperature: 0.3, top_p: 0.85, max_tokens: 777 });
        config.reasoningEffort = "high";
        expect(nativeModel(config, "text")?.parameters?.map((parameter) => parameter.id)).toEqual(["temperature", "top_p", "max_tokens"]);
        await requestImageQuestion(config, [{ role: "user", content: "Question" }], vi.fn());
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ temperature: 0.3, top_p: 0.85, max_output_tokens: 777 });
        expect(JSON.parse(fetcher.mock.calls[0][1].body).reasoning).toBeUndefined();
    });
    it("uses the Suno music endpoint and preserves multiple clips", async () => {
        const fetcher = vi.fn().mockResolvedValue(
            json({
                task_id: "task",
                action: "MUSIC",
                status: "SUCCESS",
                data: [
                    { id: "a", status: "complete", audio_url: "https://result.example/a.mp3" },
                    { id: "b", status: "complete", audio_url: "https://result.example/b.mp3" },
                ],
            }),
        );
        vi.stubGlobal("fetch", fetcher);
        const result = await requestAudioGeneration(configFor("suno_music", "audio", { sunoAction: "music", mv: "chirp-v5", title: "Title", tags: "jazz", instrumental: "true" }), "test");
        expect(fetcher.mock.calls[0][0]).toBe("https://local-provider.example/suno/submit/music");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ mv: "chirp-v5", title: "Title", tags: "jazz", make_instrumental: true });
        expect(result).toEqual({ kind: "audio", clips: ["https://result.example/a.mp3", "https://result.example/b.mp3"] });
    });
    it("validates invalid image settings before network calls", async () => {
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);
        await expect(requestGeneration(configFor("gpt-image-2", "image", { n: 99 }), "test")).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("queries persisted Flux and MJ tasks without resubmission", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(json({ status: "Ready", result: { sample: "https://result.example/flux.png" } }))
            .mockResolvedValueOnce(json({ status: "SUCCESS", imageUrl: "https://result.example/mj.png" }));
        vi.stubGlobal("fetch", fetcher);
        expect(await queryLocalImageTask(configFor("bfl-flux-2-pro", "image"), { protocol: "flux-image-adapter", remoteId: "remote" })).toMatchObject({ urls: ["https://result.example/flux.png"] });
        expect(await queryLocalImageTask(configFor("mj-imagine", "image"), { protocol: "mj-image-adapter", remoteId: "remote" })).toMatchObject({ urls: ["https://result.example/mj.png"] });
        expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === "GET")).toBe(true);
    });
    it.each([true, false])("recovers every MJ image without a new POST (composite URL: %s)", async (hasComposite) => {
        const urls = Array.from({ length: 4 }, (_, i) => `https://result.example/mj-${i}.png`);
        const fetcher = vi.fn().mockResolvedValue(json({ status: "SUCCESS", ...(hasComposite ? { imageUrl: "https://result.example/grid.png" } : {}), imageUrls: [{}, null, ...urls.map(url => ({ url }))] }));
        vi.stubGlobal("fetch", fetcher);
        await expect(queryLocalImageTask(configFor("mj-imagine", "image"), { protocol: "mj-image-adapter", remoteId: "remote" })).resolves.toEqual({ resultKind: "image", urls });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0][0]).toContain("/mj/task/remote/fetch");
        expect(fetcher.mock.calls[0][1].method || "GET").toBe("GET");
    });
    it("rejects an MJ success without any usable image instead of completing an empty node", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ status: "SUCCESS", imageUrls: [{ url: "" }, {}] })));
        await expect(queryLocalImageTask(configFor("mj-imagine", "image"), { protocol: "mj-image-adapter", remoteId: "remote" })).rejects.toThrow("未返回有效结果");
    });
    it("passes four MJ images through the workflow generation API", async () => {
        vi.useFakeTimers();
        const urls = Array.from({ length: 4 }, (_, i) => `https://result.example/mj-${i}.png`);
        const fetcher = vi.fn().mockResolvedValueOnce(json({ result: "mj-multi" })).mockResolvedValueOnce(json({ status: "SUCCESS", imageUrls: urls.map(url => ({ url })) }));
        vi.stubGlobal("fetch", fetcher);
        const pending = requestGeneration(configFor("mj-imagine", "image"), "four variations");
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(5000);
        expect((await pending).map(image => image.dataUrl)).toEqual(urls);
        expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    });
    it("does not infer async routing from a name suffix and uses OpenTu Suno alias rules", () => {
        expect(localModelContract("gemini-3-pro-image-preview-async", "image", "openai", "https://api.tu-zi.com")?.requestSchema).toBe("openai.image.basic-json");
        expect(getNativeParameterValues(configFor("suno_lyrics", "audio"), "local::suno_lyrics", "audio").sunoAction).toBe("lyrics");
    });
    it("uses official edit multipart and Tuzi edit JSON without sharing their credentials", async () => {
        const fetcher = vi.fn().mockImplementation(async () => json({ data: [{ url: "https://result.example/image.png", width: 1024, height: 1024 }] }));
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gpt-image-2", "image");
        config.channels[0].baseUrl = "https://api.openai.com";
        const reference = "data:image/png;base64,aGVsbG8=";
        await requestLocalModelImage(config, "edit", [reference]);
        expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/edits");
        expect(fetcher.mock.calls[0][1].body).toBeInstanceOf(FormData);
        config.channels[0].baseUrl = "https://api.tu-zi.com";
        config.channels[0].apiKey = "tuzi-local-key";
        await requestLocalModelImage(config, "edit", [reference]);
        expect(fetcher.mock.calls[1][0]).toBe("https://api.tu-zi.com/v1/images/generations");
        expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer tuzi-local-key");
        expect(JSON.parse(fetcher.mock.calls[1][1].body).image).toEqual([reference]);
    });
    it("rejects official-only GPT settings on Tuzi instead of silently dropping them", async () => {
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gpt-image-2", "image", { background: "transparent" });
        config.channels[0].baseUrl = "https://api.tu-zi.com";
        await expect(requestGeneration(config, "test")).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("keeps parameters isolated by channel, model and capability", () => {
        const config = configFor("gemini-3-pro-image-preview", "image", { quality: "2k" });
        config.channels.push({ ...config.channels[0], id: "other" });
        const other = { ...config, model: "other::gemini-3-pro-image-preview" };
        expect(getNativeParameterValues(config, config.model, "image").quality).toBe("2k");
        expect(getNativeParameterValues(other, other.model, "image").quality).not.toBe("2k");
    });
    it("validates reference count before sending a Flux task", async () => {
        const fetcher = vi.fn();
        vi.stubGlobal("fetch", fetcher);
        await expect(requestLocalModelImage(configFor("bfl-flux-2-pro", "image"), "test", Array(9).fill("https://ref.example/a.png"))).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("uses the dedicated Suno lyrics action and returns lyrics text", async () => {
        const fetcher = vi.fn().mockResolvedValue(json({ task_id: "lyrics", action: "LYRICS", status: "SUCCESS", data: { text: "Test lyrics", title: "Title", status: "complete" } }));
        vi.stubGlobal("fetch", fetcher);
        const result = await requestAudioGeneration(configFor("suno_lyrics", "audio"), "test");
        expect(fetcher.mock.calls[0][0]).toBe("https://local-provider.example/suno/submit/lyrics");
        expect(result).toMatchObject({ kind: "lyrics" });
        expect(result.kind === "lyrics" && result.text).toContain("Test lyrics");
    });

    it("uses the native Google image protocol and image resolution", async () => {
        const fetcher = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
        vi.stubGlobal("fetch", fetcher);
        const config = configFor("gemini-3-pro-image-preview", "image", { quality: "2k" }, "gemini");
        const result = await requestGeneration(config, "test");
        expect(fetcher.mock.calls[0][0]).toBe("https://local-provider.example/v1beta/models/gemini-3-pro-image-preview:generateContent");
        expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.imageConfig.imageSize).toBe("2K");
        expect(result[0].dataUrl).toBe("data:image/png;base64,aGVsbG8=");
    });
    it.each(["mj-imagine", "bfl-flux-2-pro"])("submits and polls %s through its own adapter", async (name) => {
        vi.useFakeTimers();
        const isMJ = name === "mj-imagine";
        const fetcher = vi
            .fn()
            .mockResolvedValueOnce(json(isMJ ? { result: "remote" } : { id: "remote" }))
            .mockResolvedValueOnce(json(isMJ ? { status: "SUCCESS", imageUrl: "https://result.example/mj.png" } : { status: "Ready", result: { sample: "https://result.example/flux.png" } }));
        vi.stubGlobal("fetch", fetcher);
        const pending = requestLocalModelImage(configFor(name, "image", isMJ ? { mj_ar: "16:9" } : { size: "1x1" }), "test", []);
        await vi.advanceTimersByTimeAsync(6000);
        expect(await pending).toHaveLength(1);
        expect(fetcher.mock.calls[0][0]).toContain(isMJ ? "/mj/submit/imagine" : "/flux/v1/bfl-flux-2-pro");
        const body = JSON.parse(fetcher.mock.calls[0][1].body);
        if (isMJ) expect(body.prompt).toContain("--ar 16:9");
        else expect(body).toMatchObject({ width: 1024, height: 1024 });
    });
});
