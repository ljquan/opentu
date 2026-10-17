import {
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  Check,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  Menu,
  Plus,
  Search,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CreationRequest } from '../creative-center/creation-request';
import { useAccountSession } from '../account/use-account-session';
import './library-pages.scss';
import './workflows-graphite.scss';

type WorkflowsPageProps = {
  onGoHome: () => void;
  onGoCreativeCenter: (request?: CreationRequest) => void;
  onOpenWorks: () => void;
  onOpenAccount: () => void;
};

type WorkflowRecord = {
  id: string;
  title: string;
  description: string;
  category: string;
  steps: string[];
  image: string;
  draft?: boolean;
};

const workflowStorageKey = 'opentu.workflow-drafts.v1';

const curatedWorkflows: WorkflowRecord[] = [
  {
    id: 'brand-visual',
    title: '品牌视觉探索',
    description: '从一句方向开始，整理参考图、色彩和三组视觉方案。',
    category: '视觉设计',
    steps: ['灵感整理', '图像生成', '画布编排'],
    image: '/product_showcase/aitu-01.png',
  },
  {
    id: 'product-launch',
    title: '产品发布内容',
    description: '把产品信息拆成主视觉、社交尺寸和发布文案。',
    category: '品牌内容',
    steps: ['信息提取', '视觉延展', '输出检查'],
    image: '/product_showcase/aitu-02.png',
  },
  {
    id: 'research-board',
    title: '研究与方案',
    description: '收集资料，形成可讨论、可继续编辑的结构化方案。',
    category: '结构整理',
    steps: ['资料收集', '观点归纳', '流程输出'],
    image: '/product_showcase/流程图.gif',
  },
  {
    id: 'music-release',
    title: '音乐发布准备',
    description: '从音乐草稿到封面、歌词和发布信息，一次整理完成。',
    category: '音乐创作',
    steps: ['音乐生成', '封面设计', '发布整理'],
    image: '/product_showcase/aitu-06.png',
  },
];

function readDrafts(): WorkflowRecord[] {
  try {
    const raw = localStorage.getItem(workflowStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is WorkflowRecord =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as WorkflowRecord).id === 'string' &&
        typeof (item as WorkflowRecord).title === 'string' &&
        typeof (item as WorkflowRecord).description === 'string' &&
        Array.isArray((item as WorkflowRecord).steps) &&
        (item as WorkflowRecord).draft === true
    );
  } catch {
    return [];
  }
}

