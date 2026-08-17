// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  loadUsage: vi.fn(),
  loadTopups: vi.fn(),
  getTopupInfo: vi.fn(),
  estimateTopup: vi.fn(),
  createTopup: vi.fn(),
  queryTopup: vi.fn(),
  loadDevices: vi.fn(),
  revokeDevice: vi.fn(),
  rotateManagedGroup: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
  messageSuccess: vi.fn(),
  workspace: {} as Record<string, unknown>,
}));

vi.mock('../../contexts/OpenTuAccountContext', () => ({
  useOpenTuAccountWorkspace: () => mocks.workspace,
}));

vi.mock('../side-drawer', () => ({
  BaseDrawer: ({
    isOpen,
    title,
    subtitle,
    filterSection,
    children,
  }: {
    isOpen: boolean;
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    filterSection?: React.ReactNode;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <section data-testid="account-drawer">
        <h2>{title}</h2>
        <span>{subtitle}</span>
        {filterSection}
        {children}
      </section>
    ) : null,
}));

vi.mock('../dialog/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    confirmText,
    onConfirm,
    children,
  }: {
    open: boolean;
    title: React.ReactNode;
    confirmText: React.ReactNode;
    onConfirm?: () => void | Promise<void>;
    children?: React.ReactNode;
  }) =>
    open ? (
      <div role="dialog">
        <h3>{title}</h3>
        {children}
        <button onClick={() => void onConfirm?.()}>{confirmText}</button>
      </div>
    ) : null,
}));

vi.mock('tdesign-react', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  MessagePlugin: {
    error: mocks.messageError,
    warning: mocks.messageWarning,
    success: mocks.messageSuccess,
  },
}));

// eslint-disable-next-line import/first
import { AccountDrawer } from './AccountDrawer';

function createWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'embedded',
    status: 'ready',
    account: {
      id: 42,
      username: 'lin',
      displayName: 'Lin',
      email: 'lin@example.com',
      quota: '125000',
      group: 'default',
    },
    error: null,
    lastUpdatedAt: 1_700_000_000_000,
    refresh: mocks.refresh,
    loadUsage: mocks.loadUsage,
    loadTopups: mocks.loadTopups,
    getTopupInfo: mocks.getTopupInfo,
    estimateTopup: mocks.estimateTopup,
    createTopup: mocks.createTopup,
    queryTopup: mocks.queryTopup,
    loadDevices: mocks.loadDevices,
    revokeDevice: mocks.revokeDevice,
    managedGroups: [
      {
        group: 'default',
        display_name: '默认分组',
        api_key: 'must-not-render',
        base_url: 'https://api.tu-zi.com/v1',
        status: 'active',
        token_id: 8,
      },
      {
        group: 'gemini-mix',
        display_name: 'Gemini Mix',
        api_key: 'also-must-not-render',
        base_url: 'https://api.tu-zi.com/v1',
        status: 'disabled',
        token_id: 9,
      },
    ],
    managedGroupsStatus: 'ready',
    managedGroupsError: null,
    rotateManagedGroup: mocks.rotateManagedGroup,
    ...overrides,
  };
}

