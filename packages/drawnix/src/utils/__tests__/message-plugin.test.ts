import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagePlugin as TDesignMessagePlugin } from 'tdesign-react/es/message';
import { MessagePlugin } from '../message-plugin';

const { waitFor } = vi;

// Exercise the real React 18/TDesign lifecycle: mocking close would hide the race.
afterEach(async () => {
  TDesignMessagePlugin.closeAll();
  await waitFor(() => expect(document.querySelector('.t-message')).toBeNull());
});

describe('loading message lifecycle', () => {
  it.each(['success', 'error'] as const)(
    'removes a loading toast when an operation immediately reports %s',
    async (outcome) => {
      const loading = MessagePlugin.loading('download-pending', 0);
      MessagePlugin.close(loading);
      MessagePlugin[outcome]('download-finished');

      await waitFor(() =>
        expect(document.body.textContent).toContain('download-finished')
      );
      await waitFor(() =>
        expect(document.body.textContent).not.toContain('download-pending')
      );
    }
  );

  it('keeps a pending operation visible until it is closed', async () => {
    const loading = MessagePlugin.loading('slow-download', 0);
    await waitFor(() =>
      expect(document.body.textContent).toContain('slow-download')
    );
    MessagePlugin.close(loading);
    await waitFor(() =>
      expect(document.body.textContent).not.toContain('slow-download')
    );
  });

  it('closes only the requested operation and tolerates repeated close', async () => {
    const first = MessagePlugin.loading('first-download', 0);
    const second = MessagePlugin.loading('second-download', 0);
    await Promise.all([first, second]);
    MessagePlugin.close(first);
    MessagePlugin.close(first);
    await waitFor(() =>
      expect(document.body.textContent).toContain('second-download')
    );
    await waitFor(() =>
      expect(document.body.textContent).not.toContain('first-download')
    );
    MessagePlugin.close(second);
    await waitFor(() =>
      expect(document.body.textContent).not.toContain('second-download')
    );
  });
});
