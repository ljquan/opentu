import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Settings2,
} from 'lucide-react';
import {
  TuziSessionApiClient,
  TuziSessionApiError,
  type TuziAccount,
  type TuziDisplayConfig,
  type TuziLogPage,
  type TuziUsageLog,
  type TuziManagedProvider,
} from '../../services/tuzi-session-api';
import { synchronizeTuziManagedProviders } from '../../services/tuzi-managed-providers';
import { discoverAndUseAllTuziProviderModels } from '../../services/tuzi-managed-provider-models';
import { tuziEmbeddedConfig } from '../../services/tuzi-embedded-config';
import { providerProfilesSettings } from '../../utils/settings-manager';
import type { ProviderProfile } from '../../utils/settings-types';
import { resetTuziSessionProviderSyncCache } from '../../services/tuzi-session-provider-sync';
import {
  clearTuziSystemUserId,
  clearTuziSystemToken,
  getTuziSystemToken,
  initializeTuziSystemTokenFromUrl,
  getTuziSystemUserId,
  maskTuziSystemToken,
  saveTuziSystemToken,
  saveTuziSystemUserId,
} from '../../services/tuzi-token-auth';
import { HoverTip } from '../shared/hover';
import './tuzi-account-panel.scss';

const EMPTY_LOG_PAGE: TuziLogPage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
};
const LOG_PAGE_SIZE = 10;
const ACCOUNT_CACHE_KEY = 'opentu.tuzi.account-cache.v2';
const LOG_CACHE_KEY = 'opentu.tuzi.logs-cache.v2';
const CACHE_TTL_MS = 60_000;
type TuziAccountView = 'balance' | 'logs';
type TuziLogColumnId =
  | 'time'
  | 'channel'
  | 'user'
  | 'token'
  | 'group'
  | 'type'
  | 'callStatus'
  | 'model'
  | 'useTime'
  | 'input'
  | 'output'
  | 'ip'
  | 'retry'
  | 'details'
  | 'amount'
  | 'requestId'
  | 'upstreamRequestId';

interface TuziLogColumn {
  id: TuziLogColumnId;
  label: string;
  width: string;
  align?: 'right';
}

const LOG_COLUMN_STORAGE_KEY = 'opentu.tuziAccount.visibleLogColumns.v1';
const LOG_COLUMNS: TuziLogColumn[] = [
  { id: 'time', label: '时间', width: 'minmax(136px, 1.05fr)' },
  { id: 'channel', label: '渠道', width: 'minmax(92px, 0.75fr)' },
  { id: 'user', label: '用户', width: 'minmax(72px, 0.6fr)' },
  { id: 'token', label: '令牌', width: 'minmax(132px, 1fr)' },
  { id: 'group', label: '分组', width: 'minmax(84px, 0.7fr)' },
  { id: 'type', label: '类型', width: 'minmax(64px, 0.55fr)' },
  { id: 'callStatus', label: '调用状态', width: 'minmax(92px, 0.75fr)' },
  { id: 'model', label: '模型', width: 'minmax(140px, 1.15fr)' },
  { id: 'useTime', label: '用时', width: 'minmax(72px, 0.6fr)' },
  { id: 'input', label: '输入', width: 'minmax(64px, 0.55fr)', align: 'right' },
  {
    id: 'output',
    label: '输出',
    width: 'minmax(64px, 0.55fr)',
    align: 'right',
  },
  { id: 'ip', label: 'IP', width: 'minmax(104px, 0.8fr)' },
  { id: 'retry', label: '重试', width: 'minmax(64px, 0.55fr)', align: 'right' },
  { id: 'details', label: '详情', width: 'minmax(104px, 0.8fr)' },
  {
    id: 'amount',
    label: '金额',
    width: 'minmax(96px, 0.75fr)',
    align: 'right',
  },
  { id: 'requestId', label: 'Request ID', width: 'minmax(128px, 1fr)' },
  {
    id: 'upstreamRequestId',
    label: '上游 Request ID',
    width: 'minmax(148px, 1.1fr)',
  },
];
const DEFAULT_LOG_COLUMN_IDS: TuziLogColumnId[] = [
  'time',
  'channel',
  'user',
  'model',
  'output',
  'details',
  'amount',
];
const ADMIN_LOG_COLUMN_IDS = new Set<TuziLogColumnId>([
  'channel',
  'user',
  'retry',
  'upstreamRequestId',
]);
const LOG_COLUMN_ID_SET = new Set(LOG_COLUMNS.map((column) => column.id));

function canViewAllLogs(account: TuziAccount | null): boolean {
  return (account?.role || 0) >= 5;
}

