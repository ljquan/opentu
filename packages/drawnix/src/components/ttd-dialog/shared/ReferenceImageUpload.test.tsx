// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React, { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetSource, AssetType, type Asset } from '../../../types/asset.types';
import { getImageNaturalSize } from '../../../utils/image-natural-size';
import { useLocalFileDrop } from '../../shared/local-image-drag-drop';
import {
  ReferenceImageUpload,
  type ReferenceImage,
  type ReferenceImageUploadHandle,
} from './ReferenceImageUpload';

const cacheMocks = vi.hoisted(() => ({
  getCachedBlob: vi.fn(),
}));
const assetMocks = vi.hoisted(() => ({
  addAsset: vi.fn().mockResolvedValue(undefined),
}));
const messageMocks = vi.hoisted(() => ({
  close: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../../../services/unified-cache-service', () => ({
  unifiedCacheService: cacheMocks,
}));

vi.mock('../../../contexts/AssetContext', () => ({
  useAssets: () => assetMocks,
}));

vi.mock('../../../utils/image-natural-size', () => ({
  getImageNaturalSize: vi.fn().mockResolvedValue({ width: 600, height: 800 }),
}));

vi.mock('tdesign-react', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  MessagePlugin: messageMocks,
}));

vi.mock('lucide-react', () => ({
  X: () => <span aria-hidden="true" />,
}));

const generatedAsset: Asset = {
  id: 'generated-image-1',
  type: AssetType.IMAGE,
  source: AssetSource.AI_GENERATED,
  url: '/__aitu_cache__/image/generated-image-1.png',
  name: 'generated-image-1.png',
  mimeType: 'image/png',
  createdAt: 1,
  size: 4,
};

let selectedAsset = generatedAsset;
let selectedAssets = [generatedAsset];

function DialogDropHarness({
  images = [],
  disabled = false,
  maxCount = 10,
  onImagesChange,
}: {
  images?: ReferenceImage[];
  disabled?: boolean;
  maxCount?: number;
  onImagesChange: (images: ReferenceImage[]) => void;
}) {
  const uploadRef = useRef<ReferenceImageUploadHandle>(null);
  const { dropTargetProps } = useLocalFileDrop({
    disabled,
    onFiles: (files) => uploadRef.current?.importFiles(files),
  });

  return (
    <div
      data-testid="dialog-drop-target"
      onDragEnterCapture={dropTargetProps.onDragEnter}
      onDragOverCapture={dropTargetProps.onDragOver}
      onDragLeaveCapture={dropTargetProps.onDragLeave}
      onDropCapture={dropTargetProps.onDrop}
    >
      <ReferenceImageUpload
        ref={uploadRef}
        images={images}
        disabled={disabled}
        maxCount={maxCount}
        onImagesChange={onImagesChange}
      />
    </div>
  );
}

vi.mock('../../media-library/MediaLibraryModal', () => ({
  MediaLibraryModal: ({
    onSelect,
    onSelectMultiple,
  }: {
    onSelect?: (asset: Asset) => void;
    onSelectMultiple?: (assets: Asset[]) => void;
  }) => (
    <>
      <button type="button" onClick={() => onSelect?.(selectedAsset)}>
        使用测试素材
      </button>
      {onSelectMultiple && (
        <button type="button" onClick={() => onSelectMultiple(selectedAssets)}>
          批量使用测试素材
        </button>
      )}
    </>
  ),
}));

