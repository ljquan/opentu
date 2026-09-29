import { useEffect, useState } from "react";
import "./styles/globals.css";

import { AppProviders } from "@/components/layout/app-providers";
import i18n from "@/i18n";
import { I18nextProvider } from "react-i18next";
import { WorkflowRouter } from "@/router";
import { OpenTuRuntimeProvider } from "@/integration/opentu-runtime";
import { unloadPlugins } from "@/lib/canvas/plugin-loader";
import { cancelNativeRequests } from "../../host/native-runtime";

let mountedInstances = 0;

export function WorkflowApp({ onOpenProviderSettings }: { onOpenProviderSettings?: (profileId?: string | null) => void }) {
    const [root, setRoot] = useState<HTMLDivElement | null>(null);
    useEffect(() => {
        mountedInstances++;
        return () => {
            if (--mountedInstances === 0) { cancelNativeRequests(); unloadPlugins(); }
        };
    }, []);
    return (
        <div className="workflow-app-root" id="opentu-workflow-root" ref={setRoot}>
            {root && <OpenTuRuntimeProvider onOpenProviderSettings={onOpenProviderSettings}>
                <I18nextProvider i18n={i18n}><AppProviders>
                    <WorkflowRouter />
                </AppProviders></I18nextProvider>
            </OpenTuRuntimeProvider>}
        </div>
    );
}
