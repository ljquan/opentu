import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'antd';
import { useVersionCheck } from '../src/hooks/use-version-check';
import { APP_VERSION } from '../src/constant/env';
import '../src/i18n';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const wrapper = ({ children }: { children: React.ReactNode }) => <App>{children}</App>;

describe('unified release information', () => {
    it('reads the OpenTu version and published release notes', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url === '/version.json'
            ? { version: '1.1.0' }
            : { versions: [{ version: '1.1.0', date: '2026-09-25', changes: { features: ['Shared runtime'], fixes: ['Loading'] } }] } })));
        const { result } = renderHook(useVersionCheck, { wrapper });
        expect(APP_VERSION).toBe('1.0.0');
        await waitFor(() => expect(result.current.hasNewVersion).toBe(true));
        await act(async () => { expect(await result.current.checkLatestRelease()).toBe(true); });
        expect(result.current.releases[0].items).toEqual([{ type: '新增', content: 'Shared runtime' }, { type: '修复', content: 'Loading' }]);
    });
    it('keeps bundled release notes when the network is unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        const { result } = renderHook(useVersionCheck, { wrapper });
        await act(async () => { expect(await result.current.checkLatestRelease()).toBe(false); });
        expect(result.current.latestVersion).toBe(APP_VERSION);
        expect(result.current.releases[0].items).toEqual([{ type: '修复', content: 'Local release' }]);
        expect(result.current.checking).toBe(false);
    });
});
