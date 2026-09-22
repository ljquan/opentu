// @vitest-environment jsdom
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import { ModelDropdown } from './ModelDropdown';

const {
  discoverMock,
  applySelectionMock,
  setErrorMock,
  getStateMock,
  isTuziEmbeddedModeMock,
  requestContextMock,
  queueNavigationMock,
  saveActiveGroupMock,
} = vi.hoisted(() => ({
  discoverMock: vi.fn(),
  applySelectionMock: vi.fn(),
  setErrorMock: vi.fn(),
  getStateMock: vi.fn(),
  isTuziEmbeddedModeMock: vi.fn(),
  requestContextMock: vi.fn(),
  queueNavigationMock: vi.fn(),
  saveActiveGroupMock: vi.fn(),
}));

vi.mock('../../utils/runtime-model-discovery', () => ({
  runtimeModelDiscovery: {
    getState: getStateMock,
    subscribe: () => () => undefined,
    getRevision: () => 0,
    getInFlightDiscovery: () => null,
    discover: discoverMock,
    applySelection: applySelectionMock,
    setError: setErrorMock,
  },
}));

vi.mock('../../hooks/use-drawnix', () => ({
  useDrawnix: () => ({ setAppState: vi.fn() }),
}));

vi.mock('../../hooks/use-provider-profiles', () => ({
  useProviderProfiles: () => [
    {
      id: 'tuzi-provider',
      name: 'Tuzi Provider',
      enabled: true,
    },
  ],
}));

vi.mock('../../services/tuzi-embedded-config', () => ({
  isTuziEmbeddedMode: isTuziEmbeddedModeMock,
}));

vi.mock('../../services/tuzi-postmessage-bridge', () => ({
  TUZI_BRIDGE_EVENT: 'opentu:tuzi-bridge-status',
  requestTuziParentContext: requestContextMock,
}));

vi.mock('../../services/tuzi-token-auth', () => ({
  getTuziSystemUserId: () => '40832',
}));

vi.mock('../../services/tuzi-provider-selection', () => ({
  saveTuziActiveProviderGroup: saveActiveGroupMock,
}));

vi.mock('../settings-dialog/provider-settings-navigation', () => ({
  queueProviderSettingsNavigation: queueNavigationMock,
}));

vi.mock('../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID: 'tuzi-original',
  TUZI_DEFAULT_PROVIDER_NAME: 'Tuzi',
  TUZI_PROVIDER_ICON_URL: 'https://tuzi.example/icon.png',
  providerCatalogsSettings: {
    get: () => [],
    addListener: vi.fn(),
    removeListener: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  },
  createModelRef: (profileId: string | null, modelId: string) => ({
    profileId,
    modelId,
  }),
}));

vi.mock('../../hooks/use-model-pricing', () => ({
  useFormattedModelPrice: () => '',
  useModelPriceText: () => ({ summary: '', detail: '' }),
  useModelMeta: () => null,
}));

vi.mock('../../utils/model-pricing-service', () => ({
  modelPricingService: {
    getModelPrice: vi.fn(() => null),
  },
}));

vi.mock('../shared/ModelHealthBadge', () => ({
  ModelHealthBadge: () => null,
}));

vi.mock('../shared/ModelBenchmarkBadge', () => ({
  ModelBenchmarkBadge: () => null,
}));

