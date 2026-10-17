import { ArrowUp, ChevronDown, ChevronRight, CircleHelp, Clock3, Grid2X2, Home, Image, Images, LoaderCircle, LogIn, LogOut, Menu, MoreHorizontal, Music2, Paperclip, Search, Settings2, Sparkles, Video, WalletCards, Workflow, X } from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAccountSession } from '../account/use-account-session';
import { getMarketplaceModel } from '../home/model-marketplace-catalog';
import { useWorkspaceRuntime } from '../workspace/application/use-workspace-runtime';
import type { WorkspaceBoardSummary, WorkspaceTaskSummary } from '../workspace/domain/workspace-model';
import {
  clearCreationCenterDraft,
  readCreationCenterDraft,
  readReferenceImage,
  type CreationAspectRatio,
  type CreationMode,
  type CreationQuality,
  type CreationReferenceImage,
  type CreationRequest,
} from './creation-request';
import './creative-center-page.scss';
import './creative-center-night.scss';
export type { CreationRequest } from './creation-request';

type CreativeCenterPageProps = {
  isCreating?: boolean;
  onCreateBoard: (request?: CreationRequest) => Promise<void>;
  onOpenBoard: (boardId: string) => Promise<void>;
  onGoHome: () => void;
  onLogin?: () => void;
  onOpenWorks?: () => void;
  onOpenWorkflows?: () => void;
  onOpenMusicStation?: () => void;
  onOpenModels?: () => void;
  onOpenTemplates?: () => void;
  onOpenAdmin?: () => void;
  selectedModelId?: string | null;
  selectedMode?: string | null;
};
const modeOptions = [
  { id: 'image' as const, label: '图片', icon: Image },
  { id: 'video' as const, label: '视频', icon: Video },
  { id: 'audio' as const, label: '音乐', icon: Music2 },
  { id: 'canvas' as const, label: '画布', icon: Grid2X2 },
];
const boardPreviewImages = ['/product_showcase/aitu-03.png', '/product_showcase/aitu-01.png', '/product_showcase/case-1.png', '/product_showcase/case-2.png', '/product_showcase/aitu-02.png'];
const templates = [
  { title: '品牌咖啡海报', image: '/product_showcase/aitu-01.png' },
  { title: '护肤产品上新', image: '/product_showcase/aitu-02.png' },
  { title: '产品视觉设计', image: '/product_showcase/aitu-03.png' },
  { title: '项目流程规划', image: '/product_showcase/case-1.png' },
  { title: '灵感知识整理', image: '/product_showcase/case-2.png' },
];
function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '刚刚';
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(timestamp).toLocaleDateString('zh-CN');
}
function isActiveTask(task: WorkspaceTaskSummary): boolean { return task.status === 'pending' || task.status === 'processing'; }
function taskStatusLabel(task: WorkspaceTaskSummary): string {
  if (task.status === 'completed') return '已完成';
  if (task.status === 'failed') return '失败';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'pending') return '排队中';
  return '生成中';
}
function ProjectCard({ board, image, onOpen }: { board: WorkspaceBoardSummary; image: string; onOpen: () => void }) {
  return <button className="cc-project-card" type="button" onClick={onOpen}>
    <span className="cc-project-card__visual"><img src={image} alt="" loading="lazy" /></span>
    <span className="cc-project-card__copy"><strong>{board.name || '未命名项目'}</strong><small>更新于 {formatRelativeTime(board.updatedAt)}</small></span>
    <MoreHorizontal size={17} aria-hidden="true" />
  </button>;
}

