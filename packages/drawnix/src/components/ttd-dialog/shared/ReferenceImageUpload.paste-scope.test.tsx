// @vitest-environment jsdom
import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReferenceImageUpload,
  type ReferenceImage,
} from './ReferenceImageUpload';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const addAsset = vi.fn(() => Promise.resolve());
let roots: Root[] = [];

vi.mock('tdesign-react', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  MessagePlugin: {
    close: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'message-id'),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('lucide-react', () => ({
  X: () => <span aria-hidden="true" />,
}));

vi.mock('../../icons', () => ({
  ImageUploadIcon: () => <span aria-hidden="true" />,
  MediaLibraryIcon: () => <span aria-hidden="true" />,
}));

vi.mock('../../media-library/MediaLibraryModal', () => ({
  MediaLibraryModal: () => null,
}));

vi.mock('../../../contexts/AssetContext', () => ({
  useAssets: () => ({ addAsset }),
}));

function PasteScopeHarness({
  images,
  onImagesChange,
}: {
  images: ReferenceImage[];
  onImagesChange: (images: ReferenceImage[]) => void;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <div ref={scopeRef}>
        <textarea aria-label="图片描述" />
      </div>
      <textarea aria-label="同一表单其他输入框" />
      <ReferenceImageUpload
        images={images}
        onImagesChange={onImagesChange}
        pasteScopeRef={scopeRef}
      />
    </div>
  );
}

function dispatchPaste(target: HTMLElement, items: DataTransferItem[]) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items },
  });
  target.dispatchEvent(event);
  return event;
}

function getTextarea(label: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${label}"]`
  );
  if (!textarea) {
    throw new Error(`Textarea not found: ${label}`);
  }
  return textarea;
}

describe('ReferenceImageUpload paste scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    roots.forEach((root) => {
      act(() => root.unmount());
    });
    roots = [];
    document.body.innerHTML = '';
  });

  const renderHarness = (
    onImagesChange: (images: ReferenceImage[]) => void
  ) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <PasteScopeHarness images={[]} onImagesChange={onImagesChange} />
      );
    });
  };

  it('图片描述输入框聚焦时将粘贴图片加入参考图', async () => {
    const onImagesChange = vi.fn();
    renderHarness(onImagesChange);
    const textarea = getTextarea('图片描述');
    textarea.focus();

    const image = new File(['image-data'], 'reference.png', {
      type: 'image/png',
    });
    const event = dispatchPaste(textarea, [
      {
        kind: 'file',
        type: image.type,
        getAsFile: () => image,
      } as DataTransferItem,
    ]);

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(onImagesChange).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'reference.png' }),
      ]);
    });
  });

  it('图片描述作用域外的同一表单输入框不接管图片粘贴', () => {
    const onImagesChange = vi.fn();
    renderHarness(onImagesChange);
    const textarea = getTextarea('同一表单其他输入框');
    textarea.focus();

    const image = new File(['image-data'], 'reference.png', {
      type: 'image/png',
    });
    const event = dispatchPaste(textarea, [
      {
        kind: 'file',
        type: image.type,
        getAsFile: () => image,
      } as DataTransferItem,
    ]);

    expect(event.defaultPrevented).toBe(false);
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('纯文本粘贴不拦截图片描述输入', () => {
    const onImagesChange = vi.fn();
    renderHarness(onImagesChange);
    const textarea = getTextarea('图片描述');
    textarea.focus();

    const event = dispatchPaste(textarea, [
      {
        kind: 'string',
        type: 'text/plain',
        getAsFile: () => null,
      } as DataTransferItem,
    ]);

    expect(event.defaultPrevented).toBe(false);
    expect(onImagesChange).not.toHaveBeenCalled();
  });
});