describe('ModelDropdown', () => {
  beforeEach(() => {
    isTuziEmbeddedModeMock.mockReturnValue(false);
    requestContextMock.mockResolvedValue(null);
    discoverMock.mockResolvedValue([]);
    getStateMock.mockReturnValue({
      status: 'idle',
      discoveredModels: [],
      selectedModelIds: [],
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    discoverMock.mockReset();
    applySelectionMock.mockReset();
    setErrorMock.mockReset();
    getStateMock.mockReset();
    isTuziEmbeddedModeMock.mockReset();
    requestContextMock.mockReset();
    queueNavigationMock.mockReset();
    saveActiveGroupMock.mockReset();
    cleanup();
  });

  const baseModel: ModelConfig = {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    shortCode: 'gpt2',
    type: 'image',
    vendor: ModelVendor.GPT,
    sourceProfileId: 'tuzi-provider',
    sourceProfileName: 'Tuzi Provider',
    selectionKey: 'tuzi-provider::gpt-image-2',
  };

  it('shows the Tuzi add-group action and opens group management', async () => {
    const managedModel: ModelConfig = {
      ...baseModel,
      sourceProfileId: 'tuzi-managed-default',
      sourceProfileName: 'default 分组',
      selectionKey: 'tuzi-managed-default::gpt-image-2',
    };
    const { container } = render(
      <ModelDropdown
        selectedModel={managedModel.id}
        selectedSelectionKey={managedModel.selectionKey}
        models={[managedModel]}
        providerProfilesOverride={[
          {
            id: 'tuzi-managed-default',
            name: 'default 分组',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'sk-managed',
            pricingGroup: 'default',
            enabled: true,
            providerType: 'openai-compatible',
            authType: 'bearer',
          },
        ]}
        onSelect={vi.fn()}
      />
    );

    await act(async () => undefined);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('opentu:tuzi-bridge-status', {
          detail: { mode: 'tuzi' },
        })
      );
    });

    fireEvent.mouseDown(
      container.querySelector(
        '.model-dropdown__trigger--minimal'
      ) as HTMLElement
    );
    const addGroupButton = await waitFor(() => {
      const button = document.querySelector(
        '.model-dropdown__provider-action'
      ) as HTMLButtonElement | null;
      expect(button?.textContent).toContain('添加分组');
      return button as HTMLButtonElement;
    });
    fireEvent.click(addGroupButton);

    await waitFor(() =>
      expect(queueNavigationMock).toHaveBeenCalledWith({
        action: 'tuzi-groups',
      })
    );
  });

  it('switches the remembered active group when selecting its model', async () => {
    const onSelect = vi.fn();
    const managedModel: ModelConfig = {
      ...baseModel,
      sourceProfileId: 'tuzi-managed-vip',
      sourceProfileName: 'vip 分组',
      selectionKey: 'tuzi-managed-vip::gpt-image-2',
    };
    render(
      <ModelDropdown
        selectedModel=""
        models={[managedModel]}
        isOpen
        providerProfilesOverride={[
          {
            id: 'tuzi-managed-vip',
            name: 'vip 分组',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'sk-vip',
            pricingGroup: 'vip',
            enabled: true,
            providerType: 'openai-compatible',
            authType: 'bearer',
          },
        ]}
        onSelect={onSelect}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText('搜索模型名 / 展示名 / 供应商'),
      {
        target: { value: 'gpt-image-2' },
      }
    );
    fireEvent.click(await screen.findByRole('option', { hidden: true }));

    expect(saveActiveGroupMock).toHaveBeenCalledWith('40832', 'vip');
    expect(onSelect).toHaveBeenCalled();
  });

  function mockRect(
    element: Element,
    rect: Pick<DOMRect, 'top' | 'left' | 'bottom' | 'width'>
  ) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: rect.left,
      y: rect.top,
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.left + rect.width,
      width: rect.width,
      height: rect.bottom - rect.top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it('外层反显 HappyHorse 时使用模型厂商 logo', () => {
    const happyHorseModel: ModelConfig = {
      id: 'happyhorse-1.0-i2v',
      label: 'HappyHorse 1.0 I2V',
      shortCode: 'h10i',
      type: 'video',
      vendor: ModelVendor.HAPPYHORSE,
      sourceProfileId: 'tuzi-provider',
      sourceProfileName: 'Tuzi Provider',
      selectionKey: 'tuzi-provider::happyhorse-1.0-i2v',
    };

    const { container } = render(
      <ModelDropdown
        selectedModel={happyHorseModel.id}
        selectedSelectionKey={happyHorseModel.selectionKey}
        models={[happyHorseModel]}
        onSelect={vi.fn()}
      />
    );

    const trigger = container.querySelector(
      '.model-dropdown__trigger--minimal'
    );
    const icon = trigger?.querySelector('img');

    expect(trigger?.textContent).toContain('#h10i');
    expect(icon?.getAttribute('src')).toBe('https://happyhorse.app/logo.webp');
  });

  it('placement auto 时可渲染 portal 菜单并自动向上避让底部', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 600,
    });

    const { container } = render(
      <ModelDropdown
        selectedModel={baseModel.id}
        selectedSelectionKey={baseModel.selectionKey}
        models={[baseModel]}
        onSelect={vi.fn()}
      />
    );
    const wrapper = container.querySelector('.model-dropdown') as HTMLElement;
    mockRect(wrapper, { top: 520, left: 42, bottom: 552, width: 180 });

    fireEvent.mouseDown(
      container.querySelector(
        '.model-dropdown__trigger--minimal'
      ) as HTMLElement
    );

    const menu = document.body.querySelector(
      '.model-dropdown__menu'
    ) as HTMLElement;

    expect(menu).toBeTruthy();
    expect(menu.classList.contains('model-dropdown__menu--up')).toBe(true);
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.left).toBe('42px');
    expect(menu.style.bottom).toBe('84px');
  });

  it('没有候选模型时显示明确空态而不是默认模型代号', () => {
    const { container } = render(
      <ModelDropdown
        selectedModel="doubao-seedance-2-0-260128"
        models={[]}
        onSelect={vi.fn()}
        emptyTriggerLabel="暂无已配置视频模型"
        emptyText="请先在供应商设置中获取并勾选视频模型"
        strictModelList
      />
    );

    const trigger = container.querySelector(
      '.model-dropdown__trigger--minimal'
    ) as HTMLElement;
    expect(trigger.textContent).toContain('暂无已配置视频模型');
    expect(trigger.textContent).not.toContain('#img');
    expect(trigger.getAttribute('aria-label')).toContain('暂无已配置视频模型');

    fireEvent.mouseDown(trigger);

    expect(
      screen.getByText('请先在供应商设置中获取并勾选视频模型')
    ).not.toBeNull();
  });

  it('form 变体的 portal 菜单宽度不小于触发器宽度', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 800,
    });

    const { container } = render(
      <ModelDropdown
        selectedModel={baseModel.id}
        selectedSelectionKey={baseModel.selectionKey}
        models={[baseModel]}
        onSelect={vi.fn()}
        variant="form"
      />
    );
    const wrapper = screen.getByTestId('model-selector');
    mockRect(wrapper, { top: 100, left: 24, bottom: 140, width: 680 });

    fireEvent.mouseDown(
      container.querySelector('.model-dropdown__trigger--form') as HTMLElement
    );

    const menu = document.body.querySelector(
      '.model-dropdown__menu'
    ) as HTMLElement;

    expect(menu).toBeTruthy();
    expect(menu.style.width).toBe('680px');
    expect(menu.classList.contains('model-dropdown__menu--down')).toBe(true);
  });

  it('有 URL 和 API Key 的启用供应商即使没有模型也显示在供应商列', () => {
    const { container } = render(
      <ModelDropdown
        selectedModel={baseModel.id}
        selectedSelectionKey={baseModel.selectionKey}
        models={[baseModel]}
        providerProfilesOverride={[
          {
            id: 'tuzi-provider',
            name: 'Tuzi Provider',
            baseUrl: 'https://tuzi.example/v1',
            apiKey: 'sk-test',
            enabled: true,
            providerType: 'openai-compatible',
            authType: 'bearer',
            capabilities: {
              supportsModelsEndpoint: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: false,
              supportsAudio: false,
              supportsTools: false,
            },
          },
          {
            id: 'vip-provider',
            name: 'vip',
            baseUrl: 'http://localhost:3100/v1',
            apiKey: 'sk-vip',
            enabled: true,
            providerType: 'openai-compatible',
            authType: 'bearer',
            capabilities: {
              supportsModelsEndpoint: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: false,
              supportsAudio: false,
              supportsTools: false,
            },
          },
        ]}
        onSelect={vi.fn()}
      />
    );

    fireEvent.mouseDown(
      container.querySelector(
        '.model-dropdown__trigger--minimal'
      ) as HTMLElement
    );

    const menu = document.body.querySelector(
      '.model-dropdown__menu'
    ) as HTMLElement;

    expect(menu.textContent).toContain('Tuzi Provider');
    expect(menu.textContent).toContain('vip');
  });

  it('自定义供应商也会懒加载模型，完成后移除加载状态', async () => {
    let resolveDiscovery: ((models: ModelConfig[]) => void) | undefined;
    discoverMock.mockImplementation(
      () =>
        new Promise<ModelConfig[]>((resolve) => {
          resolveDiscovery = resolve;
        })
    );

    const customModel: ModelConfig = {
      ...baseModel,
      sourceProfileId: 'custom-provider',
      sourceProfileName: 'mj原生',
      selectionKey: 'custom-provider::gpt-image-2',
    };

    const { container } = render(
      <ModelDropdown
        selectedModel={customModel.id}
        selectedSelectionKey={customModel.selectionKey}
        models={[customModel]}
        providerProfilesOverride={[
          {
            id: 'custom-provider',
            name: 'mj原生',
            baseUrl: 'https://tuzi.example/v1',
            apiKey: 'sk-test',
            enabled: true,
            providerType: 'openai-compatible',
            authType: 'bearer',
          },
        ]}
        onSelect={vi.fn()}
      />
    );

    fireEvent.mouseDown(
      container.querySelector(
        '.model-dropdown__trigger--minimal'
      ) as HTMLElement
    );

    expect(discoverMock).toHaveBeenCalledTimes(1);
    expect(discoverMock).toHaveBeenCalledWith(
      'custom-provider',
      'https://tuzi.example/v1',
      'sk-test'
    );
    expect(await screen.findByText('正在加载模型...')).toBeTruthy();
    const loadingStatus = document.querySelector(
      '.model-dropdown__loading-overlay'
    ) as HTMLElement;
    expect(loadingStatus).toBeTruthy();
    expect(
      loadingStatus.querySelector('.model-dropdown__loading-icon')
    ).not.toBeNull();

    resolveDiscovery?.([customModel]);
    await waitFor(() => {
      expect(
        document.querySelector('.model-dropdown__loading-overlay')
      ).toBeNull();
    });
  });

  it.each(['image', 'video'] as const)(
    '已发现但未添加的模型按 %s 模式显示准确状态',
    (modelType) => {
      const imageModel = {
        ...baseModel,
        id: 'mj_fast_imagine',
        sourceProfileId: 'custom-mj',
      };
      getStateMock.mockReturnValue({
        status: 'ready',
        discoveredModels: [imageModel],
        selectedModelIds: ['existing-video'],
        error: null,
      });
      render(
        <ModelDropdown
          selectedModel=""
          models={[]}
          modelType={modelType}
          isOpen
          providerProfilesOverride={[
            {
              id: 'custom-mj',
              name: 'mj原生',
              baseUrl: 'https://api.tu-zi.com',
              apiKey: 'sk-test',
              enabled: true,
              providerType: 'openai-compatible',
              authType: 'bearer',
            },
          ]}
          onSelect={vi.fn()}
        />
      );
      if (modelType === 'image') {
        expect(screen.getByText('已发现 1 个图片模型，尚未添加')).toBeTruthy();
        expect(applySelectionMock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('添加图片模型'));
        expect(applySelectionMock).toHaveBeenCalledWith('custom-mj', [
          'existing-video',
          'mj_fast_imagine',
        ]);
      } else {
        expect(screen.getByText('该供应商暂无可用的视频模型')).toBeTruthy();
        expect(screen.queryByText('添加视频模型')).toBeNull();
      }
      expect(discoverMock).not.toHaveBeenCalled();
    }
  );

  it('模型获取失败时结束加载并记录可重试错误', async () => {
    setErrorMock.mockImplementation((_profileId, error) => {
      getStateMock.mockReturnValue({
        status: 'error',
        discoveredModels: [],
        selectedModelIds: [],
        error,
      });
    });
    discoverMock.mockRejectedValue(new Error('模型接口暂时不可用'));
    const customModel: ModelConfig = {
      ...baseModel,
      sourceProfileId: 'custom-provider-error',
      sourceProfileName: 'mj原生',
      selectionKey: 'custom-provider-error::gpt-image-2',
    };

    const { container } = render(
      <ModelDropdown
        selectedModel={customModel.id}
        selectedSelectionKey={customModel.selectionKey}
        models={[]}
        providerProfilesOverride={[
          {
            id: 'custom-provider-error',
            name: 'mj原生',
            baseUrl: 'https://tuzi.example/v1',
            apiKey: 'sk-test',
            enabled: true,
            providerType: 'openai-compatible',
            authType: 'bearer',
          },
        ]}
        onSelect={vi.fn()}
      />
    );

    fireEvent.mouseDown(
      container.querySelector(
        '.model-dropdown__trigger--minimal'
      ) as HTMLElement
    );

    await waitFor(() => {
      expect(setErrorMock).toHaveBeenCalledWith(
        'custom-provider-error',
        '模型接口暂时不可用'
      );
      expect(screen.getByText('模型获取失败：模型接口暂时不可用')).toBeTruthy();
      expect(
        document.querySelector('.model-dropdown__loading-overlay')
      ).toBeNull();
    });
  });
});