function availableLogColumns(account: TuziAccount | null): TuziLogColumn[] {
  return canViewAllLogs(account)
    ? LOG_COLUMNS
    : LOG_COLUMNS.filter((column) => !ADMIN_LOG_COLUMN_IDS.has(column.id));
}

const DEFAULT_DISPLAY_CONFIG: TuziDisplayConfig = {
  quotaPerUnit: 1,
  quotaDisplayType: 'USD',
  usdExchangeRate: 1,
  customCurrencySymbol: '¤',
  customCurrencyExchangeRate: 1,
};

function formatInteger(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatQuota(value: number, config: TuziDisplayConfig): string {
  if (config.quotaDisplayType === 'TOKENS') {
    return formatInteger(value);
  }

  const usd = value / config.quotaPerUnit;
  const symbol =
    config.quotaDisplayType === 'CNY'
      ? '¥'
      : config.quotaDisplayType === 'CUSTOM'
      ? config.customCurrencySymbol
      : '$';
  const rate =
    config.quotaDisplayType === 'CNY'
      ? config.usdExchangeRate
      : config.quotaDisplayType === 'CUSTOM'
      ? config.customCurrencyExchangeRate
      : 1;
  return `${symbol}${(usd * rate).toFixed(2)}`;
}

function formatLogTime(timestamp: number): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function formatOutputTokens(log: TuziUsageLog): string {
  return formatInteger(log.completionTokens || 0);
}

function formatLogType(log: TuziUsageLog): string {
  if (log.type === 2) return '消费';
  if (log.type === 1) return '充值';
  if (log.type === 3) return '管理';
  return log.type ? String(log.type) : '-';
}

function formatUseTime(log: TuziUsageLog): string {
  return log.useTime ? `${log.useTime} ms` : '-';
}

function logChannelLabel(log: TuziUsageLog): string {
  return log.channelName || log.channelId || log.tokenName || '-';
}

function logTokenLabel(log: TuziUsageLog): string {
  return log.tokenName || '-';
}

function logGroupLabel(log: TuziUsageLog): string {
  const tokenName = log.tokenName.trim();
  const managedPrefix = 'OpenTu Managed / ';
  if (tokenName.startsWith(managedPrefix)) {
    return tokenName.slice(managedPrefix.length) || '-';
  }
  return '-';
}

function logUserLabel(log: TuziUsageLog, account: TuziAccount | null): string {
  return (
    log.username ||
    log.userId ||
    account?.displayName ||
    account?.username ||
    '-'
  );
}

interface LogDetailItem {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

const LOG_OTHER_LABELS: Record<string, string> = {
  billing_detail: '计费过程',
  task_id: '任务 ID',
  request_host: '请求域名',
  request_path: '请求路径',
  request_image_urls: '请求图片 URL',
  generated_image_url: '生成图片 URL',
  generated_image_urls: '生成图片 URL',
  generated_video_url: '生成视频 URL',
  generated_video_urls: '生成视频 URL',
  reasoning_effort: 'Reasoning Effort',
  upstream_model_name: '实际模型',
  cache_tokens: '缓存 Tokens',
  cache_creation_tokens: '缓存创建 Tokens',
  audio_input: '语音输入',
  audio_output: '语音输出',
  text_input: '文字输入',
  text_output: '文字输出',
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function CollapsibleDetailValue({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = JSON.stringify(value, null, 2);

  return (
    <div className="tuzi-account-panel__log-detail-collapsible">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronDown size={14} aria-hidden="true" />
        <span>{expanded ? '收起内容' : '展开内容'}</span>
      </button>
      {expanded ? <pre>{formatted}</pre> : null}
    </div>
  );
}

function detailValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') {
    return isHttpUrl(value) ? (
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    ) : (
      value
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item === 'object' && item !== null)) {
      return <CollapsibleDetailValue value={value} />;
    }
    return (
      <div className="tuzi-account-panel__log-detail-values">
        {value.map((item, index) => (
          <span key={`${String(item)}-${index}`}>{detailValue(item)}</span>
        ))}
      </div>
    );
  }
  return <CollapsibleDetailValue value={value} />;
}

function buildLogDetailItems(log: TuziUsageLog): LogDetailItem[] {
  const items: LogDetailItem[] = [];
  const consumedOtherKeys = new Set<string>();
  const add = (label: string, value: unknown, wide = false) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    items.push({ label, value: detailValue(value), wide });
  };

  add('Request ID', log.requestId);
  if (log.requestId) {
    const recoveryPath = `/log/get-request?id=${encodeURIComponent(
      log.requestId
    )}`;
    add(
      '找回接口',
      tuziEmbeddedConfig.apiBaseUrl
        ? `${tuziEmbeddedConfig.apiBaseUrl}${recoveryPath}`
        : recoveryPath,
      true
    );
  }
  add('Response ID', log.responseId);
  add('上游 Request ID', log.upstreamRequestId);

  for (const [key, label] of Object.entries(LOG_OTHER_LABELS)) {
    if (!(key in log.other)) continue;
    consumedOtherKeys.add(key);
    add(label, log.other[key], true);
  }

  add('日志详情', log.other.log_detail, true);
  if ('log_detail' in log.other) consumedOtherKeys.add('log_detail');
  add('其他详情', log.content, true);
  add('Prompt Tokens', formatInteger(log.promptTokens || 0));
  add('Completion Tokens', formatInteger(log.completionTokens || 0));
  add('耗时', log.useTime ? `${log.useTime} ms` : '-');

  const remainingOther = Object.fromEntries(
    Object.entries(log.other).filter(([key]) => !consumedOtherKeys.has(key))
  );
  if (Object.keys(remainingOther).length > 0) {
    add(
      'log_detail' in log.other ? '其他数据' : '日志详情',
      remainingOther,
      true
    );
  }
  return items;
}

