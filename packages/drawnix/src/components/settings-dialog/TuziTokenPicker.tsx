import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw } from 'lucide-react';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import {
  TuziSessionApiClient,
  type TuziAccountToken,
  type TuziManagedProvider,
  type TuziProviderGroup,
} from '../../services/tuzi-session-api';
import {
  synchronizeTuziManagedProviders,
  addTuziTokenProviders,
} from '../../services/tuzi-managed-providers';
import { discoverAndUseAllTuziProviderModels } from '../../services/tuzi-managed-provider-models';
import { isCurrentTuziEndpoint } from '../../services/tuzi-provider-reuse-state';
import {
  getTuziSystemToken,
  getTuziSystemUserId,
} from '../../services/tuzi-token-auth';
import { providerProfilesSettings } from '../../utils/settings-manager';
import './tuzi-token-picker.scss';

const reasons: Record<string, string> = {
  expired: '已过期',
  disabled: '已停用',
  quota_exhausted: '额度已耗尽',
  count_exhausted: '次数已耗尽',
  group_unavailable: '分组不可用',
  models_unavailable: '无可用模型',
};
function localFingerprints(): Set<string> {
  return new Set(
    providerProfilesSettings
      .get()
      .filter((p) => isCurrentTuziEndpoint(p.baseUrl) && p.apiKey.trim())
      .map((p) => bytesToHex(sha256(p.apiKey.trim().replace(/^sk-/, ''))))
  );
}
function tokenDetail(token: TuziAccountToken): string {
  return [
    token.quota_limited ? '额度限制' : '不限额度',
    token.count_limited && '次数限制',
    token.model_limits_enabled && '模型限制',
    token.ip_restricted && 'IP 限制',
    token.expires_at === -1
      ? '长期有效'
      : token.expires_at
      ? `到期 ${new Date(token.expires_at * 1000).toLocaleDateString()}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function TuziTokenPicker({
  onComplete,
  onCancel,
  initialMode = 'import',
  onUnsupported,
}: {
  onComplete: (providers: TuziManagedProvider[]) => void;
  onCancel: () => void;
  initialMode?: 'import' | 'create';
  onUnsupported?: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [tokens, setTokens] = useState<TuziAccountToken[]>([]);
  const [groups, setGroups] = useState<TuziProviderGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [name, setName] = useState('OpenTu 日常使用');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const managedResponse = useRef<TuziManagedProvider[] | null>(null);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const account = useRef({
    user: getTuziSystemUserId(),
    token: getTuziSystemToken(),
  });
  const completedResponse = useRef<TuziAccountToken[] | null>(null);
  const current = () =>
    mounted.current &&
    account.current.user === getTuziSystemUserId() &&
    account.current.token === getTuziSystemToken();
  const fingerprints = localFingerprints();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const client = new TuziSessionApiClient();
    setLoading(true);
    setSelectedIds([]);
    setSelectedGroups([]);
    setError('');
    // Existing token inventory and authorized creation groups are separate resources.
    const request =
      mode === 'import'
        ? client.listAccountTokens()
        : client.getProviderGroups();
    void request
      .then((data) => {
        if (cancelled || !current()) return;
        if (mode === 'import') {
          const next = data as TuziAccountToken[];
          const added = localFingerprints();
          const defaultToken = next.find(
            (t) =>
              t.usable &&
              t.groups.includes('default') &&
              !added.has(t.fingerprint)
          );
          setTokens(next);
          setSelectedIds(defaultToken ? [defaultToken.token_id] : []);
        } else {
          const next = data as TuziProviderGroup[];
          setGroups(next);
          setSelectedGroups(
            next.some((g) => g.group === 'default') ? ['default'] : []
          );
        }
      })
      .catch((e) => {
        if (!cancelled && current()) {
          if (
            mode === 'import' &&
            e instanceof Error &&
            'status' in e &&
            e.status === 404
          ) {
            setUnsupported(true);
            setMode('create');
            onUnsupported?.();
          } else {
            setError(e instanceof Error ? e.message : '加载失败，请重试');
          }
        }
      })
      .finally(() => {
        if (!cancelled && current()) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, revision]);

  const submit = async () => {
    if (submitting.current || loading || !current()) return;
    const ids = selectedIds.filter((id) =>
      tokens.some(
        (t) =>
          t.token_id === id &&
          t.usable &&
          !localFingerprints().has(t.fingerprint)
      )
    );
    if (
      !completedResponse.current &&
      (mode === 'import' ? !ids.length : !selectedGroups.length || !name.trim())
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError('');
    let received = false;
    try {
      const client = new TuziSessionApiClient();
      if (mode === 'create' && unsupported) {
        const providers =
          managedResponse.current ||
          (await client.ensureManagedProviders(selectedGroups));
        if (!current()) return;
        managedResponse.current = providers;
        await synchronizeTuziManagedProviders(providers);
        if (!current()) return;
        const selected = providers.filter((p) =>
          selectedGroups.includes(p.group)
        );
        void Promise.allSettled(
          selected.map(discoverAndUseAllTuziProviderModels)
        );
        onComplete(selected);
        return;
      }
      const result =
        completedResponse.current ||
        (mode === 'import'
          ? await client.importAccountTokens(ids)
          : await client.createAccountTokens(name.trim(), selectedGroups));
      if (!current()) return;
      completedResponse.current = result;
      received = true;
      const providers: TuziManagedProvider[] = result.map((t) => ({
        id: `tuzi-token-${account.current.user}-${t.token_id}`,
        group: t.groups[0],
        groups: t.groups,
        displayName: t.token_name,
        tokenName: t.token_name,
        apiKey: t.api_key || '',
        status: 1,
        rotatedAt: 0,
      }));
      const additions = await addTuziTokenProviders(providers);
      if (!current()) return;
      await client.verifyExistingProviders();
      if (!current()) return;
      // Discover only newly added profiles, preserving manually configured model selections.
      void Promise.allSettled(
        additions.map(discoverAndUseAllTuziProviderModels)
      );
      onComplete(providers);
    } catch (e) {
      if (!current()) return;
      if (e instanceof Error && 'status' in e && e.status === 404) {
        setUnsupported(true);
        onUnsupported?.();
        setError('当前站点使用账户分组，请再次点击创建并添加。');
        return;
      }
      const message = e instanceof Error ? e.message : '操作失败';
      setError(
        mode === 'create' && !received
          ? `${message}。若请求超时，请先到“添加已有令牌”刷新确认，避免重复创建。`
          : message
      );
    } finally {
      submitting.current = false;
      if (current()) setBusy(false);
    }
  };
  const changeMode = (next: 'import' | 'create') => {
    if (busy || next === mode) return;
    completedResponse.current = null;
    managedResponse.current = null;
    setMode(next);
    setError('');
    setLoading(true);
  };
  const renderGroup = (group: TuziProviderGroup, prominent = false) => (
    <label
      key={group.group}
      className={`tuzi-token-picker__group ${prominent ? 'is-default' : ''} ${
        selectedGroups.includes(group.group) ? 'is-selected' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={selectedGroups.includes(group.group)}
        disabled={
          busy || !!completedResponse.current || !!managedResponse.current
        }
        onChange={() =>
          setSelectedGroups((previous) =>
            previous.includes(group.group)
              ? previous.filter((g) => g !== group.group)
              : [...previous, group.group]
          )
        }
      />
      <span>
        <strong>{group.displayName || group.group}</strong>
        {group.displayName !== group.group && <small>{group.group}</small>}
      </span>
      {prominent && (
        <small className="tuzi-token-picker__badge">默认选择</small>
      )}
    </label>
  );
  const count = mode === 'import' ? selectedIds.length : selectedGroups.length;
  const defaultGroup = groups.find((g) => g.group === 'default');

  return (
    <section className="tuzi-token-picker" aria-label="添加 Tuzi 令牌">
      {unsupported && (
        <p role="status">
          当前站点不支持导入已有令牌，仍可创建或复用 Tuzi 账户分组。
        </p>
      )}
      <div className="tuzi-token-picker__tabs">
        {!unsupported && (
          <button
            type="button"
            aria-pressed={mode === 'import'}
            disabled={busy}
            onClick={() => changeMode('import')}
          >
            添加已有令牌
          </button>
        )}
        <button
          type="button"
          aria-pressed={mode === 'create'}
          disabled={busy}
          onClick={() => changeMode('create')}
        >
          <Plus size={15} />
          {unsupported ? '添加 Tuzi 分组' : '创建新令牌'}
        </button>
      </div>
      <div className="tuzi-token-picker__body">
        <div className="tuzi-token-picker__heading">
          {mode === 'create' && (
            <span className="tuzi-token-picker__icon">
              <KeyRound size={22} />
            </span>
          )}
          <div>
            <h3>
              {mode === 'import'
                ? '添加已有令牌'
                : unsupported
                ? '添加 Tuzi 分组'
                : '创建新令牌'}
            </h3>
            <p>
              {mode === 'import'
                ? '来自 Tuzi「令牌管理」 · 保留你设置的名称、分组与限制'
                : unsupported
                ? '配置后自动添加到 OpenTu。已有账户分组会继续复用。'
                : '创建后自动添加到 OpenTu，也会显示在 Tuzi「令牌管理」。'}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="tuzi-token-picker__empty">
            <Loader2 size={18} className="is-spinning" />
            正在读取{mode === 'import' ? '已有令牌' : '可用分组'}
          </div>
        ) : mode === 'import' ? (
          <div className="tuzi-token-picker__list">
            {tokens.map((t) => {
              const added = fingerprints.has(t.fingerprint);
              const unavailable = !t.usable || added;
              return (
                <label
                  key={t.token_id}
                  className={`tuzi-token-picker__row ${
                    selectedIds.includes(t.token_id) ? 'is-selected' : ''
                  } ${unavailable ? 'is-unavailable' : ''}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择令牌 ${t.token_name} (#${t.token_id})`}
                    disabled={
                      unavailable || busy || !!completedResponse.current
                    }
                    checked={selectedIds.includes(t.token_id)}
                    onChange={() =>
                      setSelectedIds((previous) =>
                        previous.includes(t.token_id)
                          ? previous.filter((id) => id !== t.token_id)
                          : [...previous, t.token_id]
                      )
                    }
                  />
                  <span className="tuzi-token-picker__name">
                    <strong>{t.token_name || '未命名令牌'}</strong>
                    <span className="tuzi-token-picker__meta">
                      {t.groups.map((g) => (
                        <span key={g} className="tuzi-token-picker__badge">
                          {g}
                        </span>
                      ))}
                      <small>
                        #{t.token_id} · {tokenDetail(t)}
                      </small>
                    </span>
                  </span>
                  {unavailable && (
                    <small>
                      {added ? '已添加' : reasons[t.reason || ''] || '不可用'}
                    </small>
                  )}
                </label>
              );
            })}
            {!tokens.length && !error && (
              <div className="tuzi-token-picker__empty">
                暂无已有令牌，可以切换到“创建新令牌”。
              </div>
            )}
          </div>
        ) : (
          <>
            {!unsupported && (
              <label className="tuzi-token-picker__field">
                <span>令牌名称</span>
                <input
                  type="text"
                  value={name}
                  maxLength={30}
                  disabled={
                    busy ||
                    !!completedResponse.current ||
                    !!managedResponse.current
                  }
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：OpenTu 日常使用"
                />
                <small>这个名称也会显示在 Tuzi 的令牌管理中。</small>
              </label>
            )}
            <div className="tuzi-token-picker__label tuzi-token-picker__label--groups">
              所属分组 <small>默认只选择 default</small>
            </div>
            {defaultGroup && renderGroup(defaultGroup, true)}
            {groups.some((g) => g.group !== 'default') && (
              <>
                <div className="tuzi-token-picker__other-groups-title">
                  选择其他分组
                </div>
                <div className="tuzi-token-picker__groups">
                  {groups
                    .filter((g) => g.group !== 'default')
                    .map((g) => renderGroup(g))}
                </div>
              </>
            )}
            {!groups.length && !error && (
              <div className="tuzi-token-picker__empty">暂无可用分组</div>
            )}
            <div className="tuzi-token-picker__preview">
              <div>
                {unsupported ? '即将添加' : '即将创建'}{' '}
                <span>
                  {count} {unsupported ? '个账户分组' : '枚令牌'}
                </span>
              </div>
              {selectedGroups.map((g) => (
                <div key={g}>
                  <KeyRound size={15} />
                  <strong>
                    {unsupported
                      ? groups.find((group) => group.group === g)
                          ?.displayName || g
                      : name.trim() || '未命名令牌'}
                    {count > 1 ? ` · ${g}` : ''}
                  </strong>
                  <span className="tuzi-token-picker__badge">{g}</span>
                </div>
              ))}
              <small>
                {unsupported
                  ? '已有账户分组继续复用，缺少的分组由 Tuzi 创建。'
                  : '每个分组创建一枚 · 不限额度与次数 · 长期有效'}
              </small>
            </div>
          </>
        )}
        {error && (
          <div className="tuzi-token-picker__error" role="alert">
            {error}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (completedResponse.current) void submit();
                else setRevision((r) => r + 1);
              }}
            >
              <RefreshCw size={14} />
              {completedResponse.current ? '重试添加' : '刷新列表'}
            </button>
          </div>
        )}
      </div>
      <div className="tuzi-token-picker__footer">
        <small aria-live="polite">
          {mode === 'import'
            ? `已选择 ${count} 枚令牌`
            : `将创建 ${count} 枚新令牌`}
        </small>
        <div>
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={
              busy || loading || !count || (mode === 'create' && !name.trim())
            }
            onClick={() => void submit()}
          >
            {busy && <Loader2 size={16} className="is-spinning" />}
            {completedResponse.current
              ? '继续添加'
              : mode === 'import'
              ? `添加 ${count} 枚已有令牌`
              : '创建并添加'}
          </button>
        </div>
      </div>
    </section>
  );
}
