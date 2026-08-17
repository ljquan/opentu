import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  getOpenTuApiClient,
  OpenTuApiResponseError,
  type OpenTuAccount,
  type OpenTuDevice,
  type OpenTuDeviceRevokeResult,
  type OpenTuManagedProviderGroup,
  type OpenTuTopupCreateResult,
  type OpenTuTopupInfo,
  type OpenTuTopupOrderInput,
  type OpenTuTopupQuery,
  type OpenTuTopupQueryInput,
  type OpenTuTopupQueryResult,
  type OpenTuTopupQuote,
  type OpenTuTopupsPage,
  type OpenTuUsagePage,
  type OpenTuUsageQuery,
} from '../services/opentu-api-client';
import {
  reconcileManagedProviderGroups,
  updateManagedProviderGroup,
} from '../services/opentu-managed-provider-profiles';
import {
  getOpenTuAccountRuntimeSession,
  subscribeOpenTuAccountRuntimeSession,
  type OpenTuAccountRuntimeSession,
} from '../services/opentu-account-runtime';

export type OpenTuAccountWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'expired'
  | 'revoked'
  | 'insufficient'
  | 'unavailable'
  | 'error';

export interface OpenTuAccountWorkspaceError {
  kind: Exclude<
    OpenTuAccountWorkspaceStatus,
    'loading' | 'ready' | 'unavailable'
  >;
  message: string;
  status?: number;
  code?: string;
}

export interface OpenTuAccountWorkspaceClient {
  getAccount(): Promise<OpenTuAccount>;
  getUsage(query?: OpenTuUsageQuery): Promise<OpenTuUsagePage>;
  getTopups(query?: OpenTuTopupQuery): Promise<OpenTuTopupsPage>;
  getTopupInfo(): Promise<OpenTuTopupInfo>;
  estimateTopup(input: OpenTuTopupOrderInput): Promise<OpenTuTopupQuote>;
  createTopup(
    input: OpenTuTopupOrderInput,
    idempotencyKey: string
  ): Promise<OpenTuTopupCreateResult>;
  queryTopup(input: OpenTuTopupQueryInput): Promise<OpenTuTopupQueryResult>;
  getDevices(): Promise<OpenTuDevice[]>;
  revokeDevice(deviceId: number | string): Promise<OpenTuDeviceRevokeResult>;
  ensureManagedProviderGroups(
    idempotencyKey: string
  ): Promise<OpenTuManagedProviderGroup[]>;
  rotateManagedProviderGroup(
    group: string,
    idempotencyKey: string
  ): Promise<OpenTuManagedProviderGroup>;
}

export type OpenTuManagedGroupsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface OpenTuAccountWorkspaceValue {
  mode: OpenTuAccountRuntimeSession['mode'];
  status: OpenTuAccountWorkspaceStatus;
  account: OpenTuAccount | null;
  error: OpenTuAccountWorkspaceError | null;
  lastUpdatedAt: number | null;
  managedGroups: OpenTuManagedProviderGroup[];
  managedGroupsStatus: OpenTuManagedGroupsStatus;
  managedGroupsError: string | null;
  refresh(): Promise<void>;
  loadUsage(query?: OpenTuUsageQuery): Promise<OpenTuUsagePage>;
  loadTopups(query?: OpenTuTopupQuery): Promise<OpenTuTopupsPage>;
  getTopupInfo(): Promise<OpenTuTopupInfo>;
  estimateTopup(input: OpenTuTopupOrderInput): Promise<OpenTuTopupQuote>;
  createTopup(
    input: OpenTuTopupOrderInput,
    idempotencyKey: string
  ): Promise<OpenTuTopupCreateResult>;
  queryTopup(input: OpenTuTopupQueryInput): Promise<OpenTuTopupQueryResult>;
  loadDevices(): Promise<OpenTuDevice[]>;
  revokeDevice(deviceId: number | string): Promise<OpenTuDeviceRevokeResult>;
  rotateManagedGroup(group: string): Promise<OpenTuManagedProviderGroup>;
}

export interface OpenTuAccountProviderProps {
  children: ReactNode;
  /** Test seam; normal application code uses the configured singleton client. */
  client?: OpenTuAccountWorkspaceClient | null;
}

const OpenTuAccountContext = createContext<OpenTuAccountWorkspaceValue | null>(
  null
);

function normalizedErrorText(error: OpenTuApiResponseError): string {
  return `${error.errorCode} ${error.errorDescription} ${error.message}`.toLowerCase();
}

