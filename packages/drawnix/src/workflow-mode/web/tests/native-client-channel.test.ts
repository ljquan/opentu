// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { buildApiUrl, defaultConfig, fetchModelWithLocalProxy, useConfigStore, withLocalProxy } from "../src/stores/use-config-store";
import { runModelPlugin } from "../src/services/api/model-plugin";

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/stores/use-config-store", () => import("../src/stores/use-config-store"));

const proxy = "http://127.0.0.1:8899";
const config = { ...defaultConfig, baseUrl: "https://api.tu-zi.com", apiKey: "test-key", proxyEnabled: true, proxyUrl: proxy };

beforeEach(() => {
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    useConfigStore.setState({ config });
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useConfigStore.setState({ config: defaultConfig });
});

describe("workflow client channel at the final request boundary", () => {
    it("attributes the unwrapped target once and preserves signed asset URLs", () => {
        const target = "https://api.tu-zi.com/v1/images/generations?sig=a%2Fb+z&ch=1&%63h=9";
        expect(withLocalProxy(target, true)).toBe(`${proxy}/https://api.tu-zi.com/v1/images/generations?sig=a%2Fb+z&ch=2`);
        expect(withLocalProxy(withLocalProxy(target, true), true)).toBe(withLocalProxy(target, true));
        expect(withLocalProxy(target)).toBe(`${proxy}/${target}`);
        expect(buildApiUrl(config.baseUrl, "/audio/generations")).toBe(`${proxy}/https://api.tu-zi.com/v1/audio/generations?ch=2`);
        expect(withLocalProxy("https://other.tu-zi.com/v1/videos?ch=7", true)).toBe(`${proxy}/https://other.tu-zi.com/v1/videos?ch=7`);
    });

    it("preserves Request body, headers, abort propagation and explicit init", async () => {
        const fetch = vi.fn().mockResolvedValue(new Response("ok"));
        vi.stubGlobal("fetch", fetch);
        const controller = new AbortController();
        const body = '{"temperature":0,"stream":false}';
        const request = new Request("https://api.tu-zi.com/v1/responses?ch=1", { method: "POST", body, headers: { "x-test": "kept" }, signal: controller.signal });
        const init = { cache: "no-store" as const };
        await fetchModelWithLocalProxy(request, init);
        const [input, sentInit] = fetch.mock.calls[0];
        expect(sentInit.body).toBeInstanceOf(Blob);
        const sent = new Request(input, sentInit);
        expect(sent.url).toBe(`${proxy}/https://api.tu-zi.com/v1/responses?ch=2`);
        expect(sent.method).toBe("POST");
        expect(sent.headers.get("x-test")).toBe("kept");
        expect(await sent.text()).toBe(body);
        expect(sent.cache).toBe("no-store");
        controller.abort();
        expect(sent.signal.aborted).toBe(true);
    });

    it("serializes plugin params before replacing ch and leaves multipart data intact", async () => {
        const request = vi.spyOn(axios, "request").mockResolvedValue({ data: "ok" });
        const form = new FormData();
        form.set("temperature", "0");
        const controller = new AbortController();
        await runModelPlugin({ capability: "image", config, images: [], signal: controller.signal, params: { form }, script: 'return http.post("/images/edits?sig=a%2Fb&ch=8", params.form, { params: { ch: 7, stream: false, seed: 0 } });' });
        const sent = request.mock.calls[0][0];
        expect(sent.url).toBe(`${proxy}/https://api.tu-zi.com/v1/images/edits?sig=a%2Fb&stream=false&seed=0&ch=2`);
        expect(sent.params).toBeUndefined();
        expect(sent.data).toBe(form);
        expect(sent.headers).toEqual({ Authorization: "Bearer test-key" });
        expect(sent.signal).toBe(controller.signal);
    });

    it("keeps raw plugin headers/body and external endpoints unchanged", async () => {
        const request = vi.spyOn(axios, "request").mockResolvedValue({ data: "ok" });
        await runModelPlugin({ capability: "text", config, script: 'return request({ url: "https://external.example/v1/chat?sig=a%2Fb", method: "post", data: { stream: false, temperature: 0 }, headers: { "x-custom": "yes" }, params: { ch: 9 } });' });
        const sent = request.mock.calls[0][0];
        expect(sent.url).toBe(`${proxy}/https://external.example/v1/chat?sig=a%2Fb&ch=9`);
        expect(sent.data).toEqual({ stream: false, temperature: 0 });
        expect(sent.headers).toEqual({ "x-custom": "yes" });
    });
});