function readVisibleLogColumns(): TuziLogColumnId[] {
  if (typeof window === 'undefined') {
    return DEFAULT_LOG_COLUMN_IDS;
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(LOG_COLUMN_STORAGE_KEY) || 'null'
    );
    if (!Array.isArray(parsed)) {
      return DEFAULT_LOG_COLUMN_IDS;
    }

    const nextColumns = parsed.filter((item): item is TuziLogColumnId =>
      LOG_COLUMN_ID_SET.has(item as TuziLogColumnId)
    );
    return nextColumns.length ? nextColumns : DEFAULT_LOG_COLUMN_IDS;
  } catch {
    return DEFAULT_LOG_COLUMN_IDS;
  }
}

function writeVisibleLogColumns(columnIds: TuziLogColumnId[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      LOG_COLUMN_STORAGE_KEY,
      JSON.stringify(columnIds)
    );
  } catch {
    // localStorage is optional for embedded environments.
  }
}

function errorState(error: unknown): { code: string; message: string } {
  if (error instanceof TuziSessionApiError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'REQUEST_FAILED',
    message: error instanceof Error ? error.message : '加载账户数据失败',
  };
}

function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(key) || 'null');
    return cached && Date.now() - Number(cached.timestamp) < CACHE_TTL_MS
      ? (cached.value as T)
      : null;
  } catch {
    return null;
  }
}

function readStoredCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(key) || 'null');
    return cached?.value ? (cached.value as T) : null;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ timestamp: Date.now(), value })
    );
  } catch {
    // localStorage is optional in embedded environments.
  }
}

function clearTuziDataCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACCOUNT_CACHE_KEY);
    for (let page = 1; page <= 100; page += 1) {
      window.localStorage.removeItem(`${LOG_CACHE_KEY}.${page}`);
    }
  } catch {
    // localStorage is optional in embedded environments.
  }
}

function localManagedProviders(): TuziManagedProvider[] {
  return providerProfilesSettings
    .get()
    .filter(
      (profile: ProviderProfile) =>
        profile.id.startsWith('tuzi-managed-') &&
        Boolean(profile.apiKey?.trim())
    )
    .map((profile: ProviderProfile) => ({
      id: profile.id,
      group: profile.pricingGroup || profile.name,
      displayName: profile.name,
      apiKey: profile.apiKey,
      status: profile.enabled === false ? 0 : 1,
      rotatedAt: 0,
    }));
}

interface TuziAccountPanelProps {
  onProvidersChanged?: () => void;
}

