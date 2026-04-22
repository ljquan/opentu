import type { Attachment } from '../../types/chat.types';
import { generateReferenceImagesPrompt } from './system-prompts';

type ReferenceImageDimensions = Parameters<
  typeof generateReferenceImagesPrompt
>[1];

export interface ReferenceImagePlaceholderMapping {
  attachmentIndex: number;
  placeholder: string;
}

export interface ReferenceImageContext {
  imageCount: number;
  placeholders: string[];
  placeholderMappings: ReferenceImagePlaceholderMapping[];
  structuredUserMessage: string;
  systemPromptSuffix: string;
}

export function isReferenceImageAttachment(
  attachment: Pick<Attachment, 'type'> | undefined | null
): boolean {
  return typeof attachment?.type === 'string' && attachment.type.startsWith('image/');
}

export function getReferenceImagePlaceholderMappings(
  imageCount: number
): ReferenceImagePlaceholderMapping[] {
  return Array.from({ length: imageCount }, (_, index) => ({
    attachmentIndex: index,
    placeholder: `[图片${index + 1}]`,
  }));
}

export function buildReferenceImageSystemPrompt(
  imageCount: number,
  imageDimensions?: ReferenceImageDimensions
): string {
  if (imageCount <= 0) {
    return '';
  }

  return generateReferenceImagesPrompt(imageCount, imageDimensions);
}

export function buildReferenceImageContext(options: {
  userMessage: string;
  imageCount: number;
  imageDimensions?: ReferenceImageDimensions;
}): ReferenceImageContext | null {
  const { userMessage, imageCount, imageDimensions } = options;
  if (imageCount <= 0) {
    return null;
  }

  const placeholderMappings = getReferenceImagePlaceholderMappings(imageCount);
  const placeholders = placeholderMappings.map((item) => item.placeholder);
  const trimmedUserMessage = userMessage.trim();
  const hasPlaceholderText = placeholders.some((placeholder) =>
    trimmedUserMessage.includes(placeholder)
  );
  const hasReferenceLine = trimmedUserMessage.includes('[参考图片:');
  const structuredUserMessage = [
    hasPlaceholderText
      ? trimmedUserMessage
      : [placeholders.join(' '), trimmedUserMessage].filter(Boolean).join(' '),
    hasReferenceLine
      ? ''
      : `[参考图片: ${placeholders.join('、')}]`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    imageCount,
    placeholders,
    placeholderMappings,
    structuredUserMessage,
    systemPromptSuffix: buildReferenceImageSystemPrompt(
      imageCount,
      imageDimensions
    ),
  };
}

export function buildReferenceImageContextFromAttachments(options: {
  userMessage: string;
  attachments?: Attachment[];
  imageDimensions?: ReferenceImageDimensions;
}): ReferenceImageContext | null {
  const imageCount =
    options.attachments?.filter(isReferenceImageAttachment).length ?? 0;

  return buildReferenceImageContext({
    userMessage: options.userMessage,
    imageCount,
    imageDimensions: options.imageDimensions,
  });
}
