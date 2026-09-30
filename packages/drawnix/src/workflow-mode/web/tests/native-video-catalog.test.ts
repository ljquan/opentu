import "fake-indexeddb/auto";
import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllBuiltInModelConfigs } from "../../../constants/model-config";
import { localVideoContract } from "../../host/local-video-contract";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import { getNativeParameterValues, nativeModel, setNativeParameterValue } from "../src/integration/native-parameters";
import { createVideoGenerationTask, pollVideoGenerationTask } from "../src/services/api/video";

const catalog = getAllBuiltInModelConfigs().filter((model) => model.type === "video");
function configFor(name: string, values: Record<string, string | number | boolean> = {}): AiConfig {
    const config: AiConfig = {
        ...defaultConfig,
        model: `local::${name}`,
        videoModel: `local::${name}`,
        channels: [{ id: "local", name: "Local", apiFormat: "openai", apiKey: "test-local-key", baseUrl: "https://local-provider.example", models: [{ name, capability: "video" }] }],
    };
    for (const [key, value] of Object.entries(values)) config.nativeParams = setNativeParameterValue(config, config.model, "video", key, value);
    return config;
}
function mockSubmit() {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "remote", task_id: "remote", status: "queued", code: 0, data: { task_id: "remote" } })));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("complete OpenTu local video catalog", () => {
    it.each(catalog.map((model) => model.id))("%s has an explicit usable contract or unavailable reason", (name) => {
        const model = nativeModel(configFor(name), "video");
        expect(model, name).toBeDefined();
        expect(model?.parameters?.length).toBeGreaterThan(0);
        if (name === "kling-video-o1" || name === "kling-video-o1-edit") {
            expect(model?.unavailableReason).toBeTruthy();
            expect(() => getNativeParameterValues(configFor(name), `local::${name}`, "video")).toThrow();
        } else {
            expect(model?.unavailableReason, name).toBeUndefined();
            expect(model?.adapterId).toBeTruthy();
            expect(() => getNativeParameterValues(configFor(name), `local::${name}`, "video")).not.toThrow();
        }
    });
    it("keeps concrete Kling and physical Seedance versions fixed", () => {
        expect(getNativeParameterValues(configFor("kling-v2-6"), "local::kling-v2-6", "video").model_name).toBe("kling-v2-6");
        expect(getNativeParameterValues(configFor("doubao-seedance-1-5-pro_1080p"), "local::doubao-seedance-1-5-pro_1080p", "video").size).toBe("1080p");
    });
    it("submits Kling JSON through its adapter, including nested camera fields", async () => {
        const fetcher = mockSubmit();
        const config = configFor("kling_video", { model_name: "kling-v2-6", mode: "pro", cfg_scale: 0.3, negative_prompt: "blur", camera_pan: 2 });
        const task = await createVideoGenerationTask(config, "test");
        const [url, init] = fetcher.mock.calls[0];
        expect(url).toBe("https://local-provider.example/kling/v1/videos/text2video");
        expect(init.headers.Authorization).toBe("Bearer test-local-key");
        expect(JSON.parse(init.body)).toMatchObject({ model_name: "kling-v2-6", mode: "pro", cfg_scale: 0.3, negative_prompt: "blur", camera_control: { type: "simple", config: { pan: 2 } } });
        expect(task.protocol).toBe("kling-text2video");
        const get = vi.spyOn(axios, "get").mockResolvedValue({ data: { code: 0, data: { task_status: "processing" } } });
        expect(await pollVideoGenerationTask(config, JSON.parse(JSON.stringify(task)))).toEqual({ status: "pending" });
        expect(get.mock.calls[0][0]).toBe("https://local-provider.example/kling/v1/videos/text2video/remote");
    });
    it("submits legacy Seedance using its physical model and aspect ratio", async () => {
        const fetcher = mockSubmit();
        await createVideoGenerationTask(configFor("seedance-1.5-pro", { size: "1080p", aspect_ratio: "9:16" }), "test");
        const [url, init] = fetcher.mock.calls[0];
        expect(url).toBe("https://local-provider.example/v1/videos");
        expect(init.body.get("model")).toBe("doubao-seedance-1-5-pro_1080p");
        expect(init.body.get("size")).toBe("9:16");
    });
    it("submits Seedance 2 JSON with typed audio and camera controls", async () => {
        const fetcher = mockSubmit();
        await createVideoGenerationTask(configFor("doubao-seedance-2-0-260128", { generate_audio: "false", camera_fixed: "true", seed: 123, ratio: "9:16" }), "test");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ generate_audio: false, camera_fixed: true, seed: 123, ratio: "9:16", content: [{ type: "text", text: "test" }] });
    });
    it("submits HappyHorse nested parameters including watermark and seed", async () => {
        const fetcher = mockSubmit();
        await createVideoGenerationTask(configFor("happyhorse-1.0-t2v", { watermark: "false", seed: 123, ratio: "9:16" }), "test");
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ model: "happyhorse-1.0-t2v", parameters: { watermark: false, seed: 123, ratio: "9:16" } });
    });
    it("rejects unavailable models before submitting", async () => {
        const fetcher = mockSubmit();
        await expect(createVideoGenerationTask(configFor("kling-video-o1"), "test")).rejects.toThrow("适配器");
        expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(["veo3.1-components-4k", "omni-flash", "sora-2-4s"])("uses OpenTu form contract for %s", async (name) => {
        const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { id: "remote" } });
        await createVideoGenerationTask(configFor(name), "test");
        const body = post.mock.calls[0][1] as FormData;
        expect(body.get("model")).toBe(name);
        expect(body.has("resolution_name")).toBe(false);
        if (name === "sora-2-4s") expect(body.has("seconds")).toBe(false);
    });
    it("does not infer a contract for an arbitrary unknown video model", () => {
        expect(localVideoContract("private-unknown-video")).toBeUndefined();
    });
});
