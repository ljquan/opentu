// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { EnhancedChatInput } from '../EnhancedChatInput';

const submitGenerationFromDrawerMock = vi.fn(async () => true);
type GenerationType = 'image' | 'video' | 'audio' | 'text' | 'agent';
let generationTypeMock: GenerationType = 'agent';

vi.mock('../../../contexts/ChatDrawerContext', () => ({
  useChatDrawerControl: () => ({
    submitGenerationFromDrawer: submitGenerationFromDrawerMock,
  }),
}));

vi.mock('../../../hooks/usePromptHistory', () => ({
  usePromptHistory: () => ({
    addHistory: () => undefined,
  }),
}));

vi.mock('../../../i18n', () => ({
  useI18n: () => ({
    language: 'zh',
  }),
}));

vi.mock('../../../contexts/AssetContext', () => ({
  useAssets: () => ({
    addAsset: async () => undefined,
  }),
}));

vi.mock('../useChatDrawerGenerationControls', () => ({
  useChatDrawerGenerationControls: () => ({
    generationType: generationTypeMock,
    setGenerationType: () => undefined,
    selectedModel: 'gpt-5.4',
    selectedModelRef: null,
    selectedSelectionKey: 'gpt-5.4',
    selectedParams: {},
    compatibleParams: [],
    selectedCount: 1,
    setSelectedCount: () => undefined,
    currentModels: [],
    handleModelSelect: () => undefined,
    handleModelConfigSelect: () => undefined,
    handleParamSelect: () => undefined,
  }),
}));

vi.mock('../../shared/SelectedContentPreview', () => ({
  SelectedContentPreview: () => (
    <div data-testid="selected-content-preview">selected</div>
  ),
}));

vi.mock('../../ai-input-bar/GenerationTypeDropdown', () => ({
  GenerationTypeDropdown: () => <button type="button">类型</button>,
}));

vi.mock('../../ai-input-bar/ModelDropdown', () => ({
  ModelDropdown: () => <button type="button">模型</button>,
}));

vi.mock('../../ai-input-bar/ParametersDropdown', () => ({
  ParametersDropdown: () => <button type="button">参数</button>,
}));

vi.mock('../../ai-input-bar/CountDropdown', () => ({
  CountDropdown: () => <button type="button">数量</button>,
}));

vi.mock('../../media-library/MediaLibraryModal', () => ({
  MediaLibraryModal: () => <div data-testid="media-library-modal" />,
}));

vi.mock('../../icons', () => ({
  ImageUploadIcon: () => <span aria-hidden="true">upload</span>,
  MediaLibraryIcon: () => <span aria-hidden="true">library</span>,
}));

beforeEach(() => {
  generationTypeMock = 'agent';
  submitGenerationFromDrawerMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('EnhancedChatInput placeholder', () => {
  it('renders through the shared drawer composer shell', () => {
    render(
      <EnhancedChatInput
        selectedContent={[]}
        onSend={() => undefined}
        placeholder="继续描述要修改的内容..."
      />
    );

    expect(screen.getByTestId('ai-input-composer-shell-drawer')).toBeTruthy();
    expect(screen.getByTestId('drawer-ai-send-btn')).toBeTruthy();
    expect(screen.getByText('类型')).toBeTruthy();
    expect(screen.getByText('模型')).toBeTruthy();
  });

  it('uses continuation copy when there is no attached content', () => {
    render(
      <EnhancedChatInput
        selectedContent={[]}
        onSend={() => undefined}
        placeholder="继续描述要修改的内容..."
      />
    );

    expect(screen.getByPlaceholderText('继续描述要修改的内容...')).toBeTruthy();
  });

  it('keeps effect-description copy when content is attached', () => {
    render(
      <EnhancedChatInput
        selectedContent={[
          {
            type: 'image',
            name: '参考图',
            url: 'data:image/png;base64,abc',
          },
        ]}
        onSend={() => undefined}
        placeholder="继续描述要修改的内容..."
      />
    );

    expect(screen.getByPlaceholderText('描述你想要的效果...')).toBeTruthy();
  });
});

describe('EnhancedChatInput implicit workflow references', () => {
  const implicitReferenceContent = [
    {
      type: 'image' as const,
      name: '上一次生成结果',
      url: '/previous-result.png',
    },
  ];

  it('uses implicit references for image edits that mention prior results', async () => {
    generationTypeMock = 'image';

    render(
      <EnhancedChatInput
        selectedContent={[]}
        implicitReferenceContent={implicitReferenceContent}
        onSend={() => undefined}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '把上面的人改成小李子' },
    });
    fireEvent.click(screen.getByTestId('drawer-ai-send-btn'));

    expect(submitGenerationFromDrawerMock).toHaveBeenCalledTimes(1);
    expect(submitGenerationFromDrawerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '把上面的人改成小李子',
        selectedContent: implicitReferenceContent,
        generationType: 'image',
      })
    );
  });

  it('does not use implicit references for unrelated image prompts', async () => {
    generationTypeMock = 'image';

    render(
      <EnhancedChatInput
        selectedContent={[]}
        implicitReferenceContent={implicitReferenceContent}
        onSend={() => undefined}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '生成一只猫' },
    });
    fireEvent.click(screen.getByTestId('drawer-ai-send-btn'));

    expect(submitGenerationFromDrawerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedContent: [],
      })
    );
  });

  it('uses pinned reply references and consumes them after submit', async () => {
    generationTypeMock = 'image';
    const onImplicitReferenceConsumed = vi.fn();

    render(
      <EnhancedChatInput
        selectedContent={[]}
        implicitReferenceContent={implicitReferenceContent}
        implicitReferenceLabel="回复：图片生成"
        implicitReferencePinned
        onImplicitReferenceConsumed={onImplicitReferenceConsumed}
        onSend={() => undefined}
      />
    );

    expect(screen.getByText('回复：图片生成')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '换成小李子' },
    });
    fireEvent.click(screen.getByTestId('drawer-ai-send-btn'));

    expect(submitGenerationFromDrawerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedContent: implicitReferenceContent,
      })
    );
    await waitFor(() => {
      expect(onImplicitReferenceConsumed).toHaveBeenCalledTimes(1);
    });
  });
});
