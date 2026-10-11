// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParametersDropdown } from './ParametersDropdown';
import { getEffectiveVideoCompatibleParams } from '../../services/video-binding-utils';

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
afterEach(cleanup);

describe('GPT Image advanced parameters', () => {
  it('shows Veo advanced controls without a channel declaration', () => {
    const onParamChange = vi.fn();
    render(<ParametersDropdown isOpen modelId="veo3.1" selectedParams={{}}
      compatibleParams={getEffectiveVideoCompatibleParams('veo3.1', 'veo3.1', null)}
      onParamChange={onParamChange} />);
    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    for (const label of ['负向提示词', '生成音频', '随机种子', '人物生成']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'allow_adult' }));
    expect(onParamChange).toHaveBeenCalledWith('person_generation', 'allow_adult');
  });
  it.each([
    'gpt-image-2.5-1k',
    'gpt-image-2.5',
    'gpt-image-2.5-vip',
    'gpt-image-2.5-sunburst',
    'gpt-image-2.5-flare',
  ])(
    'keeps basic controls visible and reveals advanced controls for %s only after toggling',
    (modelId) => {
      const onParamChange = vi.fn();
      render(
        <ParametersDropdown
          isOpen
          modelId={modelId}
          selectedParams={{}}
          onParamChange={onParamChange}
        />
      );
      expect(screen.getByText('图片背景')).toBeTruthy();
      expect(screen.queryByText('输出格式')).toBeNull();
      fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
      expect(screen.getByText('输出格式')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'WebP' }));
      expect(onParamChange).toHaveBeenCalledWith('output_format', 'webp');
      fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
      expect(screen.queryByText('输出格式')).toBeNull();
    }
  );

  it.each(['gpt-image-2', 'gpt-image-2-vip'])(
    'does not add an advanced toggle to %s',
    (modelId) => {
      render(
        <ParametersDropdown
          isOpen
          modelId={modelId}
          selectedParams={{}}
          onParamChange={vi.fn()}
        />
      );
      expect(screen.queryByRole('switch', { name: '高级功能' })).toBeNull();
    }
  );

  it.each([
    ['veo3.1', '生成音频', 'generate_audio'],
  ])('lets %s select an optional boolean and restore the upstream default', (modelId, label, id) => {
    const onParamChange = vi.fn();
    const { rerender } = render(<ParametersDropdown isOpen modelId={modelId} selectedParams={{}} onParamChange={onParamChange} />);
    if (modelId === 'veo3.1') fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    expect(screen.getByRole('button', { name: `${label}默认` }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: `${label}开启` }));
    expect(onParamChange).toHaveBeenCalledWith(id, 'true');
    rerender(<ParametersDropdown isOpen modelId={modelId} selectedParams={{ [id]: 'false' }} onParamChange={onParamChange} />);
    expect(screen.getByRole('button', { name: `${label}关闭` }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: `${label}关闭` }));
    expect(onParamChange).toHaveBeenCalledWith(id, 'false');
    fireEvent.click(screen.getByRole('button', { name: `${label}默认` }));
    expect(onParamChange).toHaveBeenCalledWith(id, '');
  });

  it('clears advanced values when advanced functionality is turned off', () => {
    const onParamChange = vi.fn();
    render(
      <ParametersDropdown
        isOpen
        modelId="gpt-image-2.5"
        selectedParams={{
          output_format: 'jpeg',
          output_compression: '80',
          moderation: 'low',
          user: 'user-1',
        }}
        onParamChange={onParamChange}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));
    fireEvent.click(screen.getByRole('switch', { name: '高级功能' }));

    expect(onParamChange).toHaveBeenCalledWith('output_format', '', {
      keepOpen: true,
    });
    expect(onParamChange).toHaveBeenCalledWith('output_compression', '', {
      keepOpen: true,
    });
    expect(onParamChange).toHaveBeenCalledWith('moderation', '', {
      keepOpen: true,
    });
    expect(onParamChange).toHaveBeenCalledWith('user', '', { keepOpen: true });
  });

  it('does not add an advanced toggle to unrelated models', () => {
    render(
      <ParametersDropdown
        isOpen
        modelId="gemini-3-pro-image-preview"
        selectedParams={{}}
        onParamChange={vi.fn()}
      />
    );
    expect(screen.queryByRole('switch', { name: '高级功能' })).toBeNull();
  });
});
