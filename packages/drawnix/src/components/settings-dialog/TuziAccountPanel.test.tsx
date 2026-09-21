// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TuziDisplayConfig } from '../../services/tuzi-session-api';

const {
  ensureManagedProviders,
  getAccount,
  getDisplayConfig,
  getLogs,
  getModels,
  getProviderGroups,
  getUsageSummary,
  getProfiles,
  rotateManagedProvider,
  synchronizeTuziManagedProviders,
  discoverAndUseAllTuziProviderModels,
} = vi.hoisted(() => ({
  ensureManagedProviders: vi.fn(),
  getAccount: vi.fn(),
  getDisplayConfig: vi.fn(),
  getLogs: vi.fn(),
  getModels: vi.fn(),
  getProviderGroups: vi.fn(),
  getUsageSummary: vi.fn(),
  getProfiles: vi.fn(),
  rotateManagedProvider: vi.fn(),
  synchronizeTuziManagedProviders: vi.fn(),
  discoverAndUseAllTuziProviderModels: vi.fn(),
}));

vi.mock('../../services/tuzi-session-api', () => ({
  TuziSessionApiError: class TuziSessionApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status?: number
    ) {
      super(message);
      this.name = 'TuziSessionApiError';
    }
  },
  TuziSessionApiClient: vi.fn(() => ({
    ensureManagedProviders,
    getAccount,
    getDisplayConfig,
    getLogs,
    getModels,
    getProviderGroups,
    getUsageSummary,
    rotateManagedProvider,
  })),
}));

vi.mock('../../services/tuzi-managed-providers', () => ({
  synchronizeTuziManagedProviders,
}));

vi.mock('../../services/tuzi-managed-provider-models', () => ({
  discoverAndUseAllTuziProviderModels,
}));

vi.mock('../../utils/settings-manager', () => ({
  providerProfilesSettings: { get: getProfiles },
}));

vi.mock('../../services/tuzi-embedded-config', () => ({
  isTuziEmbeddedMode: () => true,
  tuziEmbeddedConfig: {
    enabled: true,
    apiBaseUrl: 'http://localhost:5173',
    parentOrigin: 'http://localhost:3200',
  },
}));

