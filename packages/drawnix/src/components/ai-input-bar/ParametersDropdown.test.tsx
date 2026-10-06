// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParametersDropdown } from './ParametersDropdown';

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
afterEach(cleanup);

describe('GPT Image advanced parameters', () => {
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