export function CreativeCenterPage({ isCreating = false, onCreateBoard, onOpenBoard, onGoHome, onLogin, onOpenWorks, onOpenWorkflows, onOpenMusicStation, onOpenModels, onOpenTemplates, onOpenAdmin, selectedModelId, selectedMode }: CreativeCenterPageProps) {
  const buildManagedGeneration = String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_OPENTU_MANAGED_GENERATION || '').toLowerCase() === 'true';
  const testManagedGeneration = typeof process !== 'undefined' && process.env?.VITE_OPENTU_MANAGED_GENERATION === 'true';
  const managedGeneration = buildManagedGeneration || testManagedGeneration;
  const { boards, tasks } = useWorkspaceRuntime();
  const { account, checking: checkingAccount } = useAccountSession();
  const initialDraft = useMemo(readCreationCenterDraft, []);
  const selectedModel = getMarketplaceModel(selectedModelId);
  const requestedMode = selectedMode || initialDraft?.mode;
  const initialMode = modeOptions.some((item) => item.id === requestedMode) ? requestedMode as CreationMode : selectedModel?.category === 'video' ? 'video' : selectedModel?.category === 'audio' ? 'audio' : 'image';
  const [mode, setMode] = useState<CreationMode>(initialMode);
  const [prompt, setPrompt] = useState(initialDraft?.prompt || '');
  const [promptError, setPromptError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [aspectRatio, setAspectRatio] = useState<CreationAspectRatio>(managedGeneration ? '1:1' : initialDraft?.aspectRatio || '1:1');
  const [quality, setQuality] = useState<CreationQuality>(managedGeneration ? 'standard' : initialDraft?.quality || 'high');
  const [referenceImage, setReferenceImage] = useState<CreationReferenceImage | null>(managedGeneration ? null : initialDraft?.referenceImages?.[0] || null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [catalogCount, setCatalogCount] = useState(0);
  const [catalogRetryKey, setCatalogRetryKey] = useState(0);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const recentBoards = boards.filter((board) => !normalizedSearch || board.name.toLowerCase().includes(normalizedSearch)).slice(0, 5);
  const visibleTemplates = templates.filter((template) => !normalizedSearch || template.title.toLowerCase().includes(normalizedSearch));
  const activeTasks = useMemo(() => tasks.filter(isActiveTask), [tasks]);
  const latestTask = activeTasks[0] || tasks[0];
  const modelName = selectedModel?.name || (mode === 'video' ? 'Seedance 2.0' : mode === 'audio' ? 'Suno Music' : 'GPT Image 2');
  const handleHomeLink = (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onGoHome(); };
  const startCreation = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (managedGeneration && (mode === 'video' || mode === 'audio')) {
      setPromptError(mode === 'video' ? '视频生成暂未接入平台服务' : '音乐生成暂未接入平台服务');
      return;
    }
    if (mode === 'audio' && onOpenMusicStation) { onOpenMusicStation(); return; }
    const normalizedPrompt = prompt.trim();
    if (mode !== 'canvas' && !normalizedPrompt) {
      setPromptError('请先描述你想创作的内容');
      return;
    }
    if (managedGeneration && mode === 'image' && (aspectRatio !== '1:1' || quality !== 'standard' || referenceImage)) {
      setPromptError('公网图片生成当前仅支持 1:1 标准质量，且暂不支持参考图');
      return;
    }
    setPromptError('');
    clearCreationCenterDraft();
    void onCreateBoard({
      prompt: normalizedPrompt,
      mode,
      modelId: selectedModelId ?? initialDraft?.modelId ?? null,
      aspectRatio,
      quality,
      referenceImages: referenceImage ? [referenceImage] : undefined,
    });
  };
  const selectReferenceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (managedGeneration) {
      setPromptError('公网图片生成暂不支持参考图');
      return;
    }
    try {
      setReferenceImage(await readReferenceImage(file));
      setPromptError('');
    } catch (error) {
      setPromptError(error instanceof Error ? error.message : '参考图片读取失败');
    }
  };
  const closeMobileNav = () => setMobileNavOpen(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/catalog/models', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('catalog unavailable');
        const payload = await response.json();
        const models = Array.isArray(payload?.data) ? payload.data : [];
        if (!active) return;
        setCatalogCount(models.length);
        setCatalogState(models.length ? 'ready' : 'empty');
      })
      .catch(() => { if (active) setCatalogState('error'); });
    return () => { active = false; };
  }, [catalogRetryKey]);

  const logout = async () => {
    setAccountMenuOpen(false);
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } finally {
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('opentu-account');
        channel.postMessage('changed');
        channel.close();
      }
      window.location.assign('/account?next=%2Fcreative-center');
    }
  };

  return <div className="creative-center">
    <aside className={`cc-sidebar${mobileNavOpen ? ' is-open' : ''}`}>
      <a className="cc-brand" href="/" onClick={handleHomeLink} aria-label="狐图 FoxVue 首页"><img className="cc-brand__mark" src="/icons/foxvue-mark.png" alt="" width="30" height="30" /><strong>狐图 <small>FoxVue</small></strong></a>
      <button className="cc-sidebar__close" type="button" aria-label="关闭导航" onClick={closeMobileNav}><X size={20} /></button>
      <nav aria-label="平台导航">
        <a href="/" onClick={handleHomeLink}><Home size={18} /> 首页</a>
        <button className="is-active" type="button" aria-current="page" disabled><Image size={18} /> 创作中心</button>
        <a href="/works" onClick={(event) => { event.preventDefault(); closeMobileNav(); onOpenWorks?.(); }}><Images size={18} /> 我的作品</a>
        <button type="button" onClick={() => { closeMobileNav(); onOpenModels?.(); }}><Sparkles size={18} /> 模型广场</button>
        <button type="button" onClick={() => { closeMobileNav(); onOpenMusicStation?.(); }}><Music2 size={18} /> 音乐台</button>
        <button type="button" onClick={() => { closeMobileNav(); onOpenWorkflows?.(); }}><Workflow size={18} /> 工作流</button>
        {Number(account?.role) >= 5 && onOpenAdmin ? <button type="button" className="cc-admin-link" onClick={() => { closeMobileNav(); onOpenAdmin(); }}><Settings2 size={18} /> 管理台</button> : null}
      </nav>
      <button className="cc-help" type="button" onClick={() => window.location.assign('/user-manual/index.html')}><CircleHelp size={17} /> 帮助与反馈 <ChevronRight size={15} /></button>
    </aside>
    {mobileNavOpen ? <button className="cc-sidebar-backdrop" type="button" aria-label="关闭导航" onClick={closeMobileNav} /> : null}
    <div className="cc-shell">
      <header className="cc-topbar"><button className="cc-mobile-menu" type="button" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button><label className="cc-global-search"><Search size={17} /><input aria-label="搜索作品和模板" placeholder="搜索作品和模板" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label><div className="cc-account">{checkingAccount ? <span className="cc-account__checking" aria-label="正在读取账户" /> : account ? <div className="cc-account-menu"><button className="cc-account__identity" type="button" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}><span className="cc-avatar" aria-hidden="true">{account.username.trim().charAt(0).toUpperCase() || 'F'}</span><strong>{account.username}</strong><ChevronDown size={15} /></button>{accountMenuOpen ? <div className="cc-account-menu__panel" role="menu"><div className="cc-account-menu__meta"><strong>{account.username}</strong><small>{Number(account.role) >= 5 ? '管理员账户' : '创作者账户'}</small></div>{Number(account.role) >= 5 && onOpenAdmin ? <button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onOpenAdmin(); }}><Settings2 size={16} /> 管理台</button> : null}<button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); onLogin?.(); }}><WalletCards size={16} /> 账户设置</button><button type="button" role="menuitem" onClick={() => void logout()}><LogOut size={16} /> 退出登录</button></div> : null}</div> : <button className="cc-account__identity" type="button" onClick={onLogin}><LogIn size={17} /><strong>登录 / 注册</strong></button>}</div></header>
      <main className="cc-content">
        <div className="cc-heading"><span className="cc-heading__kicker">FOX VUE / CREATIVE STUDIO</span><h1>创作中心</h1><p>从一个想法开始，创作无限可能</p></div>
        <section className="cc-creator" aria-labelledby="cc-new-project-title">
          <div className="cc-creator__preview"><img src="/brand/foxvue-botanical-study.webp" alt="紫色山水与花卉中的护肤产品视觉示例" /><div className="cc-preview-caption"><small>FOX VUE / VISUAL STUDY</small><strong>自然之境</strong></div>{latestTask ? <span className="cc-creator__task"><Clock3 size={13} /> {taskStatusLabel(latestTask)} {Math.round(latestTask.progress)}%</span> : null}</div>
          <form className="cc-composer" onSubmit={startCreation}><div><span className="cc-eyebrow">NEW PROJECT</span><h2 id="cc-new-project-title">新建项目</h2><p className="cc-composer__hint">先选创作类型，再把想法交给模型。</p></div>
            <div className="cc-mode-tabs" role="tablist" aria-label="创作类型">{modeOptions.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? 'is-active' : ''} onClick={() => { setMode(item.id); setPromptError(''); }}><Icon size={16} /> {item.label}</button>; })}</div>
            <button className="cc-model-picker" type="button" onClick={onOpenModels}><span>模型</span><strong><Sparkles size={15} /> {modelName}</strong><ChevronDown size={14} /></button>
            {selectedModel ? <div className="cc-model-detail"><span>{selectedModel.vendor}</span><p>{selectedModel.description}</p><div>{selectedModel.tags.slice(0, 3).map((tag) => <small key={tag}>{tag}</small>)}</div></div> : null}
            <div className={`cc-catalog-status is-${catalogState}`} role="status"><span className="cc-catalog-status__dot" /><div><strong>{catalogState === 'loading' ? '正在检查模型服务' : catalogState === 'ready' ? `已连接 ${catalogCount} 个可用模型` : catalogState === 'empty' ? '模型服务尚未开放' : '模型服务暂时不可用'}</strong><small>{catalogState === 'empty' ? '管理员完成同步、上架并开启网关后，这里会显示可用模型。' : catalogState === 'error' ? '暂时无法读取模型目录，已有草稿仍然可以保留。' : '模型目录会自动从服务端读取，密钥不会出现在浏览器。'}</small></div>{catalogState === 'error' ? <button type="button" onClick={() => { setCatalogState('loading'); setCatalogRetryKey((value) => value + 1); }}>重试 <ChevronRight size={14} /></button> : Number(account?.role) >= 5 && onOpenAdmin ? <button type="button" onClick={onOpenAdmin}>{catalogState === 'ready' ? '管理模型' : '去配置'} <ChevronRight size={14} /></button> : null}</div>
            <div className={`cc-prompt-box${promptError ? ' has-error' : ''}`}><textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); if (promptError) setPromptError(''); }} aria-label="描述你的创意" aria-invalid={Boolean(promptError)} aria-describedby={promptError ? 'cc-prompt-error' : undefined} placeholder={managedGeneration ? '描述你的创意，输入关键词...' : '描述你的创意，输入关键词或上传参考图...'} rows={4} /><div className="cc-prompt-box__footer">{!managedGeneration ? <><input ref={referenceInputRef} className="cc-reference-input" type="file" accept="image/*" onChange={(event) => void selectReferenceImage(event)} /><button type="button" aria-label="添加参考素材" onClick={() => referenceInputRef.current?.click()}><Paperclip size={17} /></button>{referenceImage ? <span className="cc-reference-chip"><img src={referenceImage.url} alt="" /><span title={referenceImage.name}>{referenceImage.name}</span><button type="button" aria-label="移除参考图" onClick={() => setReferenceImage(null)}><X size={13} /></button></span> : <span className="cc-reference-name">无参考图</span>}</> : null}<div><label className="cc-parameter-select"><select aria-label="画面比例" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as CreationAspectRatio)}><option value="1:1">1:1</option>{!managedGeneration ? <><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="4:3">4:3</option><option value="3:4">3:4</option></> : null}</select><ChevronDown size={13} /></label><label className="cc-parameter-select"><select aria-label="生成清晰度" value={quality} onChange={(event) => setQuality(event.target.value as CreationQuality)}><option value="standard">标准</option>{!managedGeneration ? <option value="high">高清</option> : null}</select><ChevronDown size={13} /></label></div><button className={`cc-submit${isCreating ? ' is-loading' : ''}`} type="submit" aria-label={isCreating ? '生成中' : '开始生成'} aria-busy={isCreating} disabled={isCreating}>{isCreating ? <LoaderCircle size={18} className="cc-submit__spinner" /> : <ArrowUp size={20} />}</button></div></div>
            {promptError ? <p className="cc-prompt-error" id="cc-prompt-error" role="alert">{promptError}</p> : null}
          </form>
        </section>
        <section className="cc-section" aria-labelledby="cc-recent-title"><div className="cc-section__heading"><h2 id="cc-recent-title">继续创作</h2><button type="button" onClick={onOpenWorks}>查看全部 <ChevronRight size={15} /></button></div>{recentBoards.length ? <div className="cc-project-grid">{recentBoards.map((board, index) => <ProjectCard key={board.id} board={board} image={boardPreviewImages[index % boardPreviewImages.length]} onOpen={() => void onOpenBoard(board.id)} />)}</div> : <button className="cc-empty-project" type="button" onClick={() => void onCreateBoard()}><Grid2X2 size={22} /><span>新建第一个画布</span></button>}</section>
        <section className="cc-section" aria-labelledby="cc-template-title"><div className="cc-section__heading"><h2 id="cc-template-title">精选模板</h2>{onOpenTemplates ? <button type="button" onClick={onOpenTemplates}>查看全部 <ChevronRight size={15} /></button> : null}</div><div className="cc-template-grid">{visibleTemplates.map((template) => <button key={template.title} className="cc-template-card" type="button" onClick={() => void onCreateBoard({ prompt: `使用「${template.title}」模板创作`, mode: 'image', aspectRatio, quality })}><img src={template.image} alt={`${template.title}模板预览`} loading="lazy" /><span>{template.title}</span></button>)}</div></section>
        {normalizedSearch && recentBoards.length === 0 && visibleTemplates.length === 0 ? <p className="cc-search-empty" role="status">没有找到匹配的作品或模板</p> : null}
        {latestTask ? <section className="cc-project-status" aria-label="最近任务"><span className={isActiveTask(latestTask) ? 'is-active' : ''} /><div><strong>{latestTask.title || '最近创作任务'}</strong><small>{taskStatusLabel(latestTask)} · {formatRelativeTime(latestTask.updatedAt)}</small></div><b>{Math.round(latestTask.progress)}%</b></section> : null}
      </main>
    </div>
  </div>;
}
export default CreativeCenterPage;