describe('TuziAccountPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('opentu.tuzi.systemToken.v1', 'system-token');
    window.localStorage.setItem('opentu.tuzi.systemUserId.v1', '40832');
    getAccount.mockResolvedValue({
      id: 1,
      role: 1,
      username: 'root',
      displayName: 'Tuzi User',
      email: 'root@example.com',
      group: 'root',
      quota: 145930,
      usedQuota: 70,
      requestCount: 3,
    });
    getDisplayConfig.mockResolvedValue({
      quotaPerUnit: 100,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    });
    const logItems = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      createdAt: 1700000000 + index,
      type: 2,
      channelId: index === 0 ? '730' : '',
      channelName: index === 0 ? 'OpenTu' : '',
      username: index === 0 ? 'foster0214' : '',
      userId: '',
      tokenName: '',
      content: `模型倍率 ${index + 1}`,
      modelName: `gpt-image-${index + 1}`,
      callStatus: index === 0 ? '成功扣费' : '',
      quota: 23,
      promptTokens: 0,
      completionTokens: 0,
      useTime: index === 0 ? 12 : 0,
      ip: index === 0 ? '127.0.0.1' : '',
      retryCount: index === 0 ? 2 : 0,
      requestId: `req-${index + 1}`,
      responseId: index === 0 ? 'resp-1' : '',
      upstreamRequestId: '',
      generatedImageUrls:
        index === 0
          ? [
              'https://example.com/generated.png',
              'https://example.com/generated-2.png',
            ]
          : [],
      other:
        index === 0
          ? {
              request_host: '192.168.50.218:3100',
              request_path: '/v1/images/generations',
              generated_image_urls: ['https://example.com/generated.png'],
              billing_detail: { mode: 'token', total: 23 },
              future_detail: '未来扩展字段',
            }
          : {},
    }));
    getLogs.mockImplementation(
      async (page = 1, pageSize = 10) =>
        ({
          items: logItems.slice((page - 1) * pageSize, page * pageSize),
          total: logItems.length,
          page,
          pageSize,
        } as const)
    );
    ensureManagedProviders.mockResolvedValue([
      {
        id: 'tuzi-managed-default',
        group: 'default',
        displayName: 'default',
        apiKey: 'sk-test',
        status: 1,
        rotatedAt: 1700000000,
      },
    ]);
    rotateManagedProvider.mockResolvedValue({
      id: 'tuzi-managed-default',
      group: 'default',
      displayName: 'default',
      apiKey: 'sk-next',
      status: 1,
      rotatedAt: 1700000100,
    });
    synchronizeTuziManagedProviders.mockResolvedValue(undefined);
    discoverAndUseAllTuziProviderModels.mockResolvedValue(2);
    getModels.mockResolvedValue(['hidden-model']);
    getProviderGroups.mockResolvedValue([
      { group: 'default', displayName: 'default' },
      { group: 'vip', displayName: 'VIP' },
    ]);
    getUsageSummary.mockResolvedValue({ quota: 70, rpm: 0, tpm: 0 });
    getProfiles.mockReturnValue([
      {
        id: 'tuzi-managed-default',
        name: 'default',
        pricingGroup: 'default',
        apiKey: 'sk-test',
        enabled: true,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('clears local account credentials and managed providers on logout', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '清除' }));

    await waitFor(() =>
      expect(synchronizeTuziManagedProviders).toHaveBeenCalledWith([])
    );
    expect(
      window.localStorage.getItem('opentu.tuzi.systemToken.v1')
    ).toBeNull();
    expect(
      window.localStorage.getItem('opentu.tuzi.systemUserId.v1')
    ).toBeNull();
    expect(
      (screen.getByLabelText('Tuzi 用户 ID') as HTMLInputElement).value
    ).toBe('');
    expect(await screen.findByText('尚未配置系统访问令牌')).not.toBeNull();
  }, 10_000);

  it('shows balance and key rotation in the balance view without loading hidden summaries', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);

    expect(await screen.findByText('可用额度')).not.toBeNull();
    expect(await screen.findByText('令牌已连接')).not.toBeNull();
    expect(screen.getByText('已同步')).not.toBeNull();
    expect(screen.getByText('累计用量')).not.toBeNull();
    const personalSettingsLink = screen.getByRole('link', {
      name: '获取 ID 和个人令牌',
    });
    expect(personalSettingsLink.getAttribute('href')).toBe(
      'https://api.tu-zi.com/console/personal'
    );
    expect(personalSettingsLink.getAttribute('target')).toBe('_blank');
    expect(personalSettingsLink.getAttribute('rel')).toBe(
      'noopener noreferrer'
    );
    const tokenGuideLink = screen.getByRole('link', {
      name: '查看教程',
    });
    expect(tokenGuideLink.getAttribute('href')).toBe(
      'https://wiki.tu-zi.com/s/8c61a536-7a59-4410-a5e2-8dab3d041958/zh-cn/doc/opentuid-ZUZUoZjTgm'
    );
    expect(tokenGuideLink.getAttribute('target')).toBe('_blank');
    expect(tokenGuideLink.getAttribute('rel')).toBe('noopener noreferrer');
    const topUpLink = screen.getByRole('link', {
      name: '充值（打开 Tuzi 充值页面）',
    });
    expect(topUpLink.getAttribute('href')).toBe(
      'https://api.tu-zi.com/console/topup'
    );
    expect(topUpLink.getAttribute('target')).toBe('_blank');
    expect(topUpLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(
      screen.getByRole('button', { name: '换新 default 分组 Key' })
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: '刷新账户数据' })).not.toBeNull();
    expect(screen.queryByText('近 30 天消费')).toBeNull();
    expect(screen.queryByText('可用模型')).toBeNull();
    expect(getLogs).not.toHaveBeenCalled();
    expect(getModels).not.toHaveBeenCalled();
    expect(getUsageSummary).not.toHaveBeenCalled();
  });

  it('renders account data before a slow display-config request completes', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');
    let resolveDisplayConfig: (config: TuziDisplayConfig) => void = () =>
      undefined;
    getDisplayConfig.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDisplayConfig = resolve;
      })
    );

    render(<TuziAccountPanel />);

    expect(await screen.findByText('可用额度')).not.toBeNull();
    expect(screen.getByText('Tuzi User')).not.toBeNull();
    expect(screen.queryByText('正在读取账户数据')).toBeNull();

    resolveDisplayConfig({
      quotaPerUnit: 100,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    });
    await waitFor(() => expect(screen.getByText('¥1459.30')).not.toBeNull());
  });

  it('filters stale local managed providers to the saved group selection', async () => {
    getProfiles.mockReturnValue([
      {
        id: 'tuzi-managed-default',
        name: 'default',
        pricingGroup: 'default',
        apiKey: 'sk-default',
        enabled: true,
      },
      {
        id: 'tuzi-managed-vip',
        name: 'VIP',
        pricingGroup: 'vip',
        apiKey: 'sk-vip',
        enabled: true,
      },
    ]);
    window.localStorage.setItem(
      'opentu.tuzi.provider-groups.v1',
      JSON.stringify({ '1': ['default'] })
    );
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);

    await screen.findByText('可用额度');
    expect(screen.getAllByText('default').length).toBeGreaterThan(0);
    expect(screen.queryByText('VIP')).toBeNull();
  });

  it('force-refreshes account, managed groups, and models without loading logs', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');
    let resolveDiscovery: (count: number) => void = () => undefined;
    discoverAndUseAllTuziProviderModels.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDiscovery = resolve;
      })
    );

    render(<TuziAccountPanel />);
    await screen.findByText('可用额度');

    const refreshButton = screen.getByRole('button', { name: '刷新账户数据' });
    fireEvent.click(refreshButton);

    expect((refreshButton as HTMLButtonElement).disabled).toBe(true);
    expect(refreshButton.querySelector('.is-spinning')).not.toBeNull();
    expect(getLogs).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(ensureManagedProviders).toHaveBeenCalledTimes(1)
    );
    expect(discoverAndUseAllTuziProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ group: 'default' })
    );
    expect(await screen.findByText('模型同步中')).not.toBeNull();
    expect(screen.queryByText('正在读取账户数据')).toBeNull();
    expect(screen.getByText('Tuzi User')).not.toBeNull();

    resolveDiscovery(1);
    await waitFor(() =>
      expect((refreshButton as HTMLButtonElement).disabled).toBe(false)
    );
    expect(screen.getByText('已同步')).not.toBeNull();
  });

  it('asks the user to replace an invalid system token', async () => {
    const { TuziSessionApiError } = await import(
      '../../services/tuzi-session-api'
    );
    getAccount.mockRejectedValueOnce(
      new TuziSessionApiError('TOKEN_INVALID', '令牌无效', 401)
    );
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);

    expect(await screen.findByText('系统访问令牌无效')).not.toBeNull();
    expect(screen.getByText('请替换令牌后重试')).not.toBeNull();
    expect(screen.queryByRole('link', { name: '去登录' })).toBeNull();
  });

  it('keeps token replacement and retry available when account loading fails', async () => {
    const { TuziSessionApiError } = await import(
      '../../services/tuzi-session-api'
    );
    getAccount.mockRejectedValueOnce(
      new TuziSessionApiError('REQUEST_FAILED', 'Failed to fetch')
    );
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);

    expect(await screen.findByText('数据加载失败')).not.toBeNull();
    expect(screen.queryByRole('link', { name: '去登录' })).toBeNull();
    expect(screen.getByRole('button', { name: '替换令牌' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).not.toBeNull();
  });

  it('starts a fresh connection flow when the saved token is unchanged', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);
    await screen.findByText('可用额度');

    const tokenInput = document.querySelector('#tuzi-system-token');
    expect(tokenInput).not.toBeNull();
    fireEvent.change(tokenInput as HTMLInputElement, {
      target: { value: 'system-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: '替换令牌' }));

    expect(await screen.findByText('选择要连接的分组')).not.toBeNull();
    expect(screen.queryByText('正在读取账户数据')).toBeNull();
    expect(synchronizeTuziManagedProviders).not.toHaveBeenCalled();
  });

  it('keeps a failed provider-group request distinct from an empty group list', async () => {
    const { TuziSessionApiError } = await import(
      '../../services/tuzi-session-api'
    );
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);
    await screen.findByText('可用额度');
    getProviderGroups.mockRejectedValueOnce(
      new TuziSessionApiError('REQUEST_FAILED', 'Tuzi API 请求超时，请稍后重试')
    );

    const tokenInput = document.querySelector('#tuzi-system-token');
    expect(tokenInput).not.toBeNull();
    fireEvent.change(tokenInput as HTMLInputElement, {
      target: { value: 'system-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: '替换令牌' }));

    expect(await screen.findByText('数据加载失败')).not.toBeNull();
    expect(screen.queryByText('暂无可用分组')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: '确认并继续',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(
      await screen.findByRole('checkbox', { name: /default/ })
    ).not.toBeNull();
    expect(screen.queryByText('数据加载失败')).toBeNull();
  });

  it('refreshes the visible account and managed groups after replacing the token', async () => {
    const onProvidersChanged = vi.fn();
    const { TuziAccountPanel } = await import('./TuziAccountPanel');
    let resolveProviderSync: () => void = () => undefined;
    let resolveDiscovery: (count: number) => void = () => undefined;

    render(<TuziAccountPanel onProvidersChanged={onProvidersChanged} />);
    await screen.findByText('可用额度');

    getAccount.mockResolvedValueOnce({
      id: 2,
      role: 1,
      username: 'next-user',
      displayName: 'Next Tuzi User',
      email: 'next@example.com',
      group: 'default',
      quota: 300,
      usedQuota: 100,
      requestCount: 9,
    });
    getAccount.mockResolvedValue({
      id: 2,
      role: 1,
      username: 'next-user',
      displayName: 'Next Tuzi User',
      email: 'next@example.com',
      group: 'default',
      quota: 300,
      usedQuota: 100,
      requestCount: 9,
    });
    ensureManagedProviders.mockResolvedValueOnce([
      {
        id: 'tuzi-managed-vip',
        group: 'vip',
        displayName: 'VIP',
        apiKey: 'sk-next',
        status: 1,
        rotatedAt: 1700000200,
      },
    ]);
    discoverAndUseAllTuziProviderModels.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDiscovery = resolve;
      })
    );
    synchronizeTuziManagedProviders
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveProviderSync = resolve;
        })
      );

    const tokenInput = document.querySelector('#tuzi-system-token');
    expect(tokenInput).not.toBeNull();
    fireEvent.change(tokenInput as HTMLInputElement, {
      target: { value: 'replacement-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: '替换令牌' }));

    expect(await screen.findByText('选择要连接的分组')).not.toBeNull();
    expect(ensureManagedProviders).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', { name: /VIP/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));

    expect(await screen.findByText('Next Tuzi User')).not.toBeNull();
    expect(
      await screen.findByRole('button', { name: '换新 vip 分组 Key' })
    ).not.toBeNull();
    expect(await screen.findByText('9')).not.toBeNull();
    expect(await screen.findByText('Provider 同步中')).not.toBeNull();
    expect(screen.queryByText('正在读取账户数据')).toBeNull();
    expect(ensureManagedProviders).toHaveBeenCalledWith(['vip']);

    resolveProviderSync();
    expect(await screen.findByText('模型同步中')).not.toBeNull();
    expect(screen.queryByText('正在读取账户数据')).toBeNull();
    expect(synchronizeTuziManagedProviders).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'tuzi-managed-vip', group: 'vip' }),
    ]);
    expect(onProvidersChanged).toHaveBeenCalledTimes(2);

    resolveDiscovery(1);
    await waitFor(() => expect(screen.getByText('已同步')).not.toBeNull());
  });

  it('rotates provider keys from the balance view', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);

    fireEvent.click(
      await screen.findByRole('button', { name: '换新 default 分组 Key' })
    );

    await waitFor(() =>
      expect(rotateManagedProvider).toHaveBeenCalledWith('default')
    );
    await waitFor(() =>
      expect(discoverAndUseAllTuziProviderModels).toHaveBeenCalledWith(
        expect.objectContaining({ group: 'default', apiKey: 'sk-next' })
      )
    );
  });

  it('adds another authorized group without dropping the current group', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');
    ensureManagedProviders.mockResolvedValueOnce([
      {
        id: 'tuzi-managed-default',
        group: 'default',
        displayName: 'default',
        apiKey: 'sk-test',
        status: 1,
        rotatedAt: 1700000000,
      },
      {
        id: 'tuzi-managed-vip',
        group: 'vip',
        displayName: 'VIP',
        apiKey: 'sk-vip',
        status: 1,
        rotatedAt: 1700000200,
      },
    ]);

    render(<TuziAccountPanel />);

    fireEvent.click(
      await screen.findByRole('button', { name: '获取其他分组' })
    );

    expect(await screen.findByText('选择要连接的分组')).not.toBeNull();
    expect(getProviderGroups).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole('checkbox', { name: /default/ }) as HTMLInputElement)
        .checked
    ).toBe(true);
    const vipCheckbox = screen.getByRole('checkbox', {
      name: /VIP/,
    }) as HTMLInputElement;
    expect(vipCheckbox.checked).toBe(false);

    fireEvent.click(vipCheckbox);
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));

    await waitFor(() =>
      expect(ensureManagedProviders).toHaveBeenCalledWith(['default', 'vip'])
    );
  });

  it('shows logs in the logs view with pagination', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '日志' }));

    expect(screen.queryByText('系统访问令牌')).toBeNull();
    expect(screen.queryByRole('button', { name: '刷新账户数据' })).toBeNull();
    expect(await screen.findByText('gpt-image-1')).not.toBeNull();
    expect(screen.getByText('时间')).not.toBeNull();
    expect(screen.queryByText('渠道')).toBeNull();
    expect(screen.queryByText('用户')).toBeNull();
    expect(screen.getByText('分组')).not.toBeNull();
    expect(screen.getByText('模型')).not.toBeNull();
    expect(screen.getByText('预览')).not.toBeNull();
    expect(screen.getByText('用时')).not.toBeNull();
    expect(screen.queryByText('详情')).toBeNull();
    expect(screen.getByText('金额')).not.toBeNull();
    expect(screen.getByText('12 s')).not.toBeNull();
    expect(screen.queryByText('模型倍率 1')).toBeNull();
    const preview = screen.getByRole('img', {
      name: '生成图片预览，可拖到画布',
    });
    expect(preview.getAttribute('src')).toBe(
      'https://example.com/generated.png'
    );
    expect(preview.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByLabelText('共 2 张生成图片')).not.toBeNull();
    const setData = vi.fn();
    fireEvent.dragStart(preview, {
      dataTransfer: { effectAllowed: 'none', setData },
    });
    expect(setData).toHaveBeenCalledWith(
      'text/uri-list',
      'https://example.com/generated.png'
    );
    expect(setData).toHaveBeenCalledWith(
      'text/plain',
      'https://example.com/generated.png'
    );
    expect(setData).toHaveBeenCalledWith(
      'text/html',
      '<img src="https://example.com/generated.png" alt="">'
    );
    fireEvent.error(preview);
    const fallbackPreview = screen.getByRole('img', {
      name: '生成图片预览，可拖到画布',
    });
    expect(fallbackPreview.getAttribute('src')).toBe(
      'https://example.com/generated-2.png'
    );
    setData.mockClear();
    fireEvent.dragStart(fallbackPreview, {
      dataTransfer: { effectAllowed: 'none', setData },
    });
    expect(setData).toHaveBeenCalledWith(
      'text/uri-list',
      'https://example.com/generated-2.png'
    );
    expect(setData).toHaveBeenCalledWith(
      'text/plain',
      'https://example.com/generated-2.png'
    );
    expect(setData).toHaveBeenCalledWith(
      'text/html',
      '<img src="https://example.com/generated-2.png" alt="">'
    );
    fireEvent.error(fallbackPreview);
    expect(screen.getByLabelText('生成图片已过期')).not.toBeNull();
    expect(screen.getByText('图片已过期')).not.toBeNull();
    expect(screen.queryByText('OpenTu')).toBeNull();
    expect(screen.queryByText('foster0214')).toBeNull();
    expect(screen.getByText('1-10 / 12')).not.toBeNull();
    expect(screen.getByText('1 / 2')).not.toBeNull();
    expect(screen.queryByText('其他详情')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开日志 1' }));
    expect(screen.getByRole('button', { name: '收起日志 1' })).not.toBeNull();
    expect(screen.getByText('其他详情')).not.toBeNull();
    expect(screen.getByText('模型倍率 1')).not.toBeNull();
    expect(screen.getByText('req-1')).not.toBeNull();
    expect(screen.getByText('Response ID')).not.toBeNull();
    expect(screen.getByText('resp-1')).not.toBeNull();
    expect(screen.getByText('计费过程')).not.toBeNull();
    expect(screen.queryByText(/"mode": "token"/)).toBeNull();
    expect(screen.getByText('生成图片 URL')).not.toBeNull();
    expect(screen.getByText('请求域名')).not.toBeNull();
    expect(screen.getByText('192.168.50.218:3100')).not.toBeNull();
    expect(screen.getByText('请求路径')).not.toBeNull();
    expect(screen.getByText('/v1/images/generations')).not.toBeNull();
    expect(screen.getByText('日志详情')).not.toBeNull();
    expect(screen.queryByText(/未来扩展字段/)).toBeNull();
    const expandContentButtons = screen.getAllByRole('button', {
      name: '展开内容',
    });
    fireEvent.click(expandContentButtons[0]);
    expect(screen.getByText(/"mode": "token"/)).not.toBeNull();
    fireEvent.click(expandContentButtons[1]);
    expect(screen.getByText(/未来扩展字段/)).not.toBeNull();
    expect(screen.queryByText('gpt-image-11')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(getLogs).toHaveBeenCalledWith(2, 10, false));
    expect(await screen.findByText('gpt-image-11')).not.toBeNull();
    expect(screen.getByText('11-12 / 12')).not.toBeNull();
    expect(screen.getByText('2 / 2')).not.toBeNull();
    expect(screen.queryByText('gpt-image-1')).toBeNull();
    expect(screen.queryByText('详情内容')).toBeNull();
    expect(
      (screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(screen.queryByText('分组 Key')).toBeNull();
  });

  it('provides a column settings menu in the logs view', async () => {
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);

    fireEvent.click(await screen.findByRole('button', { name: '日志' }));
    fireEvent.click(await screen.findByRole('button', { name: '列设置' }));

    expect(await screen.findByText('选择展示字段')).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: '时间' })).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: '预览' })).not.toBeNull();
    expect(screen.queryByRole('checkbox', { name: '渠道' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Request ID' })).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: '调用状态' })).not.toBeNull();
    expect(screen.getByRole('checkbox', { name: 'IP' })).not.toBeNull();

    for (const label of ['时间', '分组', '模型', '预览', '用时', '金额']) {
      expect(
        (screen.getByRole('checkbox', { name: label }) as HTMLInputElement)
          .checked
      ).toBe(true);
    }
    for (const label of [
      '令牌',
      '类型',
      '调用状态',
      '输入',
      '输出',
      'IP',
      '详情',
    ]) {
      expect(
        (screen.getByRole('checkbox', { name: label }) as HTMLInputElement)
          .checked
      ).toBe(false);
    }

    fireEvent.click(screen.getByRole('checkbox', { name: '调用状态' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'IP' }));

    expect(await screen.findByText('成功扣费')).not.toBeNull();
    expect(screen.getByText('127.0.0.1')).not.toBeNull();
  });

  it('shows management log columns only to Tuzi operators and admins', async () => {
    getAccount.mockResolvedValueOnce({
      id: 2,
      role: 5,
      username: 'operator',
      displayName: 'Operator',
      email: 'operator@example.com',
      group: 'default',
      quota: 100,
      usedQuota: 10,
      requestCount: 1,
    });
    const { TuziAccountPanel } = await import('./TuziAccountPanel');

    render(<TuziAccountPanel />);
    fireEvent.click(await screen.findByRole('button', { name: '日志' }));

    expect(screen.queryByText('渠道')).toBeNull();
    expect(getLogs).toHaveBeenCalledWith(1, 10, true);

    fireEvent.click(screen.getByRole('button', { name: '列设置' }));
    expect(
      (screen.getByRole('checkbox', { name: '用户' }) as HTMLInputElement)
        .checked
    ).toBe(true);
    const channelCheckbox = screen.getByRole('checkbox', { name: '渠道' });
    expect((channelCheckbox as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: '重试' })).not.toBeNull();
    fireEvent.click(channelCheckbox);
    expect((channelCheckbox as HTMLInputElement).checked).toBe(true);
  });
});
