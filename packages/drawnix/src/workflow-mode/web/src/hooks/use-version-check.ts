import { useCallback, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constant/env";
import { releasesFromChangelog, type ReleaseInfo } from "@/lib/release";

declare const __APP_CHANGELOG__: Parameters<typeof releasesFromChangelog>[0];

const latestVersionUrl = "/version.json";
const latestChangelogUrl = "/changelog.json";

function readLocalReleases(): ReleaseInfo[] {
    return typeof __APP_CHANGELOG__ === "undefined" ? [] : releasesFromChangelog(__APP_CHANGELOG__);
}

function toVersionParts(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(latestVersion: string, currentVersion: string) {
    const latest = toVersionParts(latestVersion);
    const current = toVersionParts(currentVersion);
    if (!latest || !current) return false;
    return latest.some((value, index) => value > current[index] && latest.slice(0, index).every((part, prevIndex) => part === current[prevIndex]));
}

export function useVersionCheck() {
    const { t } = useTranslation();
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const localReleases = useMemo(readLocalReleases, []);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const hasNewVersion = isNewerVersion(latestVersion, currentVersion);

    const checkLatestVersion = useCallback(async () => {
        try {
            const response = await fetch(latestVersionUrl);
            if (!response.ok) return false;
            const version: { version?: string } = await response.json();
            setLatestVersion(version.version || currentVersion);
            return true;
        } catch {
            return false;
        }
    }, [currentVersion]);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const [versionResponse, changelogResponse] = await Promise.all([fetch(latestVersionUrl), fetch(latestChangelogUrl)]);
                if (!versionResponse.ok) throw new Error(t("version.readFailed"));
                if (!changelogResponse.ok) throw new Error(t("version.changelogFailed"));
                const [version, changelog] = await Promise.all([versionResponse.json(), changelogResponse.json()]) as [
                    { version?: string },
                    { versions?: Array<{ version: string; date: string; changes: Record<string, string[]> }> },
                ];
                setLatestVersion(version.version || currentVersion);
                setReleases(releasesFromChangelog(changelog));
                if (showMessage) message.success(t("version.updated"));
                return true;
            } catch {
                setLatestVersion(currentVersion);
                setReleases(localReleases);
                if (showMessage) message.error(t("version.updateFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message, t],
    );

    useEffect(() => {
        void checkLatestVersion();
    }, [checkLatestVersion]);

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
    };
}
