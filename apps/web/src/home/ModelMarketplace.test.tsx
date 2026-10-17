/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelMarketplace } from './ModelMarketplace';

afterEach(cleanup);

describe('ModelMarketplace', () => {
  it('filters models by category and opens music models in the music station', async () => {
    const onStartCreating = vi.fn().mockResolvedValue(undefined);
    const onOpenMusicStation = vi.fn();

    render(
      <ModelMarketplace
        onStartCreating={onStartCreating}
        onOpenMusicStation={onOpenMusicStation}
      />
    );

    await screen.findByText('GPT Image 2');
    fireEvent.click(screen.getByRole('tab', { name: /音乐/ }));

    expect(await screen.findByText('Suno Music')).toBeTruthy();
    expect(screen.queryByText('GPT Image 2')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /进入音乐台/ })[0]);
    expect(onOpenMusicStation).toHaveBeenCalledTimes(1);
    expect(onStartCreating).not.toHaveBeenCalled();
  });

  it('searches within the selected model category', async () => {
    render(
      <ModelMarketplace
        onStartCreating={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByText('GPT Image 2');
    fireEvent.click(screen.getByRole('tab', { name: /生图/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索模型' }), {
      target: { value: 'Seedream' },
    });

    expect(await screen.findByText('Seedream 5.0')).toBeTruthy();
    expect(screen.queryByText('GPT Image 2')).toBeNull();
  });

  it('opens a focused model library and returns the selected model', async () => {
    const onOpenModel = vi.fn();
    render(
      <ModelMarketplace
        isOpen
        onClose={vi.fn()}
        onOpenModel={onOpenModel}
        onStartCreating={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByRole('dialog', { name: '模型广场' });
    fireEvent.click(screen.getByRole('button', { name: /使用此模型/ }));
    expect(onOpenModel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gpt-image-2' })
    );
  });
});
