export const IMAGE_TOOLBAR_PREFERENCES_KEY = 'aitu:canvas-image-toolbar';
export const IMAGE_TOOLBAR_PREFERENCES_EVENT =
  'image-toolbar-preferences-changed';

export const IMAGE_TOOLBAR_OPTIONS = [
  { id: 'ai-image', label: 'AI图片生成' },
  { id: 'ai-video', label: 'AI视频生成' },
  { id: 'split-image', label: '智能拆图' },
  { id: 'ai-layer-decomposition', label: 'AI分层' },
  { id: 'local-image-split', label: '手动拆图' },
  { id: 'local-image-resize', label: '本地放大' },
  { id: 'local-image-angle', label: 'AI视角编辑' },
  { id: 'image-edit', label: '编辑图片' },
  { id: 'download', label: '下载' },
  { id: 'duplicate', label: '复制' },
  { id: 'regenerate-image', label: '再次生成' },
  { id: 'trash', label: '删除' },
] as const;

export type ImageToolbarPreferences = { hidden: string[]; labels: boolean };

export function readImageToolbarPreferences(
  storage: Pick<Storage, 'getItem'> = localStorage
): ImageToolbarPreferences {
  try {
    const data = JSON.parse(
      storage.getItem(IMAGE_TOOLBAR_PREFERENCES_KEY) || '{}'
    );
    return {
      hidden: Array.isArray(data?.hidden)
        ? data.hidden.filter((value: unknown) => typeof value === 'string')
        : [],
      labels: data?.labels === true,
    };
  } catch {
    return { hidden: [], labels: false };
  }
}

export function writeImageToolbarPreferences(
  preferences: ImageToolbarPreferences,
  storage: Pick<Storage, 'setItem'> = localStorage
): void {
  storage.setItem(IMAGE_TOOLBAR_PREFERENCES_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent(IMAGE_TOOLBAR_PREFERENCES_EVENT));
}
