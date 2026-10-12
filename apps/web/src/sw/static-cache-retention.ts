export async function mayRemovePreviousStaticCaches(clients: Pick<Clients, 'matchAll'>, enteringClientId?: string): Promise<boolean> {
    // An old open page can request a lazy chunk long after an arbitrary timer.
    // Legacy pages cannot report their version, so retain assets while any page is alive.
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    return windows.every(client => Boolean(enteringClientId) && client.id === enteringClientId);
}
