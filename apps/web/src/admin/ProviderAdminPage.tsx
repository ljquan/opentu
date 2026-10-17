import {
  Check,
  ChevronLeft,
  CircleAlert,
  FlaskConical,
  CloudDownload,
  Link2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldX,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  providerManagementApi,
  type ManagedProvider,
  type ManagedProviderModel,
  type ProviderAuthType,
} from '../services/provider-management-api';
import { useAccountSession } from '../account/use-account-session';
import './provider-admin-page.scss';

type ProviderAdminPageProps = { onGoHome: () => void; onGoCreativeCenter?: () => void };

const emptyDraft = { name: '', baseUrl: '', authType: 'bearer' as ProviderAuthType, authHeader: '', authQuery: '', apiKey: '', enabled: true };

function statusLabel(status: ManagedProvider['healthStatus']): string {
  return status === 'healthy' ? '连接正常' : status === 'unhealthy' ? '需要检查' : '尚未检查';
}

export function ProviderAdminPage({ onGoHome, onGoCreativeCenter }: ProviderAdminPageProps) {
  const { account, checking } = useAccountSession();
  const [providers, setProviders] = useState<ManagedProvider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [models, setModels] = useState<ManagedProviderModel[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [isNew, setIsNew] = useState(true);
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'sync' | 'delete' | null>('load');
  const [modelBusy, setModelBusy] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedIdRef = useRef<string | null>(null);
  const selected = providers.find((provider) => provider.id === selectedId) || null;

  const selectProvider = useCallback((provider: ManagedProvider) => {
    selectedIdRef.current = provider.id;
    setSelectedId(provider.id);
    setIsNew(false);
    setDraft({ ...emptyDraft, name: provider.name, baseUrl: provider.baseUrl, authType: provider.authType, enabled: provider.enabled });
    setModels([]);
    setModelsLoading(false);
    setNotice('');
    setModelsLoading(true);
    void providerManagementApi.models(provider.id)
      .then((next) => {
        if (selectedIdRef.current === provider.id) setModels(next);
      })
      .catch(() => {
        if (selectedIdRef.current === provider.id) setModels([]);
      })
      .finally(() => {
        if (selectedIdRef.current === provider.id) setModelsLoading(false);
      });
  }, []);

  const loadProviders = useCallback(async () => {
    setBusy('load');
    setError('');
    try {
      const next = await providerManagementApi.list();
      setProviders(next);
      const nextSelected = next.find((provider) => provider.id === selectedIdRef.current) || next[0];
      if (nextSelected) selectProvider(nextSelected);
      else startNew();
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取供应商');
    } finally {
      setBusy(null);
    }
  }, [selectProvider]);

  useEffect(() => {
    if (!checking && !account) {
      window.location.replace('/account?next=%2Fadmin%2Fproviders');
    }
  }, [account, checking]);

  useEffect(() => {
    if (account && account.role >= 5) void loadProviders();
  }, [account, loadProviders]);

  function startNew() {
    selectedIdRef.current = null;
    setSelectedId(null);
    setIsNew(true);
    setDraft(emptyDraft);
    setModels([]);
    setModelsLoading(false);
    setError('');
    setNotice('');
  }

  async function saveProvider() {
    if (!draft.name.trim() || !draft.baseUrl.trim() || (isNew && !draft.apiKey?.trim())) {
      setError(isNew ? '请填写名称、Base URL 和 API Key' : '请填写名称和 Base URL');
      return;
    }
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const provider = isNew
        ? await providerManagementApi.create(draft)
        : await providerManagementApi.update(selectedId as string, { ...draft, apiKey: draft.apiKey || undefined });
      setProviders((current) => isNew ? [provider, ...current] : current.map((item) => item.id === provider.id ? provider : item));
      selectProvider(provider);
      setDraft((current) => ({ ...current, apiKey: '' }));
      setNotice('供应商配置已保存。下一步请测试连接，再同步模型目录。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(null);
    }
  }

  async function testProvider() {
    if (!selectedId) return;
    setBusy('test');
    setError('');
    setNotice('');
    try {
      const result = await providerManagementApi.test(selectedId);
      setProviders((current) => current.map((item) => item.id === result.provider.id ? result.provider : item));
      setNotice(`连接测试通过，发现 ${result.modelCount} 个模型。现在可以同步模型目录。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接测试失败');
      await loadProviders();
    } finally {
      setBusy(null);
    }
  }

  async function syncModels() {
    if (!selectedId) return;
    setBusy('sync');
    setError('');
    setNotice('');
    try {
      const result = await providerManagementApi.syncModels(selectedId);
      setModels(result.models);
      setProviders((current) => current.map((item) => item.id === result.provider.id ? result.provider : item));
      setNotice(`模型目录已同步，共 ${result.models.length} 个模型。请为要开放的模型选择“免费”、上架并开启网关。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型同步失败');
    } finally {
      setBusy(null);
    }
  }

  async function deleteProvider() {
    if (!selectedId || !window.confirm('确定删除这个供应商及其模型目录吗？')) return;
    setBusy('delete');
    setError('');
    setNotice('');
    try {
      await providerManagementApi.remove(selectedId);
      setProviders((current) => current.filter((item) => item.id !== selectedId));
      startNew();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(null);
    }
  }

  async function updateModel(
    model: ManagedProviderModel,
    update: Partial<
      Pick<
        ManagedProviderModel,
        'published' | 'gatewayEnabled' | 'billingMode' | 'routingPriority'
      >
    >
  ) {
    if (!selectedId || !model.available) return;
    const previous = model;
    setModelBusy(model.id);
    setError('');
    setNotice('');
    setModels((current) => current.map((item) => item.id === model.id ? { ...item, ...update } : item));
    try {
      const saved = await providerManagementApi.updateModel(selectedId, model.id, update);
      setModels((current) => current.map((item) => item.id === model.id ? { ...item, ...saved } : item));
      setNotice('模型发布设置已保存。');
    } catch (err) {
      setModels((current) => current.map((item) => item.id === model.id ? previous : item));
      setError(err instanceof Error ? err.message : '模型服务状态保存失败');
    } finally {
      setModelBusy(null);
    }
  }

  const publishedCount = useMemo(() => models.filter((model) => model.published && model.available).length, [models]);
  const availableCount = useMemo(() => models.filter((model) => model.available).length, [models]);
  const gatewayCount = useMemo(() => models.filter((model) => model.gatewayEnabled && model.published && model.billingMode === 'free' && model.available).length, [models]);
  const healthyProviderCount = useMemo(() => providers.filter((provider) => provider.enabled && provider.healthStatus === 'healthy').length, [providers]);

  async function switchAccount() {
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } finally {
      window.location.assign('/account?next=%2Fadmin%2Fproviders');
    }
  }

  if (checking || !account) {
    return (
      <main className="provider-admin-page provider-admin-page--gate">
        <RefreshCw className="is-spinning" size={22} />
        <strong>正在验证管理员身份</strong>
      </main>
    );
  }

  if (account.role < 5) {
    return (
      <main className="provider-admin-page provider-admin-page--gate">
        <div className="provider-admin-page__gate-brand"><img src="/icons/foxvue-mark.png" alt="" width="34" height="34" /><span>狐图 FoxVue 管理台</span></div>
        <section className="provider-admin-page__gate-panel">
          <span className="provider-admin-page__gate-icon"><ShieldX size={27} /></span>
          <span className="provider-admin-page__kicker">ACCESS RESTRICTED</span>
          <h1>需要管理员权限</h1>
          <p>当前登录账户 <strong>{account.username}</strong> 没有供应商与模型管理权限。</p>
          <div className="provider-admin-page__gate-actions">
            <button className="provider-admin-page__primary" type="button" onClick={() => void switchAccount()}><LogOut size={16} /> 切换管理员账号</button>
            <button type="button" onClick={onGoHome}>返回首页</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="provider-admin-page">
      <header className="provider-admin-page__topbar">
        <button className="provider-admin-page__back" type="button" onClick={onGoHome}><ChevronLeft size={17} /> 返回首页</button>
        <div className="provider-admin-page__brand"><img className="provider-admin-page__brand-mark" src="/icons/foxvue-mark.png" alt="" width="30" height="30" /><span>狐图 FoxVue 管理台</span></div>
        <div className="provider-admin-page__top-actions">
          {onGoCreativeCenter ? <button type="button" onClick={onGoCreativeCenter}>查看创作中心</button> : null}
          <span className="provider-admin-page__secure"><LockKeyhole size={14} /> 服务端托管</span>
        </div>
      </header>
      <section className="provider-admin-page__intro">
        <div><span className="provider-admin-page__kicker">PLATFORM SETTINGS</span><h1>模型服务管理</h1><p>填写供应商连接信息，测试后同步模型，再选择允许用户调用的模型。</p></div>
        <div className="provider-admin-page__intro-side"><div className="provider-admin-page__stats"><strong>{providers.length}</strong><span>供应商</span><strong>{healthyProviderCount}</strong><span>连接正常</span><strong>{publishedCount}</strong><span>已上架</span><strong>{gatewayCount}</strong><span>网关可用</span></div><div className="provider-admin-page__route"><span>管理入口</span><code>/admin/providers</code></div></div>
      </section>
      <ol className="provider-admin-page__steps" aria-label="模型配置流程">
        <li className={!isNew || providers.length > 0 ? 'is-complete' : 'is-current'}><span>01</span><div><strong>保存供应商</strong><small>地址、鉴权方式和 API Key</small></div></li>
        <li className={selected?.healthStatus === 'healthy' ? 'is-complete' : selected ? 'is-current' : ''}><span>02</span><div><strong>测试连接</strong><small>确认服务端可以访问上游</small></div></li>
        <li className={models.length > 0 ? 'is-complete' : selected ? 'is-current' : ''}><span>03</span><div><strong>同步模型</strong><small>读取上游 /v1/models 目录</small></div></li>
        <li className={publishedCount > 0 ? 'is-complete' : models.length > 0 ? 'is-current' : ''}><span>04</span><div><strong>上架模型</strong><small>选择免费模型并保存发布状态</small></div></li>
        <li className={gatewayCount > 0 ? 'is-complete' : publishedCount > 0 ? 'is-current' : ''}><span>05</span><div><strong>开启网关</strong><small>让创作中心可以调用模型</small></div></li>
      </ol>
      {error ? <div className="provider-admin-page__error"><CircleAlert size={16} /> {error}<button type="button" aria-label="关闭提示" onClick={() => setError('')}><X size={15} /></button></div> : null}
      {notice ? <div className="provider-admin-page__notice" role="status"><Check size={16} /> {notice}</div> : null}
      <section className="provider-admin-page__launch-check" aria-label="上线前检查"><div className="provider-admin-page__launch-check-icon"><ServerCog size={18} /></div><div><strong>上线前还需要开启公网生成</strong><p>服务器环境变量必须设为 <code>OPENTU_PUBLIC_GENERATION_ENABLED=true</code>，然后重新部署 API。不开启时，普通用户会看到“模型服务尚未开放”。</p></div><span>安全提示：API Key 只在服务端加密保存</span></section>
      <section className="provider-admin-page__workspace">
        <aside className="provider-admin-page__providers">
          <div className="provider-admin-page__panel-heading"><span>供应商</span><button type="button" title="新增供应商" onClick={startNew}><Plus size={16} /></button></div>
          {busy === 'load' ? <div className="provider-admin-page__empty">正在读取...</div> : providers.length ? providers.map((provider) => <button key={provider.id} type="button" className={`provider-admin-page__provider${selectedId === provider.id ? ' is-selected' : ''}`} onClick={() => selectProvider(provider)}><span className={`provider-admin-page__status provider-admin-page__status--${provider.healthStatus}`} /><span><strong>{provider.name}</strong><small>{provider.baseUrl}</small></span><small>{statusLabel(provider.healthStatus)}</small></button>) : <div className="provider-admin-page__empty">还没有供应商</div>}
        </aside>
        <div className="provider-admin-page__detail">
          <div className="provider-admin-page__section-title"><div><span className="provider-admin-page__section-label">{isNew ? 'NEW PROVIDER' : 'PROVIDER PROFILE'}</span><h2>{isNew ? '添加供应商' : selected?.name}</h2></div>{selected ? <span className={`provider-admin-page__health provider-admin-page__health--${selected.healthStatus}`}><span />{statusLabel(selected.healthStatus)}</span> : null}</div>
          <div className="provider-admin-page__form">
            <label><span>显示名称</span><input value={draft.name} placeholder="例如：兔子视觉" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>Base URL</span><input value={draft.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
            <label><span>鉴权方式</span><select value={draft.authType} onChange={(event) => setDraft({ ...draft, authType: event.target.value as ProviderAuthType })}><option value="bearer">Bearer Token</option><option value="header">自定义请求头</option><option value="query">Query 参数</option></select></label>
            {draft.authType === 'header' ? <label><span>请求头名称</span><input value={draft.authHeader} placeholder="X-API-Key" onChange={(event) => setDraft({ ...draft, authHeader: event.target.value })} /></label> : null}
            {draft.authType === 'query' ? <label><span>参数名称</span><input value={draft.authQuery} placeholder="api_key" onChange={(event) => setDraft({ ...draft, authQuery: event.target.value })} /></label> : null}
            <label className="provider-admin-page__form-wide"><span>API Key {isNew ? '' : '（留空则保留当前密钥）'}</span><input type="password" value={draft.apiKey} placeholder={isNew ? '只会加密存储在服务端' : '已保存，不会回显'} autoComplete="new-password" onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></label>
            <label className="provider-admin-page__switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>允许参与模型服务</span></label>
          </div>
          <div className="provider-admin-page__actions"><button className="provider-admin-page__primary" type="button" disabled={busy !== null} onClick={() => void saveProvider()}>{busy === 'save' ? <RefreshCw className="is-spinning" size={15} /> : <Check size={15} />} 保存配置</button>{selected ? <><button type="button" disabled={busy !== null} onClick={() => void testProvider()}><Link2 size={15} /> 测试连接</button><button type="button" disabled={busy !== null} onClick={() => void syncModels()}><CloudDownload size={15} /> 同步模型</button><button className="provider-admin-page__danger" type="button" disabled={busy !== null} title="删除供应商" onClick={() => void deleteProvider()}><Trash2 size={15} /></button></> : null}</div>
          {selected ? <div className="provider-admin-page__models"><div className="provider-admin-page__models-heading"><div><h3>模型目录 <small>{modelsLoading ? '正在读取…' : `${availableCount} 个可用 · ${publishedCount} 个已上架 · ${gatewayCount} 个网关可用`}</small></h3><p>只有“可用 + 已上架 + 免费 + 网关已开”的模型会出现在创作中心。</p></div><button type="button" disabled={busy !== null || modelsLoading} onClick={() => void syncModels()}><RefreshCw size={14} className={busy === 'sync' ? 'is-spinning' : ''} /> 刷新</button></div>{modelsLoading ? <div className="provider-admin-page__empty provider-admin-page__empty--models"><RefreshCw size={18} className="is-spinning" />正在读取模型目录…</div> : models.length ? <div className="provider-admin-page__model-list">{models.map((model) => <div key={model.id} className={`provider-admin-page__model${model.published ? ' is-published' : ''}${model.gatewayEnabled ? ' is-gateway' : ''}${!model.available ? ' is-unavailable' : ''}`}><span className="provider-admin-page__model-check">{model.published ? <Check size={14} /> : null}</span><span className="provider-admin-page__model-info"><strong>{model.name}</strong><small>{model.modelId} · {model.category}</small></span><div className="provider-admin-page__model-controls"><button type="button" disabled={modelBusy === model.id || !model.available} className={model.published ? 'is-active' : ''} onClick={() => void updateModel(model, { published: !model.published })}>{model.published ? '已上架' : '上架'}</button><button type="button" disabled={modelBusy === model.id || !model.available || (!model.published && !model.gatewayEnabled)} className={model.gatewayEnabled ? 'is-active is-canary' : ''} onClick={() => void updateModel(model, { gatewayEnabled: !model.gatewayEnabled })}><FlaskConical size={12} />{model.gatewayEnabled ? '网关已开' : '开启网关'}</button><select aria-label={`${model.name} 计费模式`} value={model.billingMode} disabled={modelBusy === model.id || !model.available} onChange={(event) => void updateModel(model, { billingMode: event.target.value as ManagedProviderModel['billingMode'] })}><option value="unconfigured">未开放</option><option value="free">免费（平台承担费用）</option><option value="external" disabled>外部结算（未开放）</option></select><label className="provider-admin-page__priority"><span>优先级</span><input key={`${model.id}-${model.routingPriority}`} type="number" min="0" max="10000" defaultValue={model.routingPriority} disabled={modelBusy === model.id || !model.available} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value !== model.routingPriority) void updateModel(model, { routingPriority: value }); }} /></label></div></div>)}</div> : <div className="provider-admin-page__empty provider-admin-page__empty--models"><RefreshCw size={18} />先测试连接，再同步模型目录</div>}</div> : <div className="provider-admin-page__onboarding"><ServerCog size={24} /><strong>从一个可靠的供应商开始</strong><span>填写右侧表单后点击“保存配置”，模型配置入口就在这里。</span></div>}
        </div>
      </section>
    </main>
  );
}
