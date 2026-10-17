export type CreationMode = 'image' | 'video' | 'audio' | 'canvas';

export type CreationAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export type CreationQuality = 'standard' | 'high';

export type CreationReferenceImage = {
  name: string;
  url: string;
};

export type CreationRequest = {
  prompt?: string;
  mode?: CreationMode;
  modelId?: string | null;
  aspectRatio?: CreationAspectRatio;
  quality?: CreationQuality;
  referenceImages?: CreationReferenceImage[];
};

export function creationPrefillParams(
  request: Pick<CreationRequest, 'mode' | 'aspectRatio' | 'quality'>,
  managedGeneration: boolean
): { size?: string; quality?: CreationQuality } {
  return {
    ...(request.aspectRatio ? { size: managedGeneration && request.mode === 'image' ? '1024x1024' : request.aspectRatio } : {}),
    ...(request.quality ? { quality: request.quality } : {}),
  };
}

const CREATION_CENTER_DRAFT_KEY = 'foxvue_creation_center_draft_v1';
const MAX_REFERENCE_IMAGE_BYTES = 2 * 1024 * 1024;

export function readReferenceImage(
  file: File
): Promise<CreationReferenceImage> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('请选择图片文件'));
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    return Promise.reject(new Error('参考图片不能超过 2 MB'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('参考图片读取失败'));
        return;
      }
      resolve({ name: file.name, url: reader.result });
    };
    reader.onerror = () => reject(new Error('参考图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export function saveCreationCenterDraft(request: CreationRequest): void {
  try {
    sessionStorage.setItem(CREATION_CENTER_DRAFT_KEY, JSON.stringify(request));
  } catch (error) {
    console.warn('[CreationRequest] Failed to save creation draft:', error);
  }
}

export function readCreationCenterDraft(): CreationRequest | null {
  try {
    const raw = sessionStorage.getItem(CREATION_CENTER_DRAFT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CreationRequest;
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch (error) {
    console.warn('[CreationRequest] Failed to read creation draft:', error);
    return null;
  }
}

export function clearCreationCenterDraft(): void {
  try {
    sessionStorage.removeItem(CREATION_CENTER_DRAFT_KEY);
  } catch (error) {
    console.warn('[CreationRequest] Failed to clear creation draft:', error);
  }
}