describe('AccountDrawer', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadUsage.mockResolvedValue({ items: [] });
    mocks.loadDevices.mockResolvedValue({ items: [] });
    mocks.getTopupInfo.mockResolvedValue({
      min_topup: 10,
      amount_options: [10, 50, 100],
      gateways: [
        {
          id: 7,
          type: 'epay',
          name: '支付宝',
          currency: 'CNY',
          min_amount: 10,
        },
      ],
    });
    mocks.estimateTopup.mockResolvedValue({
      amount: 50,
      base_amount: 50,
      fee: 0,
      total_amount: 50,
      currency: 'CNY',
      fixed_fee: 0,
      percent_fee: 0,
      discount: 1,
      topup_group_ratio: 1,
    });
    mocks.createTopup.mockResolvedValue({
      trade_no: 'USR42GW7NO123',
      payment_url: 'https://pay.example/checkout',
      display_mode: 'redirect',
    });
    mocks.queryTopup.mockResolvedValue({
      status: 'success',
      message: '订单已完成',
    });
    mocks.revokeDevice.mockResolvedValue(undefined);
    mocks.rotateManagedGroup.mockResolvedValue(undefined);
    mocks.workspace = createWorkspace();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderDrawer() {
    await act(async () => {
      root.render(<AccountDrawer isOpen onClose={vi.fn()} />);
    });
  }

  it('renders account identity, mode and raw quota without a fake currency', async () => {
    await renderDrawer();

    expect(container.textContent).toContain('Lin');
    expect(container.textContent).toContain('Tuzi 内嵌');
    expect(
      container.querySelector('[data-testid="account-quota"]')?.textContent
    ).toBe('125000');
    expect(container.textContent).not.toContain('¥');
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).toContain('默认分组');
    expect(container.textContent).toContain('Gemini Mix');
    expect(container.textContent).toContain('已配置');
    expect(container.textContent).toContain('不可用');
    expect(container.textContent).not.toContain('active');
    expect(container.textContent).not.toContain(
      '系统已为各分组自动配置访问凭据'
    );
    expect(container.textContent).not.toContain('must-not-render');
  });

  it('confirms once and rotates every managed group', async () => {
    await renderDrawer();
    const rotateButtons = Array.from(
      container.querySelectorAll('button')
    ).filter((button) => button.textContent === '全部重新生成');
    expect(rotateButtons).toHaveLength(1);
    expect(container.textContent).not.toContain('更换 Key');

    act(() => rotateButtons[0].click());
    expect(container.textContent).toContain('重新生成全部 Key');
    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) =>
        button.textContent === '全部重新生成' && button !== rotateButtons[0]
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.rotateManagedGroup).toHaveBeenNthCalledWith(1, 'default');
    expect(mocks.rotateManagedGroup).toHaveBeenNthCalledWith(2, 'gemini-mix');
    expect(mocks.rotateManagedGroup).toHaveBeenCalledTimes(2);
    expect(mocks.messageSuccess).toHaveBeenCalledWith(
      '已重新生成 2 个分组的 Key'
    );
  });

  it('shows an expired session state and retries through the workspace hook', async () => {
    mocks.workspace = createWorkspace({
      status: 'expired',
      account: null,
    });
    await renderDrawer();

    expect(container.textContent).toContain('登录已失效');
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '重试'
    );
    act(() => retry?.click());
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('loads and renders only the requested call-record columns', async () => {
    mocks.loadUsage.mockResolvedValue({
      items: [
        {
          id: 9,
          created_at: 1_700_000_000,
          model_name: 'gemini-3-flash-preview',
          output: 324,
          detail: '按Token计费，模型倍率: 0.25',
          amount: 0.001102,
          currency: 'CNY',
          currency_symbol: '¥',
        },
      ],
    });
    await renderDrawer();
    const usageTab = Array.from(
      container.querySelectorAll('[role="tab"]')
    ).find((tab) => tab.textContent === '调用记录');

    await act(async () => {
      (usageTab as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(mocks.loadUsage).toHaveBeenCalledWith({ page: 1, pageSize: 30 });
    expect(container.textContent).toContain('gemini-3-flash-preview');
    expect(container.textContent).toContain('324');
    expect(container.textContent).not.toContain('按Token计费，模型倍率: 0.25');
    expect(container.textContent).toContain('¥0.001102');
    expect(container.textContent).toContain('价格');

    const detailButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '详情'
    );
    act(() => detailButton?.click());

    expect(container.textContent).toContain('调用详情');
    expect(container.textContent).toContain('按Token计费，模型倍率: 0.25');
    expect(container.textContent).toContain('价格');
    expect(container.textContent).toContain('¥0.001102');
    expect(container.textContent).not.toContain('模型 / 价格');
    expect(container.textContent).not.toContain('用量');
    expect(container.textContent).not.toContain('任务队列');
  });

  it('confirms device revocation and refreshes the device list', async () => {
    mocks.loadDevices
      .mockResolvedValueOnce({
        items: [{ id: 7, name: 'Safari', status: 'active', current: false }],
      })
      .mockResolvedValueOnce({ items: [] });
    await renderDrawer();
    const devicesTab = Array.from(
      container.querySelectorAll('[role="tab"]')
    ).find((tab) => tab.textContent === '设备');

    await act(async () => {
      (devicesTab as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const revoke = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '撤销'
    );
    act(() => revoke?.click());

    const confirm = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '撤销设备'
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.revokeDevice).toHaveBeenCalledWith('7');
    expect(mocks.loadDevices).toHaveBeenCalledTimes(2);
  });

  it('keeps recharge inside the account drawer and confirms payment through Tuzi', async () => {
    await renderDrawer();
    const recharge = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '充值'
    );

    await act(async () => {
      recharge?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('账户充值');
    expect(container.textContent).toContain('支付宝');
    expect(container.textContent).not.toContain('Tuzi 控制台');

    const presetAmount = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '50'
    );
    act(() => presetAmount?.click());
    const quote = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '计算应付金额'
    );
    await act(async () => {
      quote?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.estimateTopup).toHaveBeenCalledWith({
      gateway_id: 7,
      amount: 50,
    });
    expect(container.textContent).toContain('CNY 50.00');

    const create = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '确认并创建订单'
    );
    await act(async () => {
      create?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createTopup).toHaveBeenCalledWith(
      { gateway_id: 7, amount: 50 },
      expect.stringMatching(/^opentu-/)
    );
    expect(container.textContent).toContain('等待支付');

    const query = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '查询支付状态'
    );
    await act(async () => {
      query?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.queryTopup).toHaveBeenCalledWith({
      trade_no: 'USR42GW7NO123',
    });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(container.textContent).toContain('充值已到账');
  });
});
