import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Eye,
  ExternalLink,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { Button, MessagePlugin } from 'tdesign-react';
import { BaseDrawer } from '../side-drawer';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useOpenTuAccountWorkspace } from '../../contexts/OpenTuAccountContext';
import type {
  OpenTuTopupCreateResult,
  OpenTuTopupGateway,
  OpenTuTopupInfo,
  OpenTuTopupQuote,
} from '../../services/opentu-api-client';
import type { AccountWorkspaceStatus } from './AccountToolbarButton';
import './account.scss';

type AccountTab = 'overview' | 'calls' | 'devices';
type DataRecord = Record<string, unknown>;

export interface AccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const TAB_ITEMS: Array<{ value: AccountTab; label: string }> = [
  { value: 'overview', label: '概览' },
  { value: 'calls', label: '调用记录' },
  { value: 'devices', label: '设备' },
];

function isRecord(value: unknown): value is DataRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readText(record: DataRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
  }
  return '';
}

function extractRecords(value: unknown): DataRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['items', 'records', 'data', 'list', 'models', 'devices']) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function formatDate(value: unknown): string {
  if (typeof value !== 'number' && typeof value !== 'string') return '--';
  const numeric = typeof value === 'string' ? Number(value) : value;
  const timestamp =
    Number.isFinite(numeric) && numeric > 0 && numeric < 10_000_000_000
      ? numeric * 1000
      : numeric;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString();
}

function getDisplayName(account: unknown): string {
  if (!isRecord(account)) return '';
  return (
    readText(account, ['displayName', 'display_name']) ||
    readText(account, ['username'])
  );
}

function getQuota(account: unknown): string {
  if (!isRecord(account)) return '--';
  const value = account.quota;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString();
  }
  return typeof value === 'string' && value.trim() ? value.trim() : '--';
}

function getManagedGroupStatus(status: string | undefined): string {
  const normalized = status?.trim().toLowerCase();
  return normalized && ['disabled', 'inactive', 'revoked'].includes(normalized)
    ? '不可用'
    : '已配置';
}

function formatUsageAmount(item: DataRecord): string {
  const amountValue =
    item.amount ?? item.price ?? item.cost ?? item.money ?? item.quota;
  if (typeof amountValue === 'string' && amountValue.trim()) {
    const amount = Number(amountValue);
    if (!Number.isFinite(amount)) return amountValue.trim();
    return formatUsageNumericAmount(item, amount);
  }
  if (typeof amountValue !== 'number' || !Number.isFinite(amountValue)) {
    return '--';
  }
  return formatUsageNumericAmount(item, amountValue);
}

function formatUsageNumericAmount(item: DataRecord, amount: number): string {
  const currency = readText(item, ['currency', 'currency_type']);
  if (currency.toUpperCase() === 'TOKENS') return amount.toLocaleString();
  const symbol = readText(item, ['currency_symbol']);
  const prefix = symbol || (currency ? `${currency} ` : '');
  return `${prefix}${amount.toFixed(6)}`;
}