function WorkflowCard({
  item,
  onUse,
  onDelete,
}: {
  item: WorkflowRecord;
  onUse: () => void;
  onDelete?: () => void;
}) {
  return (
    <article className="library-flow-card">
      <div className="library-flow-card__image">
        <img src={item.image} alt="" loading="lazy" />
        {item.draft && (
          <span className="library-flow-card__draft">我的草稿</span>
        )}
      </div>
      <div className="library-flow-card__body">
        <span className="library-flow-card__category">{item.category}</span>
        <h2>{item.title}</h2>
        <p>{item.description}</p>
        <div className="library-flow-card__steps">
          {item.steps.map((step) => (
            <span key={step}>
              <Check size={12} />
              {step}
            </span>
          ))}
        </div>
        <div className="library-flow-card__actions">
          <button type="button" onClick={() => onUse()}>
            {item.draft ? '继续编辑' : '使用工作流'} <ArrowUpRight size={15} />
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={`删除${item.title}`}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function WorkflowsPage({
  onGoHome,
  onGoCreativeCenter,
  onOpenWorks,
  onOpenAccount,
}: WorkflowsPageProps) {
  const { account, checking: checkingAccount } = useAccountSession();
  const [drafts, setDrafts] = useState<WorkflowRecord[]>(readDrafts);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const categories = [
    '全部',
    '我的工作流',
    ...new Set(curatedWorkflows.map((item) => item.category)),
  ];
  const matchesFilters = (item: WorkflowRecord) => {
    const haystack =
      `${item.title} ${item.description} ${item.category}`.toLowerCase();
    return (
      (!query.trim() || haystack.includes(query.trim().toLowerCase())) &&
      (category === '全部' || item.category === category)
    );
  };
  const visibleDrafts = drafts.filter(matchesFilters);
  const visibleCurated = curatedWorkflows.filter(matchesFilters);

  const saveDrafts = (nextDrafts: WorkflowRecord[]) => {
    setDrafts(nextDrafts);
    try {
      localStorage.setItem(workflowStorageKey, JSON.stringify(nextDrafts));
    } catch (error) {
      console.warn('[WorkflowsPage] Failed to save workflow drafts:', error);
    }
  };

  const createDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || !description.trim()) return;
    const next: WorkflowRecord = {
      id: `draft-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      category: '我的工作流',
      steps: ['待配置模型', '待添加素材', '待设置输出'],
      image: '/product_showcase/case-2.png',
      draft: true,
    };
    const nextDrafts = [next, ...drafts];
    saveDrafts(nextDrafts);
    setTitle('');
    setDescription('');
    setShowCreate(false);
  };

  return (
    <div className="library-page library-page--workflows">
      <aside className={`library-sidebar${mobileNavOpen ? ' is-open' : ''}`}>
        <div className="library-sidebar__brand">
          <button type="button" onClick={onGoHome} aria-label="返回首页">
            <img src="/icons/foxvue-mark.png" alt="" width="28" height="28" />
          </button>
          <strong>狐图 <small>FoxVue</small></strong>
        </div>
        <nav aria-label="平台导航">
          <button type="button" onClick={onGoHome}>
            <LayoutGrid size={17} /> 首页
          </button>
          <button type="button" onClick={onOpenWorks}>
            <FolderOpen size={17} /> 我的作品
          </button>
          <button type="button" onClick={() => onGoCreativeCenter()}>
            <FilePlus2 size={17} /> 创作中心
          </button>
          <button type="button" className="is-active" aria-current="page" disabled>
            <Workflow size={17} /> 工作流
          </button>
        </nav>
        <div className="library-sidebar__bottom">
          <img className="library-sidebar__account-mark" src="/icons/foxvue-mark.png" alt="" width="28" height="28" />
          <span>
            <strong>{checkingAccount ? '正在读取…' : account?.username || '未登录'}</strong>
            <small>{account ? '工作流草稿已同步' : '登录后同步工作流'}</small>
          </span>
        </div>
      </aside>
      <main className="library-main">
        <header className="library-header">
          <button
            className="library-mobile-menu"
            type="button"
            aria-label="打开导航菜单"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={19} />
          </button>
          <button className="library-back" type="button" onClick={onGoHome}>
            <ArrowLeft size={17} /> 返回首页
          </button>
          <div className="library-header__actions">
            <button type="button" onClick={onOpenAccount}>账户</button>
              <button className="library-avatar" type="button" aria-label="账户菜单" onClick={onOpenAccount}>
                <img src="/icons/foxvue-mark.png" alt="" width="31" height="31" />
              </button>
          </div>
        </header>
        <section className="library-intro">
          <div>
            <span className="library-kicker">WORKFLOW LIBRARY</span>
            <h1>工作流</h1>
            <p>把常用的步骤整理成可复用的创作路径，开始时少一点重复设置。</p>
          </div>
          <button
            className="library-primary-action"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={16} /> 新建工作流
          </button>
        </section>
        <div className="library-toolbar">
          <div
            className="library-filter-tabs"
            role="tablist"
            aria-label="工作流分类"
          >
            {categories.map((item) => (
              <button
                key={item}
                className={category === item ? 'is-active' : ''}
                type="button"
                role="tab"
                aria-selected={category === item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="library-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索工作流"
              aria-label="搜索工作流"
            />
          </label>
        </div>
        {showCreate && (
          <form className="library-create-flow" onSubmit={createDraft}>
            <div>
              <span className="library-kicker">NEW WORKFLOW</span>
              <h2>建立一个新的创作路径</h2>
            </div>
            <label>
              名称
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：春季产品视觉"
                required
              />
            </label>
            <label>
              描述
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="说明这个工作流要完成什么"
                rows={3}
                required
              />
            </label>
            <div className="library-create-flow__actions">
              <button type="button" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button type="submit">
                <Plus size={15} />
                保存草稿
              </button>
            </div>
          </form>
        )}
        {visibleDrafts.length > 0 && (
          <section className="library-flow-section">
            <div className="library-section-heading">
              <div>
                <span className="library-kicker">YOUR FLOWS</span>
                <h2>我的工作流</h2>
              </div>
              <span>{visibleDrafts.length} 个草稿</span>
            </div>
            <div className="library-flow-grid">
              {visibleDrafts.map((item) => (
                <WorkflowCard
                  key={item.id}
                  item={item}
                  onUse={() => onGoCreativeCenter({ prompt: item.description, mode: 'canvas' })}
                  onDelete={() =>
                    saveDrafts(drafts.filter((draft) => draft.id !== item.id))
                  }
                />
              ))}
            </div>
          </section>
        )}
        {visibleCurated.length > 0 && (
          <section className="library-flow-section">
            <div className="library-section-heading">
              <div>
                <span className="library-kicker">CURATED PATHS</span>
                <h2>精选工作流</h2>
              </div>
              <span>{visibleCurated.length} 个路径</span>
            </div>
            <div className="library-flow-grid">
              {visibleCurated.map((item) => (
                <WorkflowCard
                  key={item.id}
                  item={item}
                  onUse={() => onGoCreativeCenter({ prompt: item.description, mode: 'canvas' })}
                />
              ))}
            </div>
          </section>
        )}
        {visibleDrafts.length === 0 && visibleCurated.length === 0 && (
          <div className="library-empty">
            <Boxes size={23} />
            <strong>没有找到工作流</strong>
            <span>换一个关键词试试看。</span>
          </div>
        )}
      </main>
      {mobileNavOpen && (
        <button
          className="library-sidebar__scrim"
          type="button"
          aria-label="关闭导航菜单"
          onClick={() => setMobileNavOpen(false)}
        >
          <X size={1} />
        </button>
      )}
    </div>
  );
}

export default WorkflowsPage;
