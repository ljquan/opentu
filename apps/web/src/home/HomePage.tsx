import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  Image,
  Images,
  LayoutTemplate,
  Menu,
  Music2,
  Network,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Video,
  Workflow,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAccountSession } from '../account/use-account-session';
import {
  readReferenceImage,
  type CreationMode,
  type CreationReferenceImage,
  type CreationRequest,
} from '../creative-center/creation-request';
import { ModelMarketplace } from './ModelMarketplace';
import type { MarketplaceModel } from './model-marketplace-catalog';
import './home-page.scss';
import './home-night.scss';

type HomePageProps = {
  isStarting?: boolean;
  onStartCreating: (request?: CreationRequest) => Promise<void>;
  onOpenMusicStation?: () => void;
  onOpenModel?: (model: MarketplaceModel) => void;
  onOpenWorks?: () => void;
  onOpenWorkflows?: () => void;
  onOpenAdmin?: () => void;
  onLogin?: () => void;
};

type Template = {
  title: string;
  description: string;
  category: string;
  image: string;
  icon: typeof Image;
};

const templates: Template[] = [
  {
    title: '产品主视觉',
    description: '从产品定位到一组可比较的视觉方向',
    category: '视觉设计',
    image: '/product_showcase/aitu-01.png',
    icon: Image,
  },
  {
    title: '品牌 Campaign',
    description: '整理参考图、文案、色彩与多尺寸输出',
    category: '品牌内容',
    image: '/product_showcase/aitu-02.png',
    icon: Images,
  },
  {
    title: '流程与方案',
    description: '把复杂需求拆成清晰可执行的步骤',
    category: '结构整理',
    image: '/product_showcase/流程图.gif',
    icon: Network,
  },
  {
    title: '灵感与知识',
    description: '收集资料、想法和提示词，持续完善方案',
    category: '思维整理',
    image: '/product_showcase/思维导图.gif',
    icon: LayoutTemplate,
  },
];

const recentWorks = [
  {
    title: '春季护肤品牌视觉',
    meta: '图片创作案例',
    image: '/product_showcase/aitu-03.png',
  },
  {
    title: '产品发布流程',
    meta: '流程图案例',
    image: '/product_showcase/case-1.png',
  },
  {
    title: '灵感收集',
    meta: '思维导图案例',
    image: '/product_showcase/case-2.png',
  },
];

