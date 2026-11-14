import React, { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParametersDropdown } from './ParametersDropdown';

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
afterEach(cleanup);

describe('Kling independent size and ratio controls', () => {
  it('preserves the other selection when changing resolution or ratio', () => {
    function Controls() {
      const [params, setParams] = useState({ size: '720p', ratio: '21:9' });
      return (
        <ParametersDropdown
          isOpen
          modelId="kling-4.0"
          selectedParams={params}
          onParamChange={(id, value) =>
            setParams((prev) => ({ ...prev, [id]: value }))
          }
        />
      );
    }
    render(<Controls />);
    const size = within(
      screen
        .getByText('视频尺寸')
        .closest('.parameters-dropdown__section') as HTMLElement
    );
    const ratio = within(
      screen
        .getByText('视频比例')
        .closest('.parameters-dropdown__section') as HTMLElement
    );
    expect(
      size.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['1080P', '720P']);
    expect(
      ratio.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['自适应', '16:9', '9:16', '1:1', '21:9']);
    fireEvent.click(size.getByRole('button', { name: '1080P' }));
    expect(
      size.getByRole('button', { name: '1080P', pressed: true })
    ).toBeTruthy();
    expect(
      ratio.getByRole('button', { name: '21:9', pressed: true })
    ).toBeTruthy();
    fireEvent.click(ratio.getByRole('button', { name: '9:16' }));
    expect(
      ratio.getByRole('button', { name: '9:16', pressed: true })
    ).toBeTruthy();
    expect(
      size.getByRole('button', { name: '1080P', pressed: true })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '720p · 21:9' })).toBeNull();
  });

  it('displays a saved combined size as separate selected values', () => {
    render(
      <ParametersDropdown
        isOpen
        modelId="kling-4.0"
        selectedParams={{ size: '1680x720' }}
        onParamChange={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: '720P', pressed: true })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '21:9', pressed: true })
    ).toBeTruthy();
  });
});