export function TuziAccountPanel({
  onProvidersChanged,
}: TuziAccountPanelProps) {
  const accountRequestVersion = useRef(0);
  const logsRequestVersion = useRef(0);
  const refreshProvidersOnNextLoad = useRef(false);
  const onProvidersChangedRef = useRef(onProvidersChanged);
  const [systemToken, setSystemToken] = useState(getTuziSystemToken);
  const [systemUserId, setSystemUserId] = useState(getTuziSystemUserId);
  const [tokenDraft, setTokenDraft] = useState('');
  const createClient = useCallback(
    (token = systemToken, userId = getTuziSystemUserId()) =>
      new TuziSessionApiClient(undefined, fetch, token, userId),
    [systemToken]
  );
  const [activeView, setActiveView] = useState<TuziAccountView>('balance');
  const [account, setAccount] = useState<TuziAccount | null>(null);
  const [providers, setProviders] = useState<TuziManagedProvider[]>(
    localManagedProviders
  );
  const [displayConfig, setDisplayConfig] = useState<TuziDisplayConfig>(
    DEFAULT_DISPLAY_CONFIG
  );
  const [displayConfigReady, setDisplayConfigReady] = useState(false);
  const [logs, setLogs] = useState<TuziLogPage>(EMPTY_LOG_PAGE);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [visibleLogColumnIds, setVisibleLogColumnIds] = useState<
    TuziLogColumnId[]
  >(readVisibleLogColumns);
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [rotatingGroup, setRotatingGroup] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null
  );

  useEffect(() => {
    onProvidersChangedRef.current = onProvidersChanged;
  }, [onProvidersChanged]);

  useEffect(() => {
    initializeTuziSystemTokenFromUrl();
  }, []);

  const saveToken = useCallback(async () => {
    const nextToken = tokenDraft.trim();
    if (!nextToken) {
      setError({ code: 'NOT_CONFIGURED', message: '请输入系统访问令牌' });
      return;
    }
    if (!saveTuziSystemToken(nextToken)) {
      setError({ code: 'REQUEST_FAILED', message: '系统访问令牌保存失败' });
      return;
    }
    saveTuziSystemUserId(systemUserId);
    accountRequestVersion.current += 1;
    logsRequestVersion.current += 1;
    refreshProvidersOnNextLoad.current = true;
    setSystemToken(nextToken);
    resetTuziSessionProviderSyncCache();
    setTokenDraft('');
    clearTuziDataCache();
    setAccount(null);
    setProviders([]);
    setDisplayConfigReady(false);
    setLogs(EMPTY_LOG_PAGE);
    setLoading(true);
    setError(null);
  }, [systemUserId, tokenDraft]);

  const clearToken = useCallback(async () => {
    accountRequestVersion.current += 1;
    logsRequestVersion.current += 1;
    clearTuziSystemToken();
    clearTuziSystemUserId();
    resetTuziSessionProviderSyncCache();
    clearTuziDataCache();
    setSystemToken('');
    setSystemUserId('');
    setTokenDraft('');
    setAccount(null);
    setProviders([]);
    setDisplayConfigReady(false);
    setLogs(EMPTY_LOG_PAGE);
    setError(null);

    try {
      await synchronizeTuziManagedProviders([]);
      onProvidersChangedRef.current?.();
    } catch (syncError) {
      console.warn(
        '[Tuzi] Failed to clear local managed providers:',
        syncError
      );
    }
  }, []);

  const loadLogsPage = useCallback(
    async (page: number) => {
      const requestVersion = ++logsRequestVersion.current;
      setLogsLoading(true);
      setError(null);
      try {
        const nextLogs = await createClient().getLogs(
          Math.max(1, page),
          LOG_PAGE_SIZE,
          canViewAllLogs(account)
        );
        if (requestVersion !== logsRequestVersion.current) return;
        setLogs(nextLogs);
        setExpandedLogId(null);
        writeCache(`${LOG_CACHE_KEY}.${Math.max(1, page)}`, nextLogs);
      } catch (loadError) {
        if (requestVersion !== logsRequestVersion.current) return;
        setError(errorState(loadError));
      } finally {
        if (requestVersion === logsRequestVersion.current) {
          setLogsLoading(false);
        }
      }
    },
    [account, createClient]
  );

  const load = useCallback(
    async (refreshProviders = false) => {
      const requestVersion = ++accountRequestVersion.current;
      const requestToken = systemToken;
      const isCurrentRequest = () =>
        requestVersion === accountRequestVersion.current &&
        getTuziSystemToken() === requestToken;
      setLoading(true);
      setError(null);
      setDisplayConfigReady(false);
      let hasCachedAccount = false;
      try {
        const cached = readStoredCache<{
          account: TuziAccount;
          displayConfig: TuziDisplayConfig;
        }>(ACCOUNT_CACHE_KEY);
        if (cached) {
          hasCachedAccount = true;
          setAccount(cached.account);
          setDisplayConfig(cached.displayConfig);
          setDisplayConfigReady(true);
          setProviders(localManagedProviders());
          setLoading(false);
        }
        const client = createClient();
        const [accountResult, displayConfigResult] = await Promise.allSettled([
          client.getAccount(),
          client.getDisplayConfig(),
        ]);
        if (!isCurrentRequest()) return;
        if (accountResult.status === 'rejected') {
          throw accountResult.reason;
        }
        const nextAccount = accountResult.value;
        const nextDisplayConfig =
          displayConfigResult.status === 'fulfilled'
            ? displayConfigResult.value
            : DEFAULT_DISPLAY_CONFIG;
        if (saveTuziSystemUserId(nextAccount.id)) {
          setSystemUserId(String(nextAccount.id));
        }
        let nextProviders = localManagedProviders();
        if (refreshProviders) {
          nextProviders = await createClient(
            requestToken,
            String(nextAccount.id)
          ).ensureManagedProviders();
          if (!isCurrentRequest()) return;
          await synchronizeTuziManagedProviders(nextProviders);
          if (!isCurrentRequest()) return;
          onProvidersChangedRef.current?.();
        }
        setAccount(nextAccount);
        setDisplayConfig(nextDisplayConfig);
        setDisplayConfigReady(true);
        setProviders(nextProviders);
        writeCache(ACCOUNT_CACHE_KEY, {
          account: nextAccount,
          displayConfig: nextDisplayConfig,
        });
      } catch (loadError) {
        if (!isCurrentRequest()) return;
        if (!hasCachedAccount) {
          setAccount(null);
          setProviders([]);
        }
        setError(errorState(loadError));
      } finally {
        if (isCurrentRequest()) {
          setLoading(false);
        }
      }
    },
    [createClient, systemToken]
  );

  const rotateProvider = useCallback(
    async (group: string) => {
      setRotatingGroup(group);
      setError(null);
      try {
        const replacement = await createClient().rotateManagedProvider(group);
        const nextProviders = providers.map((provider) =>
          provider.group === group ? replacement : provider
        );
        setProviders(nextProviders);
        try {
          await synchronizeTuziManagedProviders(nextProviders);
          onProvidersChangedRef.current?.();
        } catch (syncError) {
          console.warn('[Tuzi] Failed to persist rotated provider:', syncError);
        }
        try {
          await discoverAndUseAllTuziProviderModels(replacement);
        } catch (modelError) {
          console.warn(
            '[Tuzi] Failed to discover rotated provider models:',
            modelError
          );
        }
      } catch (rotateError) {
        setError(errorState(rotateError));
      } finally {
        setRotatingGroup(null);
      }
    },
    [createClient, providers]
  );

  useEffect(() => {
    if (systemToken) {
      const refreshProviders = refreshProvidersOnNextLoad.current;
      refreshProvidersOnNextLoad.current = false;
      void load(refreshProviders);
    } else {
      setLoading(false);
      setAccount(null);
      setProviders([]);
      setLogs(EMPTY_LOG_PAGE);
      setDisplayConfigReady(false);
    }
  }, [load, systemToken]);

  useEffect(() => {
    if (
      activeView !== 'logs' ||
      !systemToken ||
      !account ||
      loading ||
      logs.items.length > 0
    ) {
      return;
    }
    const cached = readCache<TuziLogPage>(`${LOG_CACHE_KEY}.1`);
    if (cached) {
      setLogs(cached);
      return;
    }
    void loadLogsPage(1);
  }, [
    account,
    activeView,
    loadLogsPage,
    loading,
    logs.items.length,
    systemToken,
  ]);

  const currentLogPage = Math.max(1, logs.page || 1);
  const logPageSize = Math.max(1, logs.pageSize || LOG_PAGE_SIZE);
  const totalLogCount = Math.max(
    logs.total,
    (currentLogPage - 1) * logPageSize + logs.items.length
  );
  const totalLogPages = Math.max(1, Math.ceil(totalLogCount / logPageSize));
  const logRangeStart = totalLogCount
    ? (currentLogPage - 1) * logPageSize + 1
    : 0;
  const logRangeEnd = totalLogCount
    ? Math.min(logRangeStart + logs.items.length - 1, totalLogCount)
    : 0;
  const selectableLogColumns = useMemo(
    () => availableLogColumns(account),
    [account]
  );
  const visibleLogColumns = useMemo(
    () =>
      selectableLogColumns.filter((column) =>
        visibleLogColumnIds.includes(column.id)
      ),
    [selectableLogColumns, visibleLogColumnIds]
  );
  const logGridStyle = useMemo(
    () =>
      ({
        '--tuzi-log-columns': visibleLogColumns
          .map((column) => column.width)
          .join(' '),
      } as CSSProperties),
    [visibleLogColumns]
  );
  const toggleLogColumn = useCallback(
    (columnId: TuziLogColumnId) => {
      setVisibleLogColumnIds((current) => {
        const availableIds = new Set(
          selectableLogColumns.map((column) => column.id)
        );
        const availableCurrent = current.filter((item) =>
          availableIds.has(item)
        );
        const exists = availableCurrent.includes(columnId);
        const nextColumns = exists
          ? availableCurrent.filter((item) => item !== columnId)
          : selectableLogColumns
              .filter(
                (column) =>
                  column.id === columnId || availableCurrent.includes(column.id)
              )
              .map((column) => column.id);

        if (nextColumns.length === 0) {
          return current;
        }

        writeVisibleLogColumns(nextColumns);
        return nextColumns;
      });
    },
    [selectableLogColumns]
  );
  const resetLogColumns = useCallback(() => {
    const nextColumns = DEFAULT_LOG_COLUMN_IDS.filter((columnId) =>
      selectableLogColumns.some((column) => column.id === columnId)
    );
    writeVisibleLogColumns(nextColumns);
    setVisibleLogColumnIds(nextColumns);
  }, [selectableLogColumns]);
  const tokenInvalid = error?.code === 'TOKEN_INVALID';
  const loginStatusText = tokenInvalid
    ? '令牌无效'
    : error?.code === 'ACCOUNT_DISABLED'
    ? '账户不可用'
    : !systemToken
    ? '未配置令牌'
    : error
    ? '状态异常'
    : '令牌已连接';
  const syncStatusText = !systemToken
    ? '等待令牌'
    : loading
    ? '同步中'
    : error
    ? '同步失败'
    : '已同步';
  return (
    <div className="tuzi-account-panel">
      <div className="tuzi-account-panel__body">
        <aside className="tuzi-account-panel__sidebar">
          <nav className="tuzi-account-panel__nav" aria-label="Tuzi 账户视图">
            <button
              type="button"
              className={activeView === 'balance' ? 'is-active' : undefined}
              aria-pressed={activeView === 'balance'}
              onClick={() => setActiveView('balance')}
            >
              账户余额
            </button>
            <button
              type="button"
              className={activeView === 'logs' ? 'is-active' : undefined}
              aria-pressed={activeView === 'logs'}
              onClick={() => {
                setActiveView('logs');
                setExpandedLogId(null);
              }}
            >
              日志
            </button>
          </nav>
        </aside>

        <main className="tuzi-account-panel__main">
          <header className="tuzi-account-panel__account">
            <div>
              <h2>Tuzi 账户</h2>
              <p>{account?.displayName || account?.username || '当前账户'}</p>
            </div>
            <div
              className="tuzi-account-panel__status-list"
              aria-label="账户状态"
            >
              <span
                className={
                  error
                    ? 'tuzi-account-panel__status tuzi-account-panel__status--danger'
                    : 'tuzi-account-panel__status tuzi-account-panel__status--ok'
                }
              >
                {loginStatusText}
              </span>
              <span
                className={
                  loading
                    ? 'tuzi-account-panel__status tuzi-account-panel__status--pending'
                    : error
                    ? 'tuzi-account-panel__status tuzi-account-panel__status--danger'
                    : 'tuzi-account-panel__status'
                }
              >
                {syncStatusText}
              </span>
            </div>
          </header>

          <div className="tuzi-account-panel__content">
            <section
              className="tuzi-account-panel__token"
              aria-labelledby="tuzi-system-token-title"
            >
              <div className="tuzi-account-panel__token-heading">
                <div>
                  <h3 id="tuzi-system-token-title">
                    <KeyRound size={16} aria-hidden="true" />
                    系统访问令牌
                  </h3>
                  <p>
                    使用系统令牌读取账户数据并同步托管 Provider。
                    <a
                      href="https://api.tu-zi.com/console/personal"
                      target="_blank"
                      rel="noreferrer"
                      className="tuzi-account-panel__token-link"
                    >
                      前往个人设置复制令牌
                    </a>
                  </p>
                </div>
              </div>
              <div className="tuzi-account-panel__token-actions">
                <input
                  id="tuzi-system-user-id"
                  type="text"
                  inputMode="numeric"
                  value={systemUserId}
                  onChange={(event) =>
                    setSystemUserId(event.target.value.replace(/\D/g, ''))
                  }
                  onBlur={() => saveTuziSystemUserId(systemUserId)}
                  placeholder="用户 ID"
                  aria-label="Tuzi 用户 ID"
                  autoComplete="off"
                />
                <input
                  id="tuzi-system-token"
                  type="password"
                  value={tokenDraft}
                  onChange={(event) => setTokenDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveToken();
                  }}
                  placeholder={
                    systemToken
                      ? maskTuziSystemToken(systemToken)
                      : '粘贴系统访问令牌'
                  }
                  aria-label="系统访问令牌"
                  autoComplete="off"
                />
                <button type="button" onClick={() => void saveToken()}>
                  {systemToken ? '替换令牌' : '连接'}
                </button>
                {systemToken ? (
                  <button
                    type="button"
                    className="is-subtle"
                    onClick={() => void clearToken()}
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </section>
            {error ? (
              <div className="tuzi-account-panel__error" role="alert">
                <AlertCircle size={20} />
                <div>
                  <strong>
                    {error.code === 'TOKEN_INVALID'
                      ? '系统访问令牌无效'
                      : error.code === 'ACCOUNT_DISABLED'
                      ? '账户不可用'
                      : '数据加载失败'}
                  </strong>
                  <span>
                    {tokenInvalid ? '请替换令牌后重试' : error.message}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={loading || !systemToken}
                  onClick={() => void load(true)}
                >
                  重试
                </button>
              </div>
            ) : null}

            {!systemToken || (!loading && (!account || error)) ? (
              <div className="tuzi-account-panel__not-configured">
                <KeyRound size={24} aria-hidden="true" />
                <strong>
                  {!systemToken ? '尚未配置系统访问令牌' : '尚未连接 Tuzi 账户'}
                </strong>
                <span>
                  {!systemToken
                    ? '填写令牌后才能读取账户余额、用量和日志。'
                    : '连接成功后才会显示账户余额和用量。'}
                </span>
              </div>
            ) : loading && !account ? (
              <div className="tuzi-account-panel__loading">
                <Loader2 size={22} className="is-spinning" />
                <span>正在读取账户数据</span>
              </div>
            ) : activeView === 'balance' ? (
              <>
                <section
                  className="tuzi-account-panel__metrics"
                  aria-label="账户余额"
                >
                  <div>
                    <span>可用额度</span>
                    <strong>
                      {displayConfigReady
                        ? formatQuota(account?.quota || 0, displayConfig)
                        : '加载中'}
                    </strong>
                  </div>
                  <div>
                    <span>累计用量</span>
                    <strong>
                      {displayConfigReady
                        ? formatQuota(account?.usedQuota || 0, displayConfig)
                        : '加载中'}
                    </strong>
                  </div>
                  <div>
                    <span>请求次数</span>
                    <strong>{formatInteger(account?.requestCount || 0)}</strong>
                  </div>
                </section>

                <section className="tuzi-account-panel__section">
                  <div className="tuzi-account-panel__section-heading">
                    <h3>分组 Key</h3>
                    <span>{providers.length}</span>
                  </div>
                  {providers.length ? (
                    <div className="tuzi-account-panel__providers">
                      {providers.map((provider) => (
                        <div key={provider.id}>
                          <div>
                            <strong>
                              {provider.displayName || provider.group}
                            </strong>
                            <span>{provider.group}</span>
                          </div>
                          <HoverTip
                            content={`换新 ${provider.group} 分组 Key`}
                            showArrow={false}
                          >
                            <button
                              type="button"
                              aria-label={`换新 ${provider.group} 分组 Key`}
                              disabled={rotatingGroup !== null}
                              onClick={() =>
                                void rotateProvider(provider.group)
                              }
                            >
                              {rotatingGroup === provider.group ? (
                                <Loader2 size={16} className="is-spinning" />
                              ) : (
                                <KeyRound size={16} />
                              )}
                              <span>换新 Key</span>
                            </button>
                          </HoverTip>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="tuzi-account-panel__empty">
                      暂无授权分组
                    </div>
                  )}
                </section>
              </>
            ) : (
              <section className="tuzi-account-panel__section tuzi-account-panel__section--logs">
                <div className="tuzi-account-panel__section-heading">
                  <h3>最近调用</h3>
                  <div className="tuzi-account-panel__section-actions">
                    <span>
                      {totalLogCount
                        ? `${formatInteger(logRangeStart)}-${formatInteger(
                            logRangeEnd
                          )} / ${formatInteger(totalLogCount)}`
                        : '0 / 0'}
                    </span>
                    <div
                      className="tuzi-account-panel__pagination"
                      aria-label="日志分页"
                    >
                      <button
                        type="button"
                        aria-label="上一页"
                        disabled={logsLoading || currentLogPage <= 1}
                        onClick={() => void loadLogsPage(currentLogPage - 1)}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span>
                        {formatInteger(currentLogPage)} /{' '}
                        {formatInteger(totalLogPages)}
                      </span>
                      <button
                        type="button"
                        aria-label="下一页"
                        disabled={
                          logsLoading || currentLogPage >= totalLogPages
                        }
                        onClick={() => void loadLogsPage(currentLogPage + 1)}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                    <div className="tuzi-account-panel__column-settings">
                      <button
                        type="button"
                        className="tuzi-account-panel__column-settings-trigger"
                        aria-expanded={columnSettingsOpen}
                        onClick={() => setColumnSettingsOpen((open) => !open)}
                      >
                        <Settings2 size={15} />
                        <span>列设置</span>
                      </button>
                      {columnSettingsOpen ? (
                        <div
                          className="tuzi-account-panel__column-settings-menu"
                          role="menu"
                        >
                          <div className="tuzi-account-panel__column-settings-title">
                            选择展示字段
                          </div>
                          <div className="tuzi-account-panel__column-settings-options">
                            {selectableLogColumns.map((column) => {
                              const checked = visibleLogColumnIds.includes(
                                column.id
                              );
                              const visibleColumnCount =
                                visibleLogColumns.length;
                              return (
                                <label key={column.id}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={
                                      checked && visibleColumnCount === 1
                                    }
                                    onChange={() => toggleLogColumn(column.id)}
                                  />
                                  <span>{column.label}</span>
                                </label>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            className="tuzi-account-panel__column-settings-reset"
                            onClick={resetLogColumns}
                          >
                            恢复默认
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                {logs.items.length ? (
                  <div className="tuzi-account-panel__log-table">
                    <div
                      className="tuzi-account-panel__log-head"
                      role="row"
                      style={logGridStyle}
                    >
                      {visibleLogColumns.map((column) => (
                        <span
                          key={column.id}
                          className={
                            column.align === 'right'
                              ? 'tuzi-account-panel__log-cell--right'
                              : undefined
                          }
                        >
                          {column.label}
                        </span>
                      ))}
                    </div>
                    <div className="tuzi-account-panel__log-list">
                      {logs.items.map((log) => (
                        <div
                          className="tuzi-account-panel__log-entry"
                          key={log.id}
                        >
                          <button
                            type="button"
                            className="tuzi-account-panel__log-row"
                            aria-expanded={expandedLogId === log.id}
                            style={logGridStyle}
                            onClick={() =>
                              setExpandedLogId((current) =>
                                current === log.id ? null : log.id
                              )
                            }
                          >
                            {visibleLogColumns.map((column) => {
                              if (column.id === 'time') {
                                return (
                                  <time key={column.id}>
                                    {formatLogTime(log.createdAt)}
                                  </time>
                                );
                              }
                              if (column.id === 'model') {
                                return (
                                  <strong key={column.id}>
                                    {log.modelName || '系统记录'}
                                  </strong>
                                );
                              }
                              if (column.id === 'details') {
                                return (
                                  <span
                                    key={column.id}
                                    className="tuzi-account-panel__log-detail-preview"
                                  >
                                    {expandedLogId === log.id
                                      ? '收起详情'
                                      : '查看详情'}
                                  </span>
                                );
                              }
                              if (column.id === 'amount') {
                                return (
                                  <span
                                    key={column.id}
                                    className="tuzi-account-panel__log-quota"
                                  >
                                    {displayConfigReady
                                      ? formatQuota(log.quota, displayConfig)
                                      : '加载中'}
                                  </span>
                                );
                              }

                              const value =
                                column.id === 'channel'
                                  ? logChannelLabel(log)
                                  : column.id === 'user'
                                  ? logUserLabel(log, account)
                                  : column.id === 'token'
                                  ? logTokenLabel(log)
                                  : column.id === 'group'
                                  ? logGroupLabel(log)
                                  : column.id === 'type'
                                  ? formatLogType(log)
                                  : column.id === 'callStatus'
                                  ? log.callStatus || '-'
                                  : column.id === 'useTime'
                                  ? formatUseTime(log)
                                  : column.id === 'input'
                                  ? formatInteger(log.promptTokens || 0)
                                  : column.id === 'output'
                                  ? formatOutputTokens(log)
                                  : column.id === 'ip'
                                  ? log.ip || '-'
                                  : column.id === 'retry'
                                  ? formatInteger(log.retryCount || 0)
                                  : column.id === 'requestId'
                                  ? log.requestId || '-'
                                  : column.id === 'upstreamRequestId'
                                  ? log.upstreamRequestId || '-'
                                  : '-';

                              return (
                                <span
                                  key={column.id}
                                  className={
                                    column.align === 'right'
                                      ? 'tuzi-account-panel__log-cell--right'
                                      : undefined
                                  }
                                >
                                  {value}
                                </span>
                              );
                            })}
                          </button>
                          {expandedLogId === log.id ? (
                            <div className="tuzi-account-panel__log-detail">
                              <dl>
                                {buildLogDetailItems(log).map((item, index) => (
                                  <div
                                    key={`${item.label}-${index}`}
                                    className={
                                      item.wide ? 'is-wide' : undefined
                                    }
                                  >
                                    <dt>{item.label}</dt>
                                    <dd>{item.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="tuzi-account-panel__empty">暂无调用记录</div>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