export function HomePage({
  isStarting = false,
  onStartCreating,
  onOpenMusicStation,
  onOpenModel,
  onOpenWorks,
  onOpenWorkflows,
  onOpenAdmin,
  onLogin,
}: HomePageProps) {
  const { account, checking: checkingAccount } = useAccountSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchNotice, setSearchNotice] = useState('');
  const [creationMode, setCreationMode] = useState<CreationMode>('image');
  const [referenceImage, setReferenceImage] =
    useState<CreationReferenceImage | null>(null);
  const [activeSection, setActiveSection] = useState('home');
  const [modelMarketplaceOpen, setModelMarketplaceOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleTemplates = useMemo(
    () =>
      templates.filter((template) =>
        `${template.title} ${template.description} ${template.category}`
          .toLowerCase()
          .includes(normalizedSearch)
      ),
    [normalizedSearch]
  );
  const visibleWorks = useMemo(
    () =>
      recentWorks.filter((work) =>
        `${work.title} ${work.meta}`.toLowerCase().includes(normalizedSearch)
      ),
    [normalizedSearch]
  );

  const openModelMarketplace = () => {
    setModelMarketplaceOpen(true);
    const url = new URL(window.location.href);
    url.hash = 'models';
    window.history.pushState({ ...window.history.state, modelMarketplace: true }, '', url.toString());
  };

  const closeModelMarketplace = () => {
    setModelMarketplaceOpen(false);
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState({ ...window.history.state, modelMarketplace: false }, '', url.toString());
  };

  useEffect(() => {
    const getScrollBehavior = (): ScrollBehavior =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';

    const scrollToSection = (sectionId: string) => {
      const target = document.getElementById(sectionId);
      if (!target) return;

      const top = Math.max(
        0,
        target.getBoundingClientRect().top + window.scrollY - 88
      );
      window.scrollTo({ top, behavior: getScrollBehavior() });
    };

    const syncHashTarget = () => {
      const targetId = window.location.hash.slice(1);
      if (!targetId) return;
      window.requestAnimationFrame(() => scrollToSection(targetId));
    };

    syncHashTarget();
    if (window.location.hash === '#models') {
      setModelMarketplaceOpen(true);
    }
    window.addEventListener('hashchange', syncHashTarget);
    const handlePopState = () => {
      const hash = window.location.hash.slice(1);
      setModelMarketplaceOpen(hash === 'models');
      if (hash) {
        window.requestAnimationFrame(() => scrollToSection(hash));
      }
    };
    window.addEventListener('popstate', handlePopState);

    const observedSections = ['home-start', 'composer', 'models', 'templates']
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!('IntersectionObserver' in window)) {
      return () => {
        window.removeEventListener('hashchange', syncHashTarget);
        window.removeEventListener('popstate', handlePopState);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const section = visible[0]?.target.id;
        if (section) setActiveSection(section);
      },
      { root: null, rootMargin: '-96px 0px -58% 0px', threshold: [0, 0.2] }
    );
    observedSections.forEach((section) => observer.observe(section));

    return () => {
      window.removeEventListener('hashchange', syncHashTarget);
      window.removeEventListener('popstate', handlePopState);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (event.target as HTMLElement | null)?.tagName || ''
        )
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const start = (request?: CreationRequest) => {
    void onStartCreating(
      request || {
        prompt: prompt.trim(),
        mode: creationMode,
        referenceImages: referenceImage ? [referenceImage] : undefined,
      }
    );
  };

  const goToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      if (!target) return;

      const top = Math.max(
        0,
        target.getBoundingClientRect().top + window.scrollY - 88
      );
      window.scrollTo({
        top,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });

      const url = new URL(window.location.href);
      url.hash = sectionId;
      window.history.replaceState(
        { ...window.history.state, homeSection: sectionId },
        '',
        url.toString()
      );
    });
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    start();
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = normalizedSearch;
    if (!value) {
      searchInputRef.current?.focus();
      return;
    }
    if (/(模型|model)/i.test(value)) {
      openModelMarketplace();
      setSearchNotice('已打开模型广场');
      return;
    }
    if (/(工作流|workflow)/i.test(value)) {
      onOpenWorkflows?.();
      return;
    }
    if (/(音乐|歌曲|music|audio)/i.test(value)) {
      onOpenMusicStation?.();
      return;
    }
    if (/(作品|画布|work|canvas)/i.test(value)) {
      onOpenWorks?.();
      return;
    }
    if (visibleTemplates.length > 0) {
      goToSection('templates');
      setSearchNotice(`找到 ${visibleTemplates.length} 个匹配模板`);
      return;
    }
    if (visibleWorks.length > 0) {
      goToSection('recent');
      setSearchNotice(`找到 ${visibleWorks.length} 个匹配案例`);
      return;
    }
    setSearchNotice('没有找到匹配内容，请换一个关键词');
  };

  const selectReferenceImage = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setReferenceImage(await readReferenceImage(file));
    } catch (error) {
      setSearchNotice(error instanceof Error ? error.message : '参考图片读取失败');
    }
  };

  const chooseTemplate = (template: Template) => {
    setPrompt(`使用「${template.title}」开始创作`);
    start({
      prompt: `使用「${template.title}」开始创作`,
      mode: 'image',
      referenceImages: referenceImage ? [referenceImage] : undefined,
    });
  };

  return (
    <div className="opentu-home">
      <div className="home-offer">
        <span className="home-offer__dot" />
        新用户登录即享创作体验
        <button type="button" onClick={onLogin}>
          查看权益 <ArrowUpRight size={13} />
        </button>
      </div>

      <header className="home-header">
        <a className="home-brand" href="/" aria-label="狐图 FoxVue 首页">
          <img className="home-brand__mark" src="/icons/foxvue-mark.png" alt="" width="27" height="27" />
          <span>狐图 <small>FoxVue</small></span>
        </a>
        <form className="home-search" onSubmit={submitSearch} role="search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={searchInputRef}
            aria-label="搜索模板、作品和工作流"
            placeholder="搜索模板、作品和工作流"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchNotice('');
            }}
          />
          <kbd>/</kbd>
        </form>
        <div className="home-header__actions">
          {Number(account?.role) >= 5 && onOpenAdmin ? (
            <button className="home-admin-button" type="button" onClick={onOpenAdmin}>
              <Settings2 size={15} /> 模型配置
            </button>
          ) : null}
          <button className="home-login-button" type="button" onClick={onLogin}>
            {checkingAccount ? '读取账户中' : account ? account.username : '登录 / 注册'}
          </button>
          <button
            className="home-menu"
            type="button"
            aria-label={mobileMenuOpen ? '关闭导航菜单' : '打开导航菜单'}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <div className="home-layout">
        <aside className={`home-sidebar${mobileMenuOpen ? ' is-open' : ''}`}>
          <nav className="home-sidebar__nav" aria-label="主导航">
            <p className="home-sidebar__label">工作台</p>
            <button
              className={
                activeSection === 'home' || activeSection === 'home-start'
                  ? 'is-active'
                  : ''
              }
              type="button"
              onClick={() => goToSection('home-start')}
            >
              <Sparkles size={17} /> 首页
            </button>
            <button type="button" onClick={() => start()}>
              <FilePlus2 size={17} /> 新建创作
            </button>
            <button
              className={activeSection === 'recent' ? 'is-active' : ''}
              type="button"
              onClick={() => onOpenWorks?.()}
            >
              <Images size={17} /> 我的作品
            </button>
            <button type="button" onClick={() => goToSection('composer')}>
              <Activity size={17} /> 创作入口
            </button>

            <p className="home-sidebar__label home-sidebar__label--spaced">
              探索
            </p>
            <button
              className={activeSection === 'models' ? 'is-active' : ''}
              type="button"
              onClick={openModelMarketplace}
            >
              <Sparkles size={17} /> 模型广场
            </button>
            <button type="button" onClick={() => onOpenMusicStation?.()}>
              <Music2 size={17} /> 音乐台
            </button>
            <button
              className={activeSection === 'templates' ? 'is-active' : ''}
              type="button"
              onClick={() => goToSection('templates')}
            >
              <LayoutTemplate size={17} /> 模板中心
            </button>
            <button type="button" onClick={() => onOpenWorkflows?.()}>
              <Workflow size={17} /> 工作流
            </button>
            {Number(account?.role) >= 5 && onOpenAdmin ? (
              <>
                <p className="home-sidebar__label home-sidebar__label--spaced">管理</p>
                <button type="button" className="home-sidebar__admin" onClick={onOpenAdmin}>
                  <Settings2 size={17} /> 模型配置
                  <span className="home-sidebar__badge">ADMIN</span>
                </button>
              </>
            ) : null}
          </nav>
          <div className="home-sidebar__bottom">
            <div className="home-sidebar__mobile-account">
              {Number(account?.role) >= 5 && onOpenAdmin ? <button type="button" onClick={onOpenAdmin}>模型配置</button> : null}
              <button type="button" onClick={onLogin}>{account ? '账户设置' : '登录 / 注册'}</button>
            </div>
            <button className="home-account-hint" type="button" onClick={onLogin}>
              <img className="home-account-hint__avatar" src="/icons/foxvue-mark.png" alt="" width="28" height="28" />
              <span>
                <strong>{checkingAccount ? '正在读取' : account?.username || '未登录'}</strong>
                <small>{account ? Number(account.role) >= 5 ? '管理员账户' : '创作者账户' : '登录后同步作品'}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          </div>
        </aside>

        <main className="home-main" id="home-start">
          <div className="home-sky-intro">
          <div className="home-main__topline">
            <div>
              <p className="home-eyebrow">狐图工作台 · FoxVue</p>
              <h1>今天，想做点什么？</h1>
            </div>
            <div className="home-status">
              <span />
              平台服务正常
            </div>
          </div>

          <section
            className="home-composer"
            id="composer"
            aria-labelledby="composer-title"
          >
            <div className="home-composer__heading">
              <div>
                <span className="home-composer__icon">
                  <Sparkles size={17} />
                </span>
                <h2 id="composer-title">描述你的想法</h2>
              </div>
              <button className="home-model-picker" type="button" onClick={openModelMarketplace}>
                FoxVue Image <ChevronDown size={15} />
              </button>
            </div>
            <form onSubmit={submitPrompt}>
              <textarea
                aria-label="描述你的创作想法"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="例如：为一款春季护肤产品做一组清透、自然的电商主视觉"
                rows={3}
              />
              <div className="home-composer__footer">
                <div className="home-composer__tools">
                  <input
                    ref={referenceInputRef}
                    className="home-reference-input"
                    type="file"
                    accept="image/*"
                    onChange={(event) => void selectReferenceImage(event)}
                  />
                  <button type="button" aria-label="上传参考素材" onClick={() => referenceInputRef.current?.click()}>
                    <Upload size={17} />
                  </button>
                  <span>{referenceImage ? referenceImage.name : '可添加参考素材'}</span>
                  <label className="home-mode-picker">
                    {creationMode === 'video' ? <Video size={16} /> : <Image size={16} />}
                    <select
                      aria-label="创作模式"
                      value={creationMode}
                      onChange={(event) => setCreationMode(event.target.value as CreationMode)}
                    >
                      <option value="image">图片</option>
                      <option value="video">视频</option>
                    </select>
                    <ChevronDown size={13} />
                  </label>
                </div>
                <button
                  className="home-create-button"
                  type="submit"
                  disabled={isStarting}
                >
                  {isStarting ? '正在打开...' : '开始创作'}
                  {!isStarting && <ArrowUpRight size={16} />}
                </button>
              </div>
            </form>
          </section>

          {searchNotice && <p className="home-search-notice" role="status">{searchNotice}</p>}
          <div className="home-quick-start">
            <span>快速开始</span>
            <button type="button" onClick={() => start({ mode: 'canvas' })}>
              <FilePlus2 size={15} /> 空白画布
            </button>
            <button type="button" onClick={() => goToSection('templates')}>
              <LayoutTemplate size={15} /> 从模板开始
            </button>
            <button type="button" onClick={() => start({ mode: 'video' })}>
              <Video size={15} /> 视频创作
            </button>
          </div>
          </div>

          <ModelMarketplace
            onStartCreating={onStartCreating}
            onOpenMusicStation={onOpenMusicStation}
            onOpenModel={onOpenModel}
            onOpenAdmin={onOpenAdmin}
            canManageProviders={Boolean(account && Number(account.role) >= 5)}
            isOpen={modelMarketplaceOpen}
            onClose={closeModelMarketplace}
          />

          <section
            className="home-section home-section--templates"
            id="templates"
            aria-labelledby="templates-title"
          >
            <div className="home-section__heading">
              <div>
                <h2 id="templates-title">从模板开始</h2>
                <span>适合常见创作任务的现成起点</span>
              </div>
              <span className="home-text-button" aria-label={`${visibleTemplates.length} 个可用模板`}>
                {visibleTemplates.length} 个模板
              </span>
            </div>
            <div className="home-template-grid">
              {visibleTemplates.map((template) => {
                const Icon = template.icon;
                return (
                  <button
                    className="home-template-card"
                    type="button"
                    key={template.title}
                    onClick={() => chooseTemplate(template)}
                  >
                    <span className="home-template-card__image">
                      <img
                        src={template.image}
                        alt={`${template.title} 模板预览`}
                        loading="lazy"
                      />
                    </span>
                    <span className="home-template-card__body">
                      <span className="home-template-card__meta">
                        <Icon size={13} /> {template.category}
                      </span>
                      <strong>{template.title}</strong>
                      <small>{template.description}</small>
                      <span className="home-template-card__action">
                        使用模板 <ArrowUpRight size={14} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="home-lower-grid">
            <section
              className="home-section home-section--recent"
              id="recent"
              aria-labelledby="recent-title"
            >
              <div className="home-section__heading">
                <div>
                  <h2 id="recent-title">创作案例</h2>
                  <span>结果可以在画布中继续编辑和组织</span>
                </div>
                <button
                  type="button"
                  className="home-icon-button"
                  aria-label="查看全部作品"
                  onClick={() => onOpenWorks?.()}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <div className="home-recent-list">
                {visibleWorks.map((work) => (
                  <button
                    type="button"
                    key={work.title}
                    onClick={() => onOpenWorks?.()}
                  >
                    <img src={work.image} alt="" />
                    <span>
                      <strong>{work.title}</strong>
                      <small>{work.meta}</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            </section>
            <section
              className="home-section home-section--workflow"
              id="workflow"
              aria-labelledby="workflow-title"
            >
              <div className="home-section__heading">
                <div>
                  <h2 id="workflow-title">工作流</h2>
                  <span>把重复的步骤交给流程</span>
                </div>
                <Workflow size={19} />
              </div>
              <button
                className="home-workflow-entry"
                type="button"
                onClick={() => onOpenWorkflows?.()}
              >
                <span className="home-workflow-entry__icon">
                  <Workflow size={19} />
                </span>
                <span>
                  <strong>创建你的第一个工作流</strong>
                  <small>连接模型、素材和输出结果</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

export default HomePage;
