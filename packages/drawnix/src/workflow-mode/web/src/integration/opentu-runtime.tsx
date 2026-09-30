import { createContext, useContext, type ReactNode } from "react";

type OpenTuRuntime = { onOpenProviderSettings?: (profileId?: string | null) => void };
const OpenTuRuntimeContext = createContext<OpenTuRuntime>({});

export function OpenTuRuntimeProvider({ children, onOpenProviderSettings }: OpenTuRuntime & { children: ReactNode }) {
    return <OpenTuRuntimeContext.Provider value={{ onOpenProviderSettings }}>{children}</OpenTuRuntimeContext.Provider>;
}

export function useOpenTuRuntime() {
    return useContext(OpenTuRuntimeContext);
}
