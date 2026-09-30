import { useEffect } from "react";
import { configuredChannelsOnly, useConfigStore } from "@/stores/use-config-store";
import { sameConfig } from "../../../shared/model-defaults";

/** Migrate legacy automatic host imports without fetching any model catalog. */
export async function syncOpenTuModels(isActive: () => boolean = () => true) {
    if (!isActive()) return;
    const state = useConfigStore.getState();
    const config = configuredChannelsOnly(state.config);
    if (!sameConfig(state.config, config)) useConfigStore.setState({ config });
}

export function useOpenTuModelDefaults() {
    useEffect(() => {
        void syncOpenTuModels();
        return useConfigStore.subscribe((state, previous) => {
            if (state.config.channels !== previous.config.channels) void syncOpenTuModels();
        });
    }, []);
}