export function classifyOpenTuAccountError(
  error: unknown
): OpenTuAccountWorkspaceError {
  if (error instanceof OpenTuApiResponseError) {
    const text = normalizedErrorText(error);
    if (
      /insufficient[_ -]?(quota|balance|credit)|quota[_ -]?exhausted/.test(
        text
      ) ||
      error.status === 402
    ) {
      return {
        kind: 'insufficient',
        message: error.errorDescription || 'OpenTu quota is insufficient',
        status: error.status,
        code: error.errorCode,
      };
    }
    if (/revoked|credential[_ -]?disabled|device[_ -]?disabled/.test(text)) {
      return {
        kind: 'revoked',
        message: error.errorDescription || 'OpenTu device access was revoked',
        status: error.status,
        code: error.errorCode,
      };
    }
    if (
      error.status === 401 ||
      /invalid_token|token[_ -]?expired|session[_ -]?expired/.test(text)
    ) {
      return {
        kind: 'expired',
        message: error.errorDescription || 'OpenTu session expired',
        status: error.status,
        code: error.errorCode,
      };
    }
    return {
      kind: 'error',
      message: error.errorDescription || error.message,
      status: error.status,
      code: error.errorCode,
    };
  }

  return {
    kind: 'error',
    message:
      error instanceof Error ? error.message : 'OpenTu account request failed',
  };
}

function unavailableAction(): never {
  throw new Error('OpenTu account workspace is unavailable in standalone mode');
}

function getEmbeddedCredentialId(
  session: OpenTuAccountRuntimeSession
): string | null {
  return session.mode === 'embedded' ? session.credentialId : null;
}

