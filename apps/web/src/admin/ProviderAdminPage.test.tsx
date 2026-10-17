/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderAdminPage } from './ProviderAdminPage';

const { sessionState, api } = vi.hoisted(() => ({
  sessionState: {
    account: { id: 'admin-1', username: '平台管理员', role: 5 } as {
      id: string;
      username: string;
      role: number;
    } | null,
    checking: false,
  },
  api: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
    syncModels: vi.fn(),
    models: vi.fn(),
    updateModel: vi.fn(),
  },
}));

vi.mock('../account/use-account-session', () => ({
  useAccountSession: () => sessionState,
}));

vi.mock('../services/provider-management-api', () => ({
  providerManagementApi: api,
}));

beforeEach(() => {
  sessionState.account = { id: 'admin-1', username: '平台管理员', role: 5 };
  sessionState.checking = false;
  api.list.mockResolvedValue([]);
  api.models.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProviderAdminPage', () => {
  it('shows the model service workflow and a direct return to creation', async () => {
    const onGoCreativeCenter = vi.fn();

    render(
      <ProviderAdminPage
        onGoHome={vi.fn()}
        onGoCreativeCenter={onGoCreativeCenter}
      />
    );

    expect(await screen.findByRole('heading', { name: '模型服务管理' })).toBeTruthy();
    expect(screen.getByText('/admin/providers')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '添加供应商' })).toBeTruthy();
    expect(screen.getByText('从一个可靠的供应商开始')).toBeTruthy();
    expect(screen.getByText('OPENTU_PUBLIC_GENERATION_ENABLED=true')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看创作中心' }));
    expect(onGoCreativeCenter).toHaveBeenCalledTimes(1);
  });

  it('blocks ordinary accounts from provider credentials', () => {
    sessionState.account = { id: 'user-1', username: '普通用户', role: 0 };

    render(<ProviderAdminPage onGoHome={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '需要管理员权限' })).toBeTruthy();
    expect(screen.getByText(/普通用户/)).toBeTruthy();
    expect(screen.queryByText('API Key')).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('shows publish, billing, gateway, and routing controls for synced models', async () => {
    api.list.mockResolvedValue([
      {
        id: 'provider-1',
        name: '生产模型服务',
        baseUrl: 'https://api.example.com/v1',
        authType: 'bearer',
        enabled: true,
        healthStatus: 'healthy',
        healthMessage: null,
        lastCheckedAt: '2026-09-14T00:00:00.000Z',
        hasApiKey: true,
      },
    ]);
    api.models.mockResolvedValue([
      {
        id: 'model-1',
        modelId: 'gpt-image-2',
        name: 'GPT Image 2',
        vendor: 'OpenAI',
        category: 'image',
        description: '图片生成模型',
        tags: ['image'],
        accent: 'violet',
        available: true,
        published: false,
        gatewayEnabled: false,
        billingMode: 'unconfigured',
        routingPriority: 100,
        lastSeenAt: '2026-09-14T00:00:00.000Z',
      },
    ]);

    render(<ProviderAdminPage onGoHome={vi.fn()} />);

    expect(await screen.findByText('GPT Image 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上架' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /开启网关/ })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'GPT Image 2 计费模式' })).toBeTruthy();
    expect(screen.getByText('优先级')).toBeTruthy();
  });
});
