// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import { ModelDropdown } from './ModelDropdown';

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

vi.mock('../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID: 'tuzi-original',
  TUZI_DEFAULT_PROVIDER_NAME: 'Tuzi',
  TUZI_PROVIDER_ICON_URL: 'https://tuzi.example/icon.png',
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
  afterEach(() => {
    vi.restoreAllMocks();
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
});