function getUsageDetailText(item: DataRecord): string {
  return (
    readText(item, ['detail']) ||
    readText(item, ['details']) ||
    readText(item, ['content']) ||
    readText(item, ['message'])
  );
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function formatMoney(value: unknown, currency = ''): string {
  const number = finiteNumber(value);
  if (number === null) return '--';
  return `${currency ? `${currency} ` : ''}${number.toFixed(2)}`;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `opentu-${crypto.randomUUID()}`;
  }
  return `opentu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safePaymentUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function getStateCopy(status: AccountWorkspaceStatus): {
  title: string;
  description: string;
} {
  switch (status) {
    case 'expired':
      return {
        title: '登录已失效',
        description: '请回到 Tuzi 重新连接账户后再继续使用。',
      };
    case 'revoked':
      return {
        title: '设备授权已撤销',
        description: '当前设备无法继续访问该账户，请重新完成设备连接。',
      };
    case 'insufficient':
      return {
        title: '可用额度不足',
        description: '账户信息仍可查看，充值后可继续生成内容。',
      };
    case 'error':
      return {
        title: '账户加载失败',
        description: '暂时无法读取账户信息，请稍后重试。',
      };
    default:
      return {
        title: '账户暂不可用',
        description: '当前运行模式没有可用的 Tuzi 账户会话。',
      };
  }
}

export const AccountDrawer: React.FC<AccountDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const workspace = useOpenTuAccountWorkspace();
  const [activeTab, setActiveTab] = useState<AccountTab>('overview');
  const [usage, setUsage] = useState<unknown>(null);
  const [devices, setDevices] = useState<unknown>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [selectedUsageRecord, setSelectedUsageRecord] =
    useState<DataRecord | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [topupInfo, setTopupInfo] = useState<OpenTuTopupInfo | null>(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupGatewayId, setTopupGatewayId] = useState('');
  const [topupQuote, setTopupQuote] = useState<OpenTuTopupQuote | null>(null);
  const [topupOrder, setTopupOrder] = useState<OpenTuTopupCreateResult | null>(
    null
  );
  const [topupStatus, setTopupStatus] = useState('');
  const [topupError, setTopupError] = useState<string | null>(null);
  const [topupIdempotencyKey, setTopupIdempotencyKey] = useState('');
  const [deviceToRevoke, setDeviceToRevoke] = useState<DataRecord | null>(null);
  const [deviceRevokeError, setDeviceRevokeError] = useState<string | null>(
    null
  );
  const [rotateAllOpen, setRotateAllOpen] = useState(false);
  const [rotatingAllGroups, setRotatingAllGroups] = useState(false);
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});

  const account = workspace.account;
  const displayName = getDisplayName(account);
  const accountRecord = isRecord(account) ? account : {};
  const modeLabel = workspace.mode === 'embedded' ? 'Tuzi 内嵌' : '独立运行';
  const usageRows = useMemo(() => extractRecords(usage), [usage]);
  const deviceRows = useMemo(() => extractRecords(devices), [devices]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      setUsage(await workspace.loadUsage({ page: 1, pageSize: 30 }));
    } catch (error) {
      setUsageError(
        error instanceof Error ? error.message : '调用记录加载失败'
      );
    } finally {
      setUsageLoading(false);
    }
  }, [workspace]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      setDevices(await workspace.loadDevices());
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : '设备加载失败');
    } finally {
      setDevicesLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    if (
      !isOpen ||
      (workspace.status !== 'ready' && workspace.status !== 'insufficient')
    )
      return;
    if (activeTab === 'calls' && usage === null && !usageLoading) {
      void loadUsage();
    }
    if (activeTab === 'devices' && devices === null && !devicesLoading) {
      void loadDevices();
    }
  }, [
    activeTab,
    devices,
    devicesLoading,
    isOpen,
    loadDevices,
    loadUsage,
    usage,
    usageLoading,
    workspace.status,
  ]);

  const topupGateways = topupInfo?.gateways || [];
  const selectedGateway = topupGateways.find(
    (gateway) => String(gateway.id) === topupGatewayId
  );

  const handleRecharge = useCallback(async () => {
    setRechargeOpen(true);
    setRechargeLoading(true);
    setTopupError(null);
    try {
      const info = await workspace.getTopupInfo();
      const gateways = info.gateways || [];
      setTopupInfo(info);
      if (!topupAmount) {
        const firstAmount = info.amount_options?.[0] ?? info.min_topup ?? '';
        setTopupAmount(String(firstAmount));
      }
      if (!topupGatewayId && gateways[0]) {
        setTopupGatewayId(String(gateways[0].id));
      }
    } catch (error) {
      setTopupError(
        error instanceof Error ? error.message : '充值配置加载失败'
      );
    } finally {
      setRechargeLoading(false);
    }
  }, [topupAmount, topupGatewayId, workspace]);

  const resetTopupAttempt = useCallback(() => {
    setTopupQuote(null);
    setTopupOrder(null);
    setTopupStatus('');
    setTopupError(null);
    setTopupIdempotencyKey('');
  }, []);

  const handleTopupQuote = useCallback(async () => {
    const amount = Number(topupAmount);
    const gatewayId = Number(topupGatewayId);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(gatewayId)
    ) {
      setTopupError('请输入有效金额并选择支付方式');
      return;
    }
    setRechargeLoading(true);
    setTopupError(null);
    try {
      setTopupQuote(
        await workspace.estimateTopup({ gateway_id: gatewayId, amount })
      );
      setTopupIdempotencyKey(newIdempotencyKey());
    } catch (error) {
      setTopupError(error instanceof Error ? error.message : '金额计算失败');
    } finally {
      setRechargeLoading(false);
    }
  }, [topupAmount, topupGatewayId, workspace]);

  const handleTopupCreate = useCallback(async () => {
    const amount = Number(topupAmount);
    const gatewayId = Number(topupGatewayId);
    if (!topupQuote || !topupIdempotencyKey) return;
    setRechargeLoading(true);
    setTopupError(null);
    try {
      const order = await workspace.createTopup(
        { gateway_id: gatewayId, amount },
        topupIdempotencyKey
      );
      setTopupOrder(order);
      setTopupStatus(order.completed ? 'success' : 'pending');
      if (order.completed) await workspace.refresh();
    } catch (error) {
      setTopupError(
        error instanceof Error ? error.message : '支付订单创建失败'
      );
    } finally {
      setRechargeLoading(false);
    }
  }, [topupAmount, topupGatewayId, topupIdempotencyKey, topupQuote, workspace]);

  const handleTopupQuery = useCallback(async () => {
    if (!topupOrder?.trade_no) return;
    setRechargeLoading(true);
    setTopupError(null);
    try {
      const result = await workspace.queryTopup({
        trade_no: topupOrder.trade_no,
      });
      setTopupStatus(result.status);
      if (result.status === 'success') {
        await workspace.refresh();
        MessagePlugin.success('充值已到账');
      }
    } catch (error) {
      setTopupError(
        error instanceof Error ? error.message : '订单状态查询失败'
      );
    } finally {
      setRechargeLoading(false);
    }
  }, [topupOrder, workspace]);

  const handleRevoke = useCallback(async () => {
    if (!deviceToRevoke) return;
    const id = deviceToRevoke.id;
    if (typeof id !== 'number' && typeof id !== 'string') return;
    setDeviceRevokeError(null);
    try {
      await workspace.revokeDevice(String(id));
      setDeviceToRevoke(null);
      await loadDevices();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '设备撤销失败，请重试';
      setDeviceRevokeError(message);
      MessagePlugin.error(message);
    }
  }, [deviceToRevoke, loadDevices, workspace]);

  const handleRotateAllGroups = useCallback(async () => {
    if (rotatingAllGroups || workspace.managedGroups.length === 0) return;
    const groups = [...workspace.managedGroups];
    setRotateAllOpen(false);
    setRotatingAllGroups(true);
    setGroupErrors({});
    const errors: Record<string, string> = {};
    for (const item of groups) {
      try {
        await workspace.rotateManagedGroup(item.group);
      } catch (error) {
        errors[item.group] =
          error instanceof Error ? error.message : '重新生成 Key 失败';
      }
    }
    setGroupErrors(errors);
    setRotatingAllGroups(false);
    const failedCount = Object.keys(errors).length;
    if (failedCount === 0) {
      MessagePlugin.success(`已重新生成 ${groups.length} 个分组的 Key`);
    } else {
      MessagePlugin.error(
        `${groups.length - failedCount} 个分组已完成，${failedCount} 个分组失败`
      );
    }
  }, [rotatingAllGroups, workspace]);

  const renderLoading = () => (
    <div className="account-drawer__state" data-testid="account-loading">
      <Loader2 className="account-drawer__spinner" size={24} />
      <span>正在加载账户...</span>
    </div>
  );

  const renderFailure = () => {
    const copy = getStateCopy(workspace.status);
    return (
      <div className="account-drawer__state account-drawer__state--error">
        <AlertCircle size={28} />
        <strong>{copy.title}</strong>
        <span>{workspace.error?.message || copy.description}</span>
        <div className="account-drawer__state-actions">
          <Button icon={<RefreshCw size={15} />} onClick={workspace.refresh}>
            重试
          </Button>
          {workspace.status === 'insufficient' && (
            <Button
              theme="primary"
              loading={rechargeLoading}
              onClick={() => void handleRecharge()}
            >
              充值
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderOverview = () => (
    <div className="account-overview">
      <section className="account-overview__identity">
        <div className="account-overview__avatar" aria-hidden="true">
          {displayName.slice(0, 1).toUpperCase() || <UserRound size={24} />}
        </div>
        <div className="account-overview__identity-copy">
          <strong>{displayName || 'Tuzi 用户'}</strong>
          <span>{readText(accountRecord, ['email']) || '未提供邮箱'}</span>
        </div>
        <span className="account-mode-badge">{modeLabel}</span>
      </section>

      <section className="account-overview__quota">
        <div>
          <span>可用额度</span>
          <strong data-testid="account-quota">{getQuota(account)}</strong>
        </div>
        <Button
          theme="primary"
          icon={<CreditCard size={16} />}
          loading={rechargeLoading}
          onClick={() => void handleRecharge()}
        >
          充值
        </Button>
      </section>

      <section
        className="account-managed-groups"
        aria-labelledby="access-groups-title"
      >
        <div className="account-managed-groups__heading">
          <strong id="access-groups-title">访问分组</strong>
          <Button
            variant="text"
            size="small"
            icon={<RefreshCw size={14} />}
            loading={rotatingAllGroups}
            disabled={rotatingAllGroups || workspace.managedGroups.length === 0}
            onClick={() => setRotateAllOpen(true)}
          >
            全部重新生成
          </Button>
        </div>

        {workspace.managedGroupsStatus === 'loading' &&
        workspace.managedGroups.length === 0 ? (
          <div className="account-managed-groups__message">
            <Loader2 className="account-drawer__spinner" size={16} />
            正在同步分组...
          </div>
        ) : workspace.managedGroupsStatus === 'error' &&
          workspace.managedGroups.length === 0 ? (
          <div
            className="account-managed-groups__message account-managed-groups__message--error"
            role="alert"
          >
            <AlertCircle size={16} />
            {workspace.managedGroupsError || '访问分组同步失败'}
          </div>
        ) : workspace.managedGroups.length === 0 ? (
          <div className="account-managed-groups__message">暂无可用分组</div>
        ) : (
          <div className="account-managed-groups__list">
            {workspace.managedGroups.map((item) => {
              return (
                <div className="account-managed-groups__row" key={item.group}>
                  <div>
                    <strong>{item.display_name}</strong>
                    <span>{getManagedGroupStatus(item.status)}</span>
                    {groupErrors[item.group] && (
                      <span
                        className="account-managed-groups__row-error"
                        role="alert"
                      >
                        {groupErrors[item.group]}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <dl className="account-overview__details">
        <div>
          <dt>用户名</dt>
          <dd>{readText(accountRecord, ['username']) || '--'}</dd>
        </div>
        <div>
          <dt>用户组</dt>
          <dd>{readText(accountRecord, ['group']) || '--'}</dd>
        </div>
        <div>
          <dt>账户 ID</dt>
          <dd>{readText(accountRecord, ['id']) || '--'}</dd>
        </div>
        <div>
          <dt>最近更新</dt>
          <dd>{formatDate(workspace.lastUpdatedAt)}</dd>
        </div>
      </dl>
    </div>
  );

  const renderRecharge = () => {
    const paymentUrl = safePaymentUrl(topupOrder?.payment_url);
    const qrCodeUrl = safePaymentUrl(topupOrder?.qrcode_url);
    const qrContentUrl = safePaymentUrl(topupOrder?.qrcode_content);
    const isSuccessful = topupStatus === 'success';

    return (
      <div className="account-topup" data-testid="account-topup">
        <button
          type="button"
          className="account-topup__back"
          onClick={() => setRechargeOpen(false)}
        >
          <ArrowLeft size={16} />
          返回概览
        </button>

        <header className="account-topup__header">
          <div>
            <strong>账户充值</strong>
            <span>支付结果和到账额度以 Tuzi 服务端确认为准</span>
          </div>
          <CreditCard size={22} aria-hidden="true" />
        </header>

        {rechargeLoading && !topupInfo ? renderLoading() : null}
        {topupError && (
          <div className="account-topup__error" role="alert">
            <AlertCircle size={17} />
            <span>{topupError}</span>
          </div>
        )}

        {topupInfo && !topupOrder && (
          <>
            <label className="account-topup__field">
              <span>充值额度</span>
              <input
                type="number"
                min={finiteNumber(selectedGateway?.min_amount) || 0}
                max={finiteNumber(selectedGateway?.max_amount) || undefined}
                step="1"
                value={topupAmount}
                onChange={(event) => {
                  setTopupAmount(event.target.value);
                  resetTopupAttempt();
                }}
              />
            </label>

            {Boolean(topupInfo.amount_options?.length) && (
              <div className="account-topup__amounts" aria-label="常用充值额度">
                {topupInfo.amount_options?.map((amount) => (
                  <button
                    key={String(amount)}
                    type="button"
                    className={classNames({
                      'account-topup__amount--selected':
                        String(amount) === topupAmount,
                    })}
                    onClick={() => {
                      setTopupAmount(String(amount));
                      resetTopupAttempt();
                    }}
                  >
                    {amount}
                  </button>
                ))}
              </div>
            )}

            <fieldset className="account-topup__gateways">
              <legend>支付方式</legend>
              {topupGateways.length === 0 ? (
                <span className="account-topup__muted">暂无可用支付方式</span>
              ) : (
                topupGateways.map((gateway: OpenTuTopupGateway) => (
                  <label
                    key={String(gateway.id)}
                    className={classNames('account-topup__gateway', {
                      'account-topup__gateway--selected':
                        String(gateway.id) === topupGatewayId,
                    })}
                  >
                    <input
                      type="radio"
                      name="opentu-topup-gateway"
                      value={String(gateway.id)}
                      checked={String(gateway.id) === topupGatewayId}
                      onChange={() => {
                        setTopupGatewayId(String(gateway.id));
                        resetTopupAttempt();
                      }}
                    />
                    <span>
                      <strong>{gateway.name || gateway.type}</strong>
                      <small>
                        {gateway.currency || 'CNY'}
                        {finiteNumber(gateway.min_amount) !== null
                          ? ` · 最低 ${gateway.min_amount}`
                          : ''}
                      </small>
                    </span>
                  </label>
                ))
              )}
            </fieldset>

            {topupQuote && (
              <dl className="account-topup__quote">
                <div>
                  <dt>充值额度</dt>
                  <dd>{topupAmount}</dd>
                </div>
                <div>
                  <dt>手续费</dt>
                  <dd>{formatMoney(topupQuote.fee, topupQuote.currency)}</dd>
                </div>
                <div>
                  <dt>应付金额</dt>
                  <dd>
                    {formatMoney(topupQuote.total_amount, topupQuote.currency)}
                  </dd>
                </div>
              </dl>
            )}

            <div className="account-topup__actions">
              {!topupQuote ? (
                <Button
                  theme="primary"
                  loading={rechargeLoading}
                  disabled={!topupGatewayId || !topupAmount}
                  onClick={() => void handleTopupQuote()}
                >
                  计算应付金额
                </Button>
              ) : (
                <Button
                  theme="primary"
                  loading={rechargeLoading}
                  onClick={() => void handleTopupCreate()}
                >
                  确认并创建订单
                </Button>
              )}
            </div>
          </>
        )}

        {topupOrder && (
          <section className="account-topup__order">
            {isSuccessful ? (
              <div className="account-topup__success">
                <CheckCircle2 size={34} />
                <strong>充值已到账</strong>
                <span>账户额度已刷新</span>
              </div>
            ) : (
              <>
                <div className="account-topup__order-heading">
                  <div>
                    <strong>等待支付</strong>
                    <span>订单号：{topupOrder.trade_no}</span>
                  </div>
                  <span className="account-mode-badge">{topupStatus}</span>
                </div>

                {qrCodeUrl && (
                  <img
                    className="account-topup__qr"
                    src={qrCodeUrl}
                    alt="支付二维码"
                  />
                )}
                {!qrCodeUrl && topupOrder.qrcode_content && (
                  <div className="account-topup__qr-content">
                    <span>支付信息</span>
                    <code>{topupOrder.qrcode_content}</code>
                  </div>
                )}

                <div className="account-topup__actions">
                  {(paymentUrl || qrContentUrl) && (
                    <Button
                      theme="primary"
                      icon={<ExternalLink size={15} />}
                      onClick={() =>
                        window.open(
                          paymentUrl || qrContentUrl,
                          '_blank',
                          'noopener'
                        )
                      }
                    >
                      打开支付页面
                    </Button>
                  )}
                  <Button
                    loading={rechargeLoading}
                    icon={<RefreshCw size={15} />}
                    onClick={() => void handleTopupQuery()}
                  >
                    查询支付状态
                  </Button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    );
  };

  const renderAsyncListState = (
    loading: boolean,
    error: string | null,
    retry: () => void,
    emptyLabel: string
  ) => {
    if (loading) return renderLoading();
    if (error) {
      return (
        <div className="account-drawer__state account-drawer__state--error">
          <AlertCircle size={24} />
          <strong>加载失败</strong>
          <span>{error}</span>
          <Button onClick={retry}>重试</Button>
        </div>
      );
    }
    return (
      <div className="account-drawer__empty">
        <strong>{emptyLabel}</strong>
      </div>
    );
  };

  const renderCalls = () => (
    <div className="account-call-table">
      {usageRows.length === 0 ? (
        renderAsyncListState(
          usageLoading,
          usageError,
          () => void loadUsage(),
          '暂无调用记录'
        )
      ) : (
        <>
          <div className="account-call-table__header" aria-hidden="true">
            <span>时间</span>
            <span>模型</span>
            <span>输出</span>
            <span>详情</span>
            <span>价格</span>
          </div>
          {usageRows.map((item, index) => (
            <article
              className="account-call-table__row"
              key={readText(item, ['id']) || index}
            >
              <span data-label="时间">{formatDate(item.created_at)}</span>
              <strong data-label="模型">
                {readText(item, ['model_name']) || '模型调用'}
              </strong>
              <span data-label="输出">{readText(item, ['output']) || '0'}</span>
              <span data-label="详情" className="account-call-table__detail">
                <Button
                  variant="text"
                  size="small"
                  icon={<Eye size={14} />}
                  onClick={() => setSelectedUsageRecord(item)}
                >
                  详情
                </Button>
              </span>
              <span data-label="价格" className="account-call-table__amount">
                {formatUsageAmount(item)}
              </span>
            </article>
          ))}
        </>
      )}
    </div>
  );

  const renderDevices = () => (
    <div className="account-list-view">
      {deviceRows.length === 0
        ? renderAsyncListState(
            devicesLoading,
            devicesError,
            () => void loadDevices(),
            '暂无设备'
          )
        : deviceRows.map((item, index) => {
            const isCurrent =
              Boolean(item.current ?? item.isCurrent ?? item.is_current) ||
              (readText(item, ['credential_id', 'credentialId']) !== '' &&
                readText(item, ['credential_id', 'credentialId']) ===
                  readText(accountRecord, ['credential_id', 'credentialId']));
            const status = readText(item, ['status']) || 'unknown';
            return (
              <article
                className="account-list-row account-device-row"
                key={readText(item, ['id']) || index}
              >
                <MonitorSmartphone size={20} aria-hidden="true" />
                <div>
                  <strong>
                    {readText(item, ['name', 'deviceName', 'device_name']) ||
                      'OpenTu 设备'}
                    {isCurrent && (
                      <span className="account-device-row__current">当前</span>
                    )}
                  </strong>
                  <span>
                    {status} · 最近使用{' '}
                    {formatDate(item.lastSeenAt ?? item.last_seen_at)}
                  </span>
                </div>
                <Button
                  variant="text"
                  theme="danger"
                  size="small"
                  disabled={status === 'revoked'}
                  onClick={() => {
                    setDeviceRevokeError(null);
                    setDeviceToRevoke(item);
                  }}
                >
                  撤销
                </Button>
              </article>
            );
          })}
    </div>
  );

  const readyContent = () => {
    if (rechargeOpen) return renderRecharge();
    switch (activeTab) {
      case 'calls':
        return renderCalls();
      case 'devices':
        return renderDevices();
      default:
        return renderOverview();
    }
  };

  const showReadyContent =
    workspace.status === 'ready' || workspace.status === 'insufficient';

  return (
    <>
      <BaseDrawer
        isOpen={isOpen}
        onClose={onClose}
        title="账户中心"
        subtitle={modeLabel}
        position="toolbar-right"
        width="responsive"
        defaultWidth={480}
        minWidth={360}
        maxWidth={720}
        storageKey="opentu-account-drawer-width"
        showBackdrop={false}
        closeOnEsc={true}
        className="account-drawer"
        contentClassName="account-drawer__content"
        data-testid="account-drawer"
        filterSection={
          showReadyContent && !rechargeOpen ? (
            <div
              className="account-tabs"
              role="tablist"
              aria-label="账户中心视图"
            >
              {TAB_ITEMS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === item.value}
                  className={classNames('account-tabs__item', {
                    'account-tabs__item--active': activeTab === item.value,
                  })}
                  onClick={() => setActiveTab(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        {workspace.status === 'loading' ? (
          renderLoading()
        ) : showReadyContent ? (
          workspace.status === 'insufficient' && activeTab === 'overview' ? (
            <>
              <div className="account-drawer__notice">
                可用额度不足，充值后可继续生成。
              </div>
              {readyContent()}
            </>
          ) : (
            readyContent()
          )
        ) : (
          renderFailure()
        )}
      </BaseDrawer>

      <ConfirmDialog
        open={Boolean(selectedUsageRecord)}
        title="调用详情"
        className="account-call-detail"
        footer={({ handleCancel }) => (
          <Button theme="primary" onClick={handleCancel}>
            关闭
          </Button>
        )}
        onOpenChange={(open) => {
          if (!open) setSelectedUsageRecord(null);
        }}
      >
        {selectedUsageRecord && (
          <dl className="account-call-detail__content">
            <div>
              <dt>时间</dt>
              <dd>{formatDate(selectedUsageRecord.created_at)}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>
                {readText(selectedUsageRecord, ['model_name']) || '模型调用'}
              </dd>
            </div>
            <div>
              <dt>输出</dt>
              <dd>{readText(selectedUsageRecord, ['output']) || '0'}</dd>
            </div>
            <div>
              <dt>价格</dt>
              <dd className="account-call-detail__amount">
                {formatUsageAmount(selectedUsageRecord)}
              </dd>
            </div>
            <div className="account-call-detail__description">
              <dt>详细信息</dt>
              <dd>{getUsageDetailText(selectedUsageRecord) || '暂无详情'}</dd>
            </div>
          </dl>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(deviceToRevoke)}
        title="撤销设备授权"
        description="撤销后，该设备将无法继续使用当前账户。此操作需要重新连接才能恢复。"
        confirmText="撤销设备"
        danger
        closeOnConfirm={false}
        onOpenChange={(open) => {
          if (!open) {
            setDeviceToRevoke(null);
            setDeviceRevokeError(null);
          }
        }}
        onConfirm={handleRevoke}
      >
        {deviceRevokeError && (
          <div className="account-revoke-error" role="alert">
            {deviceRevokeError}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={rotateAllOpen}
        title="重新生成全部 Key"
        description={`确认重新生成全部 ${workspace.managedGroups.length} 个访问分组的 Key？后续请求会自动使用新 Key，原 Key 将不再使用。`}
        confirmText="全部重新生成"
        closeOnConfirm={false}
        onOpenChange={(open) => {
          setRotateAllOpen(open);
        }}
        onConfirm={handleRotateAllGroups}
      />
    </>
  );
};
