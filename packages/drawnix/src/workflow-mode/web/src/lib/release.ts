export type ReleaseInfo = {
    version: string;
    date: string;
    items: { type: string; content: string }[];
};

export function releasesFromChangelog(changelog: { versions?: Array<{ version: string; date: string; changes: Record<string, string[]> }> }): ReleaseInfo[] {
    const types: Record<string, string> = { features: "新增", fixes: "修复", improvements: "优化" };
    return (changelog.versions || []).map((release) => ({
        version: release.version,
        date: release.date,
        items: Object.entries(release.changes).flatMap(([kind, items]) => items.map(content => ({ type: types[kind] || "调整", content }))),
    }));
}

export function parseChangelog(content: string): ReleaseInfo[] {
    return content
        .split(/^## /m)
        .slice(1)
        .map((block) => {
            const [title = "", ...lines] = block.trim().split("\n");
            const [, version = title.trim(), date = ""] = title.match(/^(.+?)(?:\s+-\s+(.+))?$/) || [];
            return {
                version: version.trim(),
                date: date.trim(),
                items: lines
                    .map((line) => line.trim().match(/^\+\s+\[(.+?)\]\s+(.+)$/))
                    .filter((match): match is RegExpMatchArray => Boolean(match))
                    .map((match) => ({ type: match[1], content: match[2] })),
            };
        })
        .filter((release) => release.items.length);
}
