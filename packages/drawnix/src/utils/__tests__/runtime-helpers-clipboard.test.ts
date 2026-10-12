import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../runtime-helpers';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockClipboard(writeText?: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('navigator', {
      clipboard: writeText ? { writeText } : undefined,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      createElement: document.createElement.bind(document),
      body: document.body,
      execCommand,
    });
    return execCommand;
  }

  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = mockClipboard(writeText);
    await copyToClipboard('card text');
    expect(writeText).toHaveBeenCalledWith('card text');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back when the Clipboard API is blocked and removes the temporary textarea', async () => {
    const execCommand = mockClipboard(
      vi.fn().mockRejectedValue(new Error('blocked'))
    );
    await copyToClipboard('card text');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('rejects when the fallback reports failure and removes the temporary textarea', async () => {
    const execCommand = mockClipboard();
    execCommand.mockReturnValue(false);
    await expect(copyToClipboard('card text')).rejects.toThrow(
      'Clipboard copy failed'
    );
    expect(document.body.querySelector('textarea')).toBeNull();
  });

  it('cleans up when the fallback throws', async () => {
    const execCommand = mockClipboard();
    execCommand.mockImplementation(() => {
      throw new Error('unavailable');
    });
    await expect(copyToClipboard('card text')).rejects.toThrow('unavailable');
    expect(document.body.querySelector('textarea')).toBeNull();
  });
});
