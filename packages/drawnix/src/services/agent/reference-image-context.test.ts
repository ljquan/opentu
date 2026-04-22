import { describe, expect, it } from 'vitest';
import {
  buildReferenceImageContext,
  buildReferenceImageContextFromAttachments,
  getReferenceImagePlaceholderMappings,
} from './reference-image-context';

describe('reference-image-context', () => {
  it('为单张参考图构造占位符语义和系统提示补充', () => {
    const context = buildReferenceImageContext({
      userMessage: '把这个香蕉改新鲜一点',
      imageCount: 1,
    });

    expect(context).not.toBeNull();
    expect(context?.placeholders).toEqual(['[图片1]']);
    expect(context?.placeholderMappings).toEqual([
      {
        attachmentIndex: 0,
        placeholder: '[图片1]',
      },
    ]);
    expect(context?.structuredUserMessage).toContain(
      '[参考图片: [图片1]]'
    );
    expect(context?.systemPromptSuffix).toContain('用户提供了 1 张参考图片');
  });

  it('只把图片附件纳入参考图编号，并保持顺序稳定', () => {
    const context = buildReferenceImageContextFromAttachments({
      userMessage: '把这两张图融合一下',
      attachments: [
        {
          id: 'att-1',
          name: 'banana-1.png',
          type: 'image/png',
          size: 1,
          data: 'data:image/png;base64,banana-1',
          isBlob: false,
        },
        {
          id: 'att-2',
          name: 'notes.pdf',
          type: 'application/pdf',
          size: 1,
          data: 'data:application/pdf;base64,pdf',
          isBlob: false,
        },
        {
          id: 'att-3',
          name: 'banana-2.png',
          type: 'image/png',
          size: 1,
          data: 'data:image/png;base64,banana-2',
          isBlob: false,
        },
      ],
    });

    expect(getReferenceImagePlaceholderMappings(2)).toEqual([
      { attachmentIndex: 0, placeholder: '[图片1]' },
      { attachmentIndex: 1, placeholder: '[图片2]' },
    ]);
    expect(context?.placeholders).toEqual(['[图片1]', '[图片2]']);
    expect(context?.structuredUserMessage).toContain(
      '[参考图片: [图片1]、[图片2]]'
    );
    expect(context?.systemPromptSuffix).toContain('用户提供了 2 张参考图片');
  });
});
