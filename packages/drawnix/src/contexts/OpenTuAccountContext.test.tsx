// @vitest-environment jsdom

import React, { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenTuAccountProvider,
  useOpenTuAccountWorkspace,
  type OpenTuAccountWorkspaceClient,
} from './OpenTuAccountContext';
import {
  clearOpenTuAccountRuntimeSession,
  setOpenTuAccountRuntimeSession,
} from '../services/opentu-account-runtime';

const storageMocks = vi.hoisted(() => ({
  reconcile: vi.fn(async () => undefined),
  update: vi.fn(async () => undefined),
}));

vi.mock('../services/opentu-managed-provider-profiles', () => ({
  reconcileManagedProviderGroups: storageMocks.reconcile,
  updateManagedProviderGroup: storageMocks.update,
}));

function createClient(): OpenTuAccountWorkspaceClient {
  return {
    getAccount: vi.fn(async () => ({
      id: 7,
      username: 'alice',
      display_name: 'Alice',
      email: 'alice@example.com',
      quota: '88.5',
      group: 'default',
      credential_id: 'credential-7',
    })),
    getUsage: vi.fn(async () => ({
      page: 1,
      page_size: 20,
      total: 0,
      items: [],
    })),
    getTopups: vi.fn(async () => ({
      page: 1,
      page_size: 20,
      total: 0,
      items: [],
    })),
    getTopupInfo: vi.fn(async () => ({})),
    estimateTopup: vi.fn(async () => ({
      amount: 100,
      base_amount: 98,
      fee: 2,
      total_amount: 100,
      currency: 'CNY',
      fixed_fee: 1,
      percent_fee: 0.01,
      discount: 1,
      topup_group_ratio: 1,
    })),
    createTopup: vi.fn(async () => ({
      trade_no: 'trade-1',
      payment_url: 'https://payment.example',
    })),
    queryTopup: vi.fn(async () => ({
      status: 'pending',
      message: 'Waiting for payment',
    })),
    getDevices: vi.fn(async () => []),
    revokeDevice: vi.fn(async (id) => ({ id, status: 'revoked' })),
    ensureManagedProviderGroups: vi.fn(async () => [
      {
        group: 'default',
        display_name: '默认分组',
        api_key: 'secret-managed-key',
        base_url: 'https://api.tu-zi.com/v1',
        status: 'active',
        token_id: 9,
      },
    ]),
    rotateManagedProviderGroup: vi.fn(async (group) => ({
      group,
      display_name: '默认分组',
      api_key: 'rotated-secret-key',
      base_url: 'https://api.tu-zi.com/v1',
      status: 'active',
      token_id: 10,
    })),
  };
}

describe('OpenTuAccountProvider mode isolation', () => {
  afterEach(() => {
    act(() => clearOpenTuAccountRuntimeSession());
  });

  it('does not call account APIs until a verified embedded session is published', async () => {
    const client = createClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <OpenTuAccountProvider client={client}>{children}</OpenTuAccountProvider>
    );
    const { result } = renderHook(() => useOpenTuAccountWorkspace(), {
      wrapper,
    });

    expect(result.current.mode).toBe('standalone');
    expect(result.current.status).toBe('unavailable');
    expect(client.getAccount).not.toHaveBeenCalled();
    expect(() =>
      result.current.estimateTopup({ gateway_id: 3, amount: 100 })
    ).toThrow('unavailable in standalone mode');
    expect(client.estimateTopup).not.toHaveBeenCalled();

    act(() => {
      setOpenTuAccountRuntimeSession({
        mode: 'embedded',
        credentialId: 'credential-7',
        userId: 7,
        parentOrigin: 'http://127.0.0.1:5173',
        channel: 'channel-7',
      });
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.mode).toBe('embedded');
    expect(result.current.account?.quota).toBe('88.5');
    expect(client.getAccount).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(result.current.managedGroupsStatus).toBe('ready')
    );
    expect(result.current.managedGroups).toHaveLength(1);
    expect(storageMocks.reconcile).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ group: 'default' })]),
      'credential-7'
    );

    await expect(
      result.current.estimateTopup({ gateway_id: 3, amount: 100 })
    ).resolves.toMatchObject({ fee: 2 });
    await expect(
      result.current.createTopup(
        { gateway_id: 3, amount: 100 },
        'topup-idempotency-1'
      )
    ).resolves.toMatchObject({ trade_no: 'trade-1' });
    await expect(
      result.current.queryTopup({ trade_no: 'trade-1' })
    ).resolves.toMatchObject({ status: 'pending' });
    expect(client.estimateTopup).toHaveBeenCalledWith({
      gateway_id: 3,
      amount: 100,
    });
    expect(client.createTopup).toHaveBeenCalledWith(
      { gateway_id: 3, amount: 100 },
      'topup-idempotency-1'
    );
    expect(client.queryTopup).toHaveBeenCalledWith({ trade_no: 'trade-1' });
  });

  it('keeps the account ready when managed-group synchronization fails', async () => {
    const client = createClient();
    vi.mocked(client.ensureManagedProviderGroups).mockRejectedValueOnce(
      new Error('managed group unavailable')
    );
    act(() => {
      setOpenTuAccountRuntimeSession({
        mode: 'embedded',
        credentialId: 'credential-7',
        userId: 7,
        parentOrigin: 'http://127.0.0.1:5173',
        channel: 'channel-7',
      });
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <OpenTuAccountProvider client={client}>{children}</OpenTuAccountProvider>
    );
    const { result } = renderHook(() => useOpenTuAccountWorkspace(), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.managedGroupsStatus).toBe('error')
    );
    expect(result.current.status).toBe('ready');
    expect(result.current.managedGroupsError).toContain('unavailable');
  });
});