function newManagedKeyIdempotencyKey(action: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `opentu-managed-${action}-${crypto.randomUUID()}`;
  }
  return `opentu-managed-${action}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function OpenTuAccountProvider({
  children,
  client: suppliedClient,
}: OpenTuAccountProviderProps) {
  const runtimeSession = useSyncExternalStore(
    subscribeOpenTuAccountRuntimeSession,
    getOpenTuAccountRuntimeSession,
    getOpenTuAccountRuntimeSession
  );
  const [status, setStatus] = useState<OpenTuAccountWorkspaceStatus>(
    runtimeSession.mode === 'embedded' ? 'loading' : 'unavailable'
  );
  const [account, setAccount] = useState<OpenTuAccount | null>(null);
  const [error, setError] = useState<OpenTuAccountWorkspaceError | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [managedGroups, setManagedGroups] = useState<
    OpenTuManagedProviderGroup[]
  >([]);
  const [managedGroupsStatus, setManagedGroupsStatus] =
    useState<OpenTuManagedGroupsStatus>('idle');
  const [managedGroupsError, setManagedGroupsError] = useState<string | null>(
    null
  );
  const refreshSequence = useRef(0);
  const managedGroupsSequence = useRef(0);
  const runtimeSessionRef = useRef(runtimeSession);
  runtimeSessionRef.current = runtimeSession;

  const client =
    suppliedClient === undefined
      ? runtimeSession.mode === 'embedded'
        ? getOpenTuApiClient()
        : null
      : suppliedClient;

  const requireClient = useCallback((): OpenTuAccountWorkspaceClient => {
    if (runtimeSession.mode !== 'embedded') unavailableAction();
    if (!client) throw new Error('OpenTu DPoP client is unavailable');
    return client;
  }, [client, runtimeSession.mode]);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++refreshSequence.current;
    if (runtimeSession.mode !== 'embedded') {
      setStatus('unavailable');
      setAccount(null);
      setError(null);
      setLastUpdatedAt(null);
      return;
    }

    setStatus('loading');
    setError(null);
    try {
      const activeClient = requireClient();
      const nextAccount = await activeClient.getAccount();
      if (
        nextAccount.id !== runtimeSession.userId ||
        nextAccount.credential_id !== runtimeSession.credentialId
      ) {
        throw new OpenTuApiResponseError(
          'OpenTu account does not match the embedded session',
          403,
          'credential_revoked'
        );
      }
      if (sequence !== refreshSequence.current) return;
      setAccount(nextAccount);
      setLastUpdatedAt(Date.now());
      setStatus('ready');
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      const classified = classifyOpenTuAccountError(caught);
      setError(classified);
      setStatus(classified.kind);
    }
  }, [requireClient, runtimeSession]);

  useEffect(() => {
    void refresh();
    return () => {
      refreshSequence.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    const sequence = ++managedGroupsSequence.current;
    if (runtimeSession.mode !== 'embedded' || status !== 'ready' || !account) {
      setManagedGroups([]);
      setManagedGroupsStatus('idle');
      setManagedGroupsError(null);
      return;
    }

    const credentialId = runtimeSession.credentialId;
    setManagedGroupsStatus('loading');
    setManagedGroupsError(null);
    void (async () => {
      try {
        const groups = await requireClient().ensureManagedProviderGroups(
          newManagedKeyIdempotencyKey('ensure')
        );
        if (
          sequence !== managedGroupsSequence.current ||
          getEmbeddedCredentialId(runtimeSessionRef.current) !== credentialId
        )
          return;
        await reconcileManagedProviderGroups(groups, credentialId);
        if (
          sequence !== managedGroupsSequence.current ||
          getEmbeddedCredentialId(runtimeSessionRef.current) !== credentialId
        )
          return;
        setManagedGroups(groups);
        setManagedGroupsStatus('ready');
      } catch (caught) {
        if (
          sequence !== managedGroupsSequence.current ||
          getEmbeddedCredentialId(runtimeSessionRef.current) !== credentialId
        )
          return;
        setManagedGroupsStatus('error');
        setManagedGroupsError(
          caught instanceof Error ? caught.message : '访问分组同步失败'
        );
      }
    })();

    return () => {
      managedGroupsSequence.current += 1;
    };
  }, [account, requireClient, runtimeSession, status]);

  const loadUsage = useCallback(
    (query?: OpenTuUsageQuery) => requireClient().getUsage(query),
    [requireClient]
  );
  const loadTopups = useCallback(
    (query?: OpenTuTopupQuery) => requireClient().getTopups(query),
    [requireClient]
  );
  const getTopupInfo = useCallback(
    () => requireClient().getTopupInfo(),
    [requireClient]
  );
  const estimateTopup = useCallback(
    (input: OpenTuTopupOrderInput) => requireClient().estimateTopup(input),
    [requireClient]
  );
  const createTopup = useCallback(
    (input: OpenTuTopupOrderInput, idempotencyKey: string) =>
      requireClient().createTopup(input, idempotencyKey),
    [requireClient]
  );
  const queryTopup = useCallback(
    (input: OpenTuTopupQueryInput) => requireClient().queryTopup(input),
    [requireClient]
  );
  const loadDevices = useCallback(
    () => requireClient().getDevices(),
    [requireClient]
  );
  const revokeDevice = useCallback(
    async (deviceId: number | string) => {
      const result = await requireClient().revokeDevice(deviceId);
      await refresh();
      return result;
    },
    [refresh, requireClient]
  );

  const rotateManagedGroup = useCallback(
    async (group: string) => {
      if (runtimeSession.mode !== 'embedded') unavailableAction();
      const credentialId = runtimeSession.credentialId;
      const result = await requireClient().rotateManagedProviderGroup(
        group,
        newManagedKeyIdempotencyKey(`rotate-${group}`)
      );
      if (
        runtimeSessionRef.current.mode !== 'embedded' ||
        runtimeSessionRef.current.credentialId !== credentialId
      ) {
        throw new Error('OpenTu account changed during key rotation');
      }
      await updateManagedProviderGroup(result, credentialId);
      if (getEmbeddedCredentialId(runtimeSessionRef.current) !== credentialId) {
        throw new Error('OpenTu account changed during key rotation');
      }
      setManagedGroups((current) => {
        const index = current.findIndex((item) => item.group === result.group);
        if (index < 0) return [...current, result];
        const next = [...current];
        next[index] = result;
        return next;
      });
      return result;
    },
    [requireClient, runtimeSession]
  );

  const value = useMemo<OpenTuAccountWorkspaceValue>(
    () => ({
      mode: runtimeSession.mode,
      status,
      account,
      error,
      lastUpdatedAt,
      managedGroups,
      managedGroupsStatus,
      managedGroupsError,
      refresh,
      loadUsage,
      loadTopups,
      getTopupInfo,
      estimateTopup,
      createTopup,
      queryTopup,
      loadDevices,
      revokeDevice,
      rotateManagedGroup,
    }),
    [
      account,
      createTopup,
      error,
      estimateTopup,
      getTopupInfo,
      lastUpdatedAt,
      loadDevices,
      loadTopups,
      loadUsage,
      managedGroups,
      managedGroupsError,
      managedGroupsStatus,
      queryTopup,
      refresh,
      revokeDevice,
      rotateManagedGroup,
      runtimeSession.mode,
      status,
    ]
  );

  return (
    <OpenTuAccountContext.Provider value={value}>
      {children}
    </OpenTuAccountContext.Provider>
  );
}

export function useOpenTuAccountWorkspace(): OpenTuAccountWorkspaceValue {
  const context = useContext(OpenTuAccountContext);
  if (!context) {
    throw new Error(
      'useOpenTuAccountWorkspace must be used within OpenTuAccountProvider'
    );
  }
  return context;
}

export const useOpenTuAccount = useOpenTuAccountWorkspace;