describe('ReferenceImageUpload media library selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetMocks.addAsset.mockResolvedValue(undefined);
    vi.mocked(getImageNaturalSize).mockResolvedValue({ width: 600, height: 800 });
    selectedAsset = generatedAsset;
    selectedAssets = [generatedAsset];
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('imports a nested dialog drop exactly once through the existing file pipeline', async () => {
    const onImagesChange = vi.fn();
    const image = new File(['image'], 'reference.png', { type: 'image/png' });
    const dataTransfer = {
      files: [image] as unknown as FileList,
      types: ['Files'],
      dropEffect: 'none',
    };
    const { container } = render(
      <DialogDropHarness onImagesChange={onImagesChange} />
    );
    const nestedTarget = container.querySelector(
      '.reference-image-upload__placeholder'
    );
    expect(nestedTarget).not.toBeNull();

    await act(async () => {
      fireEvent.drop(nestedTarget as Element, { dataTransfer });
    });

    await waitFor(() => expect(onImagesChange).toHaveBeenCalledTimes(1));
    expect(onImagesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: image.name,
        url: 'data:image/png;base64,aW1hZ2U=',
        width: 600,
        height: 800,
      }),
    ]);
    expect(assetMocks.addAsset).toHaveBeenCalledTimes(1);
  });

  it('imports multiple dropped images in their original order', async () => {
    const onImagesChange = vi.fn();
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.webp', {
      type: 'image/webp',
    });
    render(<DialogDropHarness onImagesChange={onImagesChange} />);

    fireEvent.drop(screen.getByTestId('dialog-drop-target'), {
      dataTransfer: {
        files: [first, second] as unknown as FileList,
        types: ['Files'],
      },
    });

    await waitFor(() => expect(onImagesChange).toHaveBeenCalledTimes(1));
    expect(onImagesChange.mock.calls[0][0].map((image) => image.name)).toEqual([
      'first.png',
      'second.webp',
    ]);
    expect(assetMocks.addAsset).toHaveBeenCalledTimes(2);
  });

  it('keeps non-image drops in the existing validation path', () => {
    const onImagesChange = vi.fn();
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    render(<DialogDropHarness onImagesChange={onImagesChange} />);

    fireEvent.drop(screen.getByTestId('dialog-drop-target'), {
      dataTransfer: {
        files: [text] as unknown as FileList,
        types: ['Files'],
      },
    });

    expect(messageMocks.error).toHaveBeenCalledWith('请上传图片文件');
    expect(onImagesChange).not.toHaveBeenCalled();
    expect(assetMocks.addAsset).not.toHaveBeenCalled();
  });

  it('enforces the existing image count limit for dialog drops', () => {
    const onImagesChange = vi.fn();
    const image = new File(['image'], 'second.png', { type: 'image/png' });
    render(
      <DialogDropHarness
        images={[{ url: 'data:image/png;base64,Zmlyc3Q=', name: 'first.png' }]}
        maxCount={1}
        onImagesChange={onImagesChange}
      />
    );

    fireEvent.drop(screen.getByTestId('dialog-drop-target'), {
      dataTransfer: {
        files: [image] as unknown as FileList,
        types: ['Files'],
      },
    });

    expect(messageMocks.warning).toHaveBeenCalledWith('最多上传 1 张图片');
    expect(onImagesChange).not.toHaveBeenCalled();
    expect(assetMocks.addAsset).not.toHaveBeenCalled();
  });

  it('ignores dialog drops while reference input is disabled', () => {
    const onImagesChange = vi.fn();
    const image = new File(['image'], 'reference.png', { type: 'image/png' });
    render(<DialogDropHarness disabled onImagesChange={onImagesChange} />);

    fireEvent.drop(screen.getByTestId('dialog-drop-target'), {
      dataTransfer: {
        files: [image] as unknown as FileList,
        types: ['Files'],
      },
    });

    expect(onImagesChange).not.toHaveBeenCalled();
    expect(assetMocks.addAsset).not.toHaveBeenCalled();
  });

  it('loads a newly generated virtual asset from the unified cache when fetch is unavailable', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    cacheMocks.getCachedBlob.mockResolvedValue(
      new Blob(['png'], { type: 'image/png' })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '使用测试素材' }));

    await waitFor(() => {
      expect(onImagesChange).toHaveBeenCalledWith([
        expect.objectContaining({
          name: generatedAsset.name,
          url: 'data:image/png;base64,cG5n',
          width: 600,
          height: 800,
        }),
      ]);
    });
    expect(cacheMocks.getCachedBlob).toHaveBeenCalledWith(generatedAsset.url);
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('rejects a successful non-image response instead of importing it as a reference image', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cacheMocks.getCachedBlob.mockResolvedValue(
      new Blob(['<html>app shell</html>'], { type: 'text/html' })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>app shell</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '使用测试素材' }));

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith('加载图片失败');
    });
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('keeps an unreadable remote AI image as a reference URL', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    const remoteAsset: Asset = {
      ...generatedAsset,
      url: 'https://apioss28.sydney-ai.com/img/generated.png',
    };
    selectedAsset = remoteAsset;
    cacheMocks.getCachedBlob.mockResolvedValue(null);

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '使用测试素材' }));

    await waitFor(() => {
      expect(onImagesChange).toHaveBeenCalledWith([
        {
          name: remoteAsset.name,
          url: remoteAsset.url,
        },
      ]);
    });
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it.each([
    {
      name: 'a local asset',
      asset: {
        ...generatedAsset,
        source: AssetSource.LOCAL,
        url: 'https://example.com/local.png',
      },
    },
    {
      name: 'an AI asset with a non-image MIME',
      asset: {
        ...generatedAsset,
        mimeType: 'text/plain',
        url: 'https://apioss28.sydney-ai.com/img/not-an-image.txt',
      },
    },
  ])('rejects remote URL fallback for $name', async ({ asset }) => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    selectedAsset = asset;
    cacheMocks.getCachedBlob.mockResolvedValue(null);

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '使用测试素材' }));

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith('加载图片失败');
    });
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('rejects an empty virtual cached Blob', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cacheMocks.getCachedBlob.mockResolvedValue(
      new Blob([], { type: 'image/png' })
    );

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '使用测试素材' }));

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith('加载图片失败');
    });
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('uses image metadata when a historical image Blob has a generic MIME', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    cacheMocks.getCachedBlob.mockResolvedValue(
      new Blob(['png'], { type: 'application/octet-stream' })
    );

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '使用测试素材' }));

    await waitFor(() => {
      expect(onImagesChange).toHaveBeenCalledWith([
        expect.objectContaining({
          url: 'data:image/png;base64,cG5n',
          width: 600,
          height: 800,
        }),
      ]);
    });
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('rejects a non-image asset even when its cached Blob is generic', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    selectedAsset = {
      ...generatedAsset,
      type: AssetType.VIDEO,
      mimeType: 'video/mp4',
    };
    cacheMocks.getCachedBlob.mockResolvedValue(
      new Blob(['video'], { type: 'application/octet-stream' })
    );

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '使用测试素材' }));

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith('加载图片失败');
    });
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('keeps the load error when every asset in a batch is unavailable', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cacheMocks.getCachedBlob.mockResolvedValue(null);

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '批量使用测试素材' }));

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith('加载图片失败');
    });
    expect(onImagesChange).not.toHaveBeenCalled();
  });

  it('keeps successful batch entries and reports a partial load failure', async () => {
    const onImagesChange = vi.fn();
    const onError = vi.fn();
    const unavailableAsset: Asset = {
      ...generatedAsset,
      id: 'generated-image-2',
      url: '/__aitu_cache__/image/generated-image-2.png',
      name: 'generated-image-2.png',
    };
    selectedAssets = [generatedAsset, unavailableAsset];
    cacheMocks.getCachedBlob
      .mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }))
      .mockResolvedValueOnce(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ReferenceImageUpload
        images={[]}
        onImagesChange={onImagesChange}
        onError={onError}
        multiple
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: '批量使用测试素材' }));

    await waitFor(() => {
      expect(onImagesChange).toHaveBeenCalledWith([
        expect.objectContaining({ name: generatedAsset.name }),
      ]);
    });
    expect(onError).toHaveBeenLastCalledWith('加载图片失败');
  });
});
