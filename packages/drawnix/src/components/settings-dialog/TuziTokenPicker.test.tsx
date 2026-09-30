import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  ensure: vi.fn(),
  sync: vi.fn(),
  groups: vi.fn(),
  create: vi.fn(),
  importTokens: vi.fn(),
  verify: vi.fn(),
  add: vi.fn(),
  discover: vi.fn(),
  profiles: vi.fn(),
  user: '1',
  credential: 'system',
}));
vi.mock('../../services/tuzi-session-api', () => ({
  TuziSessionApiClient: vi.fn(() => ({
    listAccountTokens: mocks.list,
    ensureManagedProviders: mocks.ensure,
    getProviderGroups: mocks.groups,
    createAccountTokens: mocks.create,
    importAccountTokens: mocks.importTokens,
    verifyExistingProviders: mocks.verify,
  })),
}));
vi.mock('../../services/tuzi-managed-providers', () => ({
  addTuziTokenProviders: mocks.add,
  synchronizeTuziManagedProviders: mocks.sync,
}));
vi.mock('../../services/tuzi-managed-provider-models', () => ({
  discoverAndUseAllTuziProviderModels: mocks.discover,
}));
vi.mock('../../services/tuzi-provider-reuse-state', () => ({
  isCurrentTuziEndpoint: (url: string) => url.startsWith('https://tuzi.test'),
}));
vi.mock('../../services/tuzi-token-auth', () => ({
  getTuziSystemUserId: () => mocks.user,
  getTuziSystemToken: () => mocks.credential,
}));
vi.mock('../../utils/settings-manager', () => ({
  providerProfilesSettings: { get: mocks.profiles },
}));
import { TuziTokenPicker } from './TuziTokenPicker';
const token = (id: number, extra = {}) => ({
  token_id: id,
  token_name: `日常令牌 ${id}`,
  groups: ['default'],
  usable: true,
  expires_at: -1,
  fingerprint: bytesToHex(sha256('key' + id)),
  ...extra,
});
function setup() {
  const onComplete = vi.fn();
  render(<TuziTokenPicker onComplete={onComplete} onCancel={vi.fn()} />);
  return onComplete;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user = '1';
  mocks.credential = 'system';
  mocks.profiles.mockReturnValue([]);
  mocks.list.mockResolvedValue([
    token(1),
    token(2),
    token(3, { usable: false, reason: 'expired' }),
  ]);
  mocks.groups.mockResolvedValue([
    { group: 'default', displayName: 'default' },
    { group: 'vip', displayName: 'VIP' },
  ]);
  mocks.importTokens.mockResolvedValue([token(1, { api_key: 'sk-key1' })]);
  mocks.create.mockResolvedValue([token(4, { api_key: 'sk-key4' })]);
  mocks.add.mockImplementation(async (p) => p);
  mocks.verify.mockResolvedValue([]);
  mocks.discover.mockResolvedValue(1);
});
afterEach(cleanup);
describe('Tuzi token selection', () => {
  it('keeps old API account group creation when token import is unsupported', async () => {
    mocks.list.mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 })
    );
    const provider = {
      id: 'tuzi-managed-default',
      group: 'default',
      displayName: 'default',
      apiKey: 'sk-created',
      status: 1,
      rotatedAt: 0,
    };
    mocks.ensure.mockResolvedValue([provider]);
    const complete = setup();
    await screen.findByRole('status');
    const group = await screen.findByRole('checkbox', { name: /default/ });
    expect((group as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: /VIP/ }) as HTMLInputElement)
        .checked
    ).toBe(false);
    expect(screen.queryByRole('button', { name: '添加已有令牌' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '创建并添加' }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith([provider]));
    expect(mocks.ensure).toHaveBeenCalledWith(['default']);
    expect(mocks.sync).toHaveBeenCalledWith([provider]);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('loads creation groups independently of token inventory', async () => {
    mocks.list.mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 })
    );
    render(
      <TuziTokenPicker
        initialMode="create"
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await screen.findByRole('checkbox', { name: /default/ });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('keeps authentication failures visible instead of treating them as missing capabilities', async () => {
    mocks.list.mockRejectedValue(
      Object.assign(new Error('登录已过期'), { status: 401 })
    );
    setup();
    expect(await screen.findByText('登录已过期')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('preselects just one eligible default token and imports exact IDs, preserving same-group choices', async () => {
    const complete = setup();
    const first = await screen.findByRole('checkbox', {
      name: '选择令牌 日常令牌 1 (#1)',
    });
    expect((first as HTMLInputElement).checked).toBe(true);
    expect(
      (
        screen.getByRole('checkbox', {
          name: '选择令牌 日常令牌 2 (#2)',
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
    expect(
      (
        screen.getByRole('checkbox', {
          name: '选择令牌 日常令牌 3 (#3)',
        }) as HTMLInputElement
      ).disabled
    ).toBe(true);
    fireEvent.click(
      screen.getByRole('checkbox', { name: '选择令牌 日常令牌 2 (#2)' })
    );
    mocks.importTokens.mockResolvedValue([
      token(1, { api_key: 'sk-key1' }),
      token(2, { api_key: 'sk-key2' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '添加 2 枚已有令牌' }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(mocks.importTokens).toHaveBeenCalledWith([1, 2]);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.add.mock.calls[0][0].map((p: { id: string }) => p.id)).toEqual(
      ['tuzi-token-1-1', 'tuzi-token-1-2']
    );
  });
  it('recognizes already configured keys and preselects the next eligible default', async () => {
    mocks.profiles.mockReturnValue([
      { baseUrl: 'https://tuzi.test/v1', apiKey: 'sk-key1' },
    ]);
    setup();
    expect(
      (
        (await screen.findByRole('checkbox', {
          name: '选择令牌 日常令牌 1 (#1)',
        })) as HTMLInputElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole('checkbox', {
          name: '选择令牌 日常令牌 2 (#2)',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
  });
  it('starts creation with default only, shows other groups, previews names and blocks empty names', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /创建新令牌/ }));
    const checkbox = await screen.findByRole('checkbox', { name: /default/ });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('选择其他分组')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /VIP/ }));
    fireEvent.change(screen.getByRole('textbox', { name: /令牌名称/ }), {
      target: { value: '设计专用' },
    });
    expect(screen.getByText('设计专用 · vip')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: /令牌名称/ }), {
      target: { value: ' ' },
    });
    expect(
      (screen.getByRole('button', { name: '创建并添加' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /令牌名称/ }), {
      target: { value: '设计专用' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建并添加' }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith('设计专用', ['default', 'vip'])
    );
  });
  it('does not choose another group when default is unavailable', async () => {
    mocks.groups.mockResolvedValue([{ group: 'vip', displayName: 'VIP' }]);
    setup();
    fireEvent.click(screen.getByRole('button', { name: /创建新令牌/ }));
    expect(
      (
        (await screen.findByRole('checkbox', {
          name: /VIP/,
        })) as HTMLInputElement
      ).checked
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: '创建并添加' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
  it('discards import responses after an account switch', async () => {
    let resolve!: (value: unknown) => void;
    mocks.importTokens.mockReturnValue(new Promise((r) => (resolve = r)));
    const complete = setup();
    fireEvent.click(
      await screen.findByRole('button', { name: '添加 1 枚已有令牌' })
    );
    mocks.user = '2';
    resolve([token(1, { api_key: 'sk-key1' })]);
    await waitFor(() => expect(mocks.importTokens).toHaveBeenCalled());
    expect(mocks.add).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it('retries local persistence without creating another token', async () => {
    const complete = setup();
    mocks.add.mockRejectedValueOnce(new Error('保存失败'));
    fireEvent.click(screen.getByRole('button', { name: /创建新令牌/ }));
    await screen.findByRole('checkbox', { name: /default/ });
    fireEvent.click(screen.getByRole('button', { name: '创建并添加' }));
    await screen.findByText('保存失败');
    fireEvent.click(screen.getByRole('button', { name: '重试添加' }));
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
