import { App } from "antd";
import { useEffect } from "react";
import { defaultConfig, useConfigStore } from "@/stores/use-config-store";
import { isModelDefaults, sameConfig } from "../../../shared/model-defaults";
import { NATIVE_MODELS_REQUEST, NATIVE_MODELS_RESPONSE, mergeNativeModels } from "../../../shared/generation-bridge";

export function useOpenTuModelDefaults() {
    const { notification } = App.useApp();
    useEffect(() => {
        if (window.parent === window || import.meta.env.VITE_EMBEDDED !== "true") return;
        const receive = (event: MessageEvent) => {
            if (event.source !== window.parent || event.origin !== window.location.origin ||
                event.data?.type !== NATIVE_MODELS_RESPONSE) return;
            const state = useConfigStore.getState();
            if (event.data.error || !isModelDefaults(event.data.payload)) {
                notification.warning({ title: "OpenTu 配置读取失败", description: "现有配置未修改，请重新打开工作流重试。" });
                return;
            }
            const { channels, defaults } = event.data.payload;
            try {
                const config = mergeNativeModels(state.config, event.data.payload);
                if (sameConfig(state.config, defaultConfig)) {
                    for (const capability of ["image", "video", "text", "audio"] as const) config[`${capability}Model`] = defaults[capability];
                    config.model = config.imageModel;
                }
                useConfigStore.setState({
                    config,
                    opentuDefaultsInitialized: true,
                });
            } catch {
                notification.error({ title: "OpenTu 配置保存失败", description: "请检查浏览器存储权限，现有画布内容未修改。" });
            }
        };
        window.addEventListener("message", receive);
        window.parent.postMessage({ type: NATIVE_MODELS_REQUEST }, window.location.origin);
        return () => window.removeEventListener("message", receive);
    }, [notification]);
}
