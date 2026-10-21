/** Old bookmarks open the main canvas; no retired runtime is loaded. */
export function getLegacyCanvasReturnUrl(href: string): string | null {
  const url = new URL(href);
  if (!/^\/workflow(?:\/|$)/.test(url.pathname)) return null;
  const target = new URL('/', url.origin);
  const board = url.searchParams.get('board');
  if (board) target.searchParams.set('board', board);
  target.searchParams.set('legacyData', '1');
  return target.pathname + target.search;
}

export function normalizeLegacyCanvasLocation(): void {
  const target = getLegacyCanvasReturnUrl(window.location.href);
  if (target) window.history.replaceState(null, '', target);
}
