import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, LogOut, KeyRound } from 'lucide-react';
import './account.css';

type Account = { id: string; username: string; role: number };
function getNextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/creative-center';
}
function isCurrentAccountDestination(path: string): boolean {
  try {
    const destination = new URL(path, window.location.origin);
    return destination.origin === window.location.origin &&
      destination.pathname.replace(/\/+$/, '') === '/account' &&
      window.location.pathname.replace(/\/+$/, '') === '/account';
  } catch {
    return false;
  }
}
const errors: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确',
  USER_ALREADY_EXISTS: '该邮箱已注册',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '该邮箱已注册',
  PASSWORD_TOO_SHORT: '密码至少需要 12 个字符',
  INVALID_PASSWORD: '当前密码不正确',
  SIGNUP_DISABLED: '注册暂未开放',
};
async function accountRequest(path: string, body?: Record<string, unknown>) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch(() => { throw new Error('网络连接失败，请检查网络后重试'); });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error('操作过于频繁，请稍后再试');
    if (response.status === 403) throw new Error('请求被拒绝，请检查账户状态或稍后重试');
    throw new Error(errors[data?.code] || (response.status === 401 ? '登录已过期或凭据不正确' : '请求失败，请稍后重试'));
  }
  return data;
}
export function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const sessionId = useRef<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const nextPath = getNextPath();
  const clearPasswords = () => { setPassword(''); setNewPassword(''); setConfirmPassword(''); setShowPassword(false); };
  async function refresh() {
    const response = await fetch('/api/session-status', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('账户服务暂不可用');
    const payload = await response.json();
    if (payload?.data === null) {
      if (sessionId.current) { clearPasswords(); setMode('login'); }
      sessionId.current = null;
      setAccount(null); setChanging(false); return;
    }
    if (!payload?.data?.id) throw new Error('账户响应无效');
    if (sessionId.current !== payload.data.id) { clearPasswords(); setChanging(false); }
    sessionId.current = payload.data.id;
    setAccount(payload.data);
  }
  useEffect(() => {
    const sync = () => { void refresh().catch(() => { setAccount(null); setError('账户服务暂不可用，请刷新重试'); }).finally(() => setChecking(false)); };
    sync();
    window.addEventListener('focus', sync);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('opentu-account') : null;
    if (channel) channel.onmessage = sync;
    return () => { window.removeEventListener('focus', sync); channel?.close(); };
  }, []);
  function notifyTabs() {
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('opentu-account'); channel.postMessage('changed'); channel.close(); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    if (!account && mode === 'register' && !name.trim()) { setError('请输入名称，不能只填写空格'); return; }
    if ((mode === 'register' && !account && password !== confirmPassword) || (changing && newPassword !== confirmPassword)) { setError('两次输入的密码不一致'); return; }
    setBusy(true);
    try {
      const shouldEnterCreativeCenter = !account;
      if (account && changing) {
        await accountRequest('/api/auth/change-password', { currentPassword: password, newPassword, revokeOtherSessions: true });
        setNotice('密码已更新，其他会话已退出'); setChanging(false);
      } else {
        await accountRequest(mode === 'register' ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email', { email: email.trim(), password, ...(mode === 'register' ? { name: name.trim() } : {}) });
      }
      clearPasswords(); await refresh(); notifyTabs();
      if (shouldEnterCreativeCenter) {
        if (!isCurrentAccountDestination(nextPath)) window.location.assign(nextPath);
        return;
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '请求失败'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError(''); setNotice('');
    try { await accountRequest('/api/auth/sign-out', {}); sessionId.current = null; setAccount(null); setMode('login'); setChanging(false); clearPasswords(); notifyTabs(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '退出失败'); }
    finally { setBusy(false); }
  }
  return <main className="account-page">
    <header className="account-header"><div className="account-brand"><img src="/icons/foxvue-mark.png" alt="" width="36" height="36" /><span>狐图 <small>FoxVue</small></span></div><span className="account-header-label">创作，从灵感开始</span></header>
    <div className="account-intro">
      <span className="account-eyebrow">A SPACE FOR YOUR IDEAS</span>
      <h2>狐图 <span>FoxVue</span></h2>
      <p>让每一个想法，都有值得展开的可能。</p>
      <span className="account-intro-note">致每一个热爱思考、表达与创作的人。</span>
    </div>
    <section className={`account-content mode-${mode}`} aria-busy={checking || busy}>
      {!checking && !account && <div className="account-modes" role="group" aria-label="账户入口">
        {(['login', 'register'] as const).map((option) => <button key={option} type="button" disabled={busy} aria-label={option === 'login' ? '切换到登录' : '切换到注册'} aria-pressed={mode === option} onClick={() => { setMode(option); setError(''); setNotice(''); clearPasswords(); }}>{option === 'login' ? '登录' : '注册'}</button>)}
      </div>}
      <h1>{checking ? '正在读取账户' : account ? '我的账户' : mode === 'login' ? '登录' : '创建账户'}</h1>
      {!checking && <p className="account-welcome">{account ? '很高兴再次见到你。' : mode === 'login' ? '欢迎回来，继续你的创作旅程。' : '很高兴认识你，一起发现更多可能。'}</p>}
      {error && <p role="alert" className="account-error">{error}</p>}
      {notice && <p role="status" className="account-notice">{notice}</p>}
      {!checking && account && <>
        <dl><dt>名称</dt><dd>{account.username}</dd><dt>账户 ID</dt><dd className="account-id">{account.id}</dd></dl>
        <div className="account-actions"><button disabled={busy} onClick={() => { setChanging(!changing); clearPasswords(); setError(''); }}><KeyRound size={16} />{changing ? '取消修改' : '修改密码'}</button><button className="account-enter" disabled={busy} onClick={() => window.location.assign(nextPath)}>进入创作中心</button><button disabled={busy} onClick={() => void logout()}><LogOut size={16} />退出登录</button></div>
      </>}
      {!checking && (!account || changing) && <form onSubmit={(event) => void submit(event)}>
        {!account && <>
          {mode === 'register' && <label>名称<input autoComplete="nickname" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>}
          <label>邮箱<input type="email" autoComplete="username" placeholder="name@example.com" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
        </>}
        <label>{changing ? '当前密码' : '密码'}<span className="account-password"><input type={showPassword ? 'text' : 'password'} autoComplete={!account && mode === 'register' ? 'new-password' : 'current-password'} required minLength={!account && mode === 'register' ? 12 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /><button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} title={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
        {changing && <label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} /></label>}
        {(changing || (!account && mode === 'register')) && <><label>确认密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={busy} /></label><small>密码长度为 12–128 个字符</small></>}
        <button className="account-primary" disabled={busy} type="submit">{busy ? '正在处理…' : changing ? '更新密码' : mode === 'register' ? '注册' : '登录'}</button>
      </form>}
    </section>
    <footer className="account-footer"><span>狐图 FoxVue</span><span>每一份灵感，都值得认真对待。</span></footer>
  </main>;
}
