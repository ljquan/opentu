// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addHistoryMock = vi.fn();
const setComposerStateMock = vi.fn();

let mockComposerSync = {
  generationType: 'image',
  selectedModel: 'gemini-3-pro-image-preview-2k',
  selectedModelRef: { profileId: 'profile-1', modelId: 'gemini-3-pro-image-preview-2k' },
  selectedParams: { size: '1024x1024' },
  selectedCount: 2,
  setComposerState: setComposerStateMock,
};

vi.mock('../../../contexts/AIComposerContext', () => ({
  useAIComposerSync: () => mockComposerSync,
}));

vi.mock('../../../hooks/usePromptHistory', () => ({
  usePromptHistory: () => ({
    addHistory: addHistoryMock,
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({
    language: 'zh',
  }),
}));

vi.mock('../../shared/SelectedContentPreview', () => ({
  SelectedContentPreview: () => <div data-testid="selected-content-preview" />,
}));

vi.mock('../../ai-input-bar/GenerationTypeDropdown', () => ({
  GenerationTypeDropdown: () => <div data-testid="generation-type-dropdown" />,
}));

vi.mock('../../ai-input-bar/ModelDropdown', () => ({
  ModelDropdown: () => <div data-testid="model-dropdown" />,
}));

vi.mock('../../ai-input-bar/ParametersDropdown', () => ({
  ParametersDropdown: () => <div data-testid="parameters-dropdown" />,
}));

vi.mock('../../ai-input-bar/CountDropdown', () => ({
  CountDropdown: () => <div data-testid="count-dropdown" />,
}));

vi.mock('../../../hooks/use-runtime-models', () => ({
  useSelectableModels: () => [],
}));

vi.mock('../../../utils/runtime-model-discovery', () => ({
  getPinnedSelectableModel: () => null,
}));

vi.mock('../../../utils/model-selection', () => ({
  findMatchingSelectableModel: () => null,
  getModelRefFromConfig: (model: { id: string }) => ({
    profileId: null,
    modelId: model.id,
  }),
  getSelectionKey: (selectedModel: string) => selectedModel,
}));

vi.mock('../../../contexts/AssetContext', () => ({
  useAssets: () => ({
    addAsset: vi.fn(),
  }),
}));

vi.mock('../../../types/asset.types', () => ({
  AssetType: {
    IMAGE: 'image',
  },
  AssetSource: {
    LOCAL: 'local',
  },
  SelectionMode: {
    SELECT: 'select',
  },
}));

vi.mock('../../media-library/MediaLibraryModal', () => ({
  MediaLibraryModal: (props: {
    isOpen?: boolean;
    onClose?: () => void;
    onSelect?: (asset: { id: string; url: string; name: string }) => void;
  }) =>
    props.isOpen ? (
      <div data-testid="media-library-modal">
        <button
          type="button"
          onClick={() =>
            props.onSelect?.({
              id: 'asset-1',
              url: 'library://asset-1',
              name: '素材图.png',
            })
          }
        >
          select-library-asset
        </button>
        <button type="button" onClick={props.onClose}>
          close-library
        </button>
      </div>
    ) : null,
}));

vi.mock('../../../constants/model-config', () => ({
  getCompatibleParams: () => [],
  getDefaultSizeForModel: () => '1024x1024',
}));

vi.mock('../../../services/video-binding-utils', () => ({
  getEffectiveVideoCompatibleParams: () => [],
}));

vi.mock('../../icons', () => ({
  ImageUploadIcon: () => <span data-testid="upload-icon" />,
  MediaLibraryIcon: () => <span data-testid="library-icon" />,
}));

vi.mock('tdesign-react', () => ({
  MessagePlugin: {
    error: vi.fn(),
  },
}));

describe('EnhancedChatInput', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsDataURL() {
        this.result = 'data:image/png;base64,uploaded';
        this.onload?.call(
          this as unknown as FileReader,
          { target: this } as ProgressEvent<FileReader>
        );
      }
    }

    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 640;
      naturalHeight = 480;

      set src(_value: string) {
        this.onload?.();
      }
    }

    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader);
    vi.stubGlobal('Image', MockImage as unknown as typeof Image);
    mockComposerSync = {
      generationType: 'image',
      selectedModel: 'gemini-3-pro-image-preview-2k',
      selectedModelRef: {
        profileId: 'profile-1',
        modelId: 'gemini-3-pro-image-preview-2k',
      },
      selectedParams: { size: '1024x1024' },
      selectedCount: 2,
      setComposerState: setComposerStateMock,
    };
  });

  it('只保留简洁输入框和发送按钮，不再渲染抽屉内配置控件', async () => {
    const { EnhancedChatInput } = await import('../EnhancedChatInput');

    const view = render(
      <EnhancedChatInput
        selectedContent={[]}
        onSendMessage={vi.fn()}
      />
    );

    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy();
    const uploadButton = screen.getByRole('button', { name: '插入文件' });
    expect(uploadButton).toBeTruthy();
    expect(uploadButton.getAttribute('title')).toBe('插入文件');
    expect(uploadButton.className).not.toContain(
      'enhanced-chat-input__tool-button--selected'
    );
    expect(screen.queryByText('插入文件')).toBeNull();
    const libraryButton = screen.getByRole('button', { name: '素材库' });
    expect(libraryButton).toBeTruthy();
    expect(libraryButton.getAttribute('title')).toBe('素材库');
    expect(libraryButton.className).not.toContain(
      'enhanced-chat-input__tool-button--selected'
    );
    expect(screen.queryByText('素材库')).toBeNull();
    expect(view.container.querySelector('.enhanced-chat-input__library-label')).toBeNull();
    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.getAttribute('style')).toContain('display: none');
    expect(view.container.querySelector('.enhanced-chat-input__bottom-bar')).toBeTruthy();
    expect(view.container.querySelector('.enhanced-chat-input__tools')).toBeTruthy();
    expect(view.container.querySelector('.enhanced-chat-input__action-group')).toBeTruthy();
    expect(
      view.container.querySelector('.enhanced-chat-input__actions')?.className
    ).not.toContain('enhanced-chat-input__actions--bottom');
    expect(
      view.container
        .querySelector('.enhanced-chat-input__form')
        ?.contains(
          view.container.querySelector('.enhanced-chat-input__bottom-bar')
        )
    ).toBe(true);
    expect(
      screen.queryByTestId('generation-type-dropdown')
    ).toBeNull();
    expect(screen.queryByTestId('model-dropdown')).toBeNull();
    expect(screen.queryByTestId('parameters-dropdown')).toBeNull();
    expect(screen.queryByTestId('count-dropdown')).toBeNull();
    expect(screen.queryByTitle('上传图片')).toBeNull();
    expect(view.container.querySelector('.enhanced-chat-input__surface')).toBeNull();
  });

  it('选择本地文件后只更新抽屉本地附件状态', async () => {
    const { EnhancedChatInput } = await import('../EnhancedChatInput');

    const view = render(
      <EnhancedChatInput
        selectedContent={[]}
        onSendMessage={vi.fn()}
      />
    );

    const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(['demo'], 'demo.png', { type: 'image/png' });
    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '插入文件' }).className
      ).toContain('enhanced-chat-input__tool-button--selected');
      expect(screen.getByTestId('selected-content-preview')).toBeTruthy();
    });
  });

  it('点击素材库按钮后可以打开弹窗并把素材写入抽屉本地附件状态', async () => {
    const { EnhancedChatInput } = await import('../EnhancedChatInput');

    render(
      <EnhancedChatInput
        selectedContent={[]}
        onSendMessage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    expect(screen.getByTestId('media-library-modal')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'select-library-asset' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '素材库' }).className
      ).toContain('enhanced-chat-input__tool-button--selected');
      expect(screen.getByTestId('selected-content-preview')).toBeTruthy();
    });
  });

  it('无论外部共享模式是什么，抽屉发送都固定走 agent 对话链路，并只带抽屉本地附件', async () => {
    const onSendMessage = vi.fn();
    const { EnhancedChatInput } = await import('../EnhancedChatInput');

    const view = render(
      <EnhancedChatInput
        selectedContent={[]}
        onSendMessage={onSendMessage}
      />
    );

    const fileInput = view.container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File(['demo'], 'demo.png', { type: 'image/png' });
    fireEvent.change(fileInput, {
      target: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '插入文件' }).className
      ).toContain('enhanced-chat-input__tool-button--selected');
    });

    fireEvent.change(view.getByRole('textbox'), {
      target: { value: '生成一个苹果' },
    });
    fireEvent.click(view.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'user',
          parts: [
            { type: 'text', text: '生成一个苹果' },
            {
              type: 'data-file',
              data: {
                filename: 'image-1.png',
                mediaType: 'image/png',
                url: 'data:image/png;base64,uploaded',
              },
            },
          ],
        })
      );
      expect(addHistoryMock).toHaveBeenCalledWith('生成一个苹果', true, 'agent');
      expect(
        screen.getByRole('button', { name: '插入文件' }).className
      ).not.toContain('enhanced-chat-input__tool-button--selected');
    });
  });

  it('外部切到图片模式时，占位文案仍保持 agent 语义', async () => {
    const { EnhancedChatInput } = await import('../EnhancedChatInput');

    render(
      <EnhancedChatInput
        selectedContent={[]}
        onSendMessage={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText('输入指令，让 Agent 为你工作...')).toBeTruthy();
  });

  it('按回车提交时会立即清空输入框，不等待父层发送完成', async () => {
    const { EnhancedChatInput } = await import('../EnhancedChatInput');
    let resolveSend: (() => void) | undefined;
    const onSendMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        })
    );

    render(
      <EnhancedChatInput
        selectedContent={[]}
        onSendMessage={onSendMessage}
      />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '帮我把上面的香蕉改的新鲜一点。' },
    });

    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
    });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe('');

    resolveSend?.();
  });

  it('父层发送失败时会恢复原始草稿', async () => {
    const { EnhancedChatInput } = await import('../EnhancedChatInput');
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const onSendMessage = vi.fn().mockRejectedValue(new Error('send failed'));

    render(
      <EnhancedChatInput
        selectedContent={[]}
        onSendMessage={onSendMessage}
      />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: '帮我把上面的香蕉改的新鲜一点。' },
    });
    fireEvent.keyDown(textarea, {
      key: 'Enter',
      code: 'Enter',
      charCode: 13,
    });

    await waitFor(() => {
      expect(textarea.value).toBe('帮我把上面的香蕉改的新鲜一点。');
    });

    consoleErrorSpy.mockRestore();
  });
});
