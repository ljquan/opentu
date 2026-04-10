import type { Attachment } from '../../types/chat.types';
import type { GeminiMessage, GeminiMessagePart } from './types';
import { fileToBase64 } from './utils';

export type MultimodalAttachmentInput = File | Attachment;

function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      const mimeType = blob.type || 'application/octet-stream';
      let base64: string;

      if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(bytes).toString('base64');
      } else {
        let binary = '';
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        base64 = btoa(binary);
      }

      return `data:${mimeType};base64,${base64}`;
    });
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取图片数据失败'));
    reader.readAsDataURL(blob);
  });
}

function isImageMimeType(mimeType?: string): boolean {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith('image/'));
}

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isLocalRelativeImageUrl(url: string): boolean {
  if (
    url.startsWith('/__aitu_cache__/') ||
    url.startsWith('/asset-library/') ||
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../')
  ) {
    return true;
  }

  if (!isAbsoluteHttpUrl(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return true;
  }

  if (typeof globalThis.location?.origin === 'string') {
    return url.startsWith(globalThis.location.origin);
  }

  return false;
}

export async function normalizeImageUrlForMultimodalInput(
  url: string
): Promise<string> {
  const normalizedUrl = url.trim();

  if (!normalizedUrl) {
    throw new Error('图片地址不能为空');
  }

  if (normalizedUrl.startsWith('data:image/')) {
    return normalizedUrl;
  }

  if (normalizedUrl.startsWith('blob:') || isLocalRelativeImageUrl(normalizedUrl)) {
    const response = await fetch(normalizedUrl);
    if (!response.ok) {
      throw new Error(`读取本地图片失败: ${response.status}`);
    }
    const blob = await response.blob();
    return blobToDataUrl(blob);
  }

  return normalizedUrl;
}

export async function buildImagePartsFromUrls(
  urls: string[],
  maxImageCount: number = Number.POSITIVE_INFINITY
): Promise<GeminiMessagePart[]> {
  const selectedUrls = urls.filter(Boolean).slice(0, maxImageCount);

  return Promise.all(
    selectedUrls.map(async (url) => ({
      type: 'image_url' as const,
      image_url: {
        url: await normalizeImageUrlForMultimodalInput(url),
      },
    }))
  );
}

export async function buildImagePartsFromFiles(
  files: File[],
  maxImageCount: number = Number.POSITIVE_INFINITY
): Promise<GeminiMessagePart[]> {
  const imageFiles = files
    .filter((file) => isImageMimeType(file.type))
    .slice(0, maxImageCount);

  return Promise.all(
    imageFiles.map(async (file) => ({
      type: 'image_url' as const,
      image_url: {
        url: await fileToBase64(file),
      },
    }))
  );
}

export function countImageAttachmentInputs(
  attachments: MultimodalAttachmentInput[] = []
): number {
  return attachments.filter((attachment) =>
    isFile(attachment)
      ? isImageMimeType(attachment.type)
      : isImageMimeType(attachment.type)
  ).length;
}

export async function buildImagePartsFromAttachmentInputs(
  attachments: MultimodalAttachmentInput[] = [],
  maxImageCount: number = Number.POSITIVE_INFINITY
): Promise<GeminiMessagePart[]> {
  const imageAttachments = attachments
    .filter((attachment) =>
      isFile(attachment)
        ? isImageMimeType(attachment.type)
        : isImageMimeType(attachment.type)
    )
    .slice(0, maxImageCount);

  return Promise.all(
    imageAttachments.map(async (attachment) => ({
      type: 'image_url' as const,
      image_url: {
        url: isFile(attachment)
          ? await fileToBase64(attachment)
          : await normalizeImageUrlForMultimodalInput(attachment.data),
      },
    }))
  );
}

export async function buildImagePartsFromChatAttachments(
  attachments: Attachment[] = [],
  maxImageCount: number = Number.POSITIVE_INFINITY
): Promise<GeminiMessagePart[]> {
  const imageAttachments = attachments
    .filter((attachment) => isImageMimeType(attachment.type))
    .slice(0, maxImageCount);

  return Promise.all(
    imageAttachments.map(async (attachment) => ({
      type: 'image_url' as const,
      image_url: {
        url: await normalizeImageUrlForMultimodalInput(attachment.data),
      },
    }))
  );
}

export function countImageParts(messages: GeminiMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      message.content.filter((part) => part.type === 'image_url').length,
    0
  );
}

export function hasImageParts(messages: GeminiMessage[]): boolean {
  return countImageParts(messages) > 0;
}

export function appendImagePartsToLastUserMessage(
  messages: GeminiMessage[],
  imageParts: GeminiMessagePart[]
): GeminiMessage[] {
  if (imageParts.length === 0) {
    return messages;
  }

  const lastUserMessageIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === 'user')?.index;

  if (lastUserMessageIndex == null) {
    return [
      ...messages,
      {
        role: 'user',
        content: imageParts,
      },
    ];
  }

  return messages.map((message, index) =>
    index === lastUserMessageIndex
      ? {
          ...message,
          content: [...message.content, ...imageParts],
        }
      : message
  );
}

/**
 * 将 File 对象转换为 inline_data 消息部分
 * 支持视频、音频、PDF 等任意文件类型
 */
export async function buildInlineDataPart(
  file: File
): Promise<GeminiMessagePart> {
  const dataUrl = await blobToDataUrl(file);
  const commaIndex = dataUrl.indexOf(',');
  return {
    type: 'inline_data',
    mimeType: file.type || 'application/octet-stream',
    data: commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl,
  };
}

/**
 * 将远程文件 URI（如 YouTube URL）转换为 file_uri 消息部分
 */
export function buildFileUriPart(uri: string): GeminiMessagePart {
  return {
    type: 'file_uri',
    fileUri: uri,
  };
}
