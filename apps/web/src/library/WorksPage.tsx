import {
  ArrowLeft,
  ArrowUpRight,
  AudioLines,
  Clock3,
  FilePlus2,
  FolderOpen,
  Grid2X2,
  Image,
  LayoutGrid,
  List,
  Menu,
  Search,
  Sparkles,
  SortDesc,
  Video,
  Workflow,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAccountSession } from '../account/use-account-session';
import { useWorkspaceRuntime } from '../workspace/application/use-workspace-runtime';
import type { WorkspaceTaskSummary } from '../workspace/domain/workspace-model';
import './library-pages.scss';
import './works-curated.scss';

type WorksPageProps = {
  onGoHome: () => void;
  onGoCreativeCenter: () => void;
  onOpenWorkflows: () => void;
  onOpenBoard: (boardId: string) => Promise<void>;
  onOpenAccount: () => void;
};

type WorkFilter = 'all' | 'canvas' | 'image' | 'video' | 'audio';
type WorkSort = 'recent' | 'oldest';

type WorkEntry = {
  id: string;
  title: string;
  detail: string;
  kind: WorkFilter;
  image: string;
  status?: string;
  timestamp: number;
  boardId?: string;
  taskId?: string;
};

const workImages = [
  '/product_showcase/aitu-03.png',
  '/product_showcase/case-1.png',
  '/product_showcase/case-2.png',
  '/product_showcase/aitu-05.png',
];

const filters: Array<{ value: WorkFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'canvas', label: '画布' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音乐' },
];

function taskKind(task: WorkspaceTaskSummary): WorkFilter {
  if (task.type === 'video') return 'video';
  if (task.type === 'audio') return 'audio';
  return 'image';
}

function taskLabel(task: WorkspaceTaskSummary): string {
  if (task.type === 'video') return '视频创作';
  if (task.type === 'audio') return '音乐创作';
  return '图片创作';
}

function statusLabel(task: WorkspaceTaskSummary): string {
  if (task.status === 'completed') return '已完成';
  if (task.status === 'failed') return '失败';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'processing')
    return `生成中 ${Math.round(task.progress)}%`;
  return '排队中';
}

function timeLabel(timestamp: number): string {
  if (!timestamp) return '刚刚更新';
  const hours = Math.floor(Math.max(0, Date.now() - timestamp) / 3600000);
  if (hours < 1) return '刚刚更新';
  if (hours < 24) return `${hours} 小时前更新`;
  return `${Math.floor(hours / 24)} 天前更新`;
}

function groupLabel(timestamp: number): '今天' | '本周' | '更早' {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 24 * 60 * 60 * 1000) return '今天';
  if (elapsed < 7 * 24 * 60 * 60 * 1000) return '本周';
  return '更早';
}

function WorkCard({ entry, onOpen }: { entry: WorkEntry; onOpen: () => void }) {
  const KindIcon =
    entry.kind === 'canvas'
      ? Grid2X2
      : entry.kind === 'audio'
      ? AudioLines
      : entry.kind === 'video'
      ? Video
      : Image;
  return (
    <button className="library-work-card" type="button" onClick={onOpen}>
      <div className="library-work-card__image">
        <img src={entry.image} alt="" loading="lazy" />
        <span className="library-work-card__open">
          {entry.taskId ? '查看任务' : '打开作品'} <ArrowUpRight size={14} />
        </span>
        <span className={`library-work-card__kind is-${entry.kind}`}>
          <KindIcon size={13} />
          {entry.kind === 'canvas'
            ? '画布'
            : entry.kind === 'audio'
            ? '音乐'
            : entry.kind === 'video'
            ? '视频'
            : '图片'}
        </span>
        {entry.status && (
          <span className="library-work-card__status">{entry.status}</span>
        )}
      </div>
      <div className="library-work-card__body">
        <strong>{entry.title}</strong>
        <span>{entry.detail}</span>
        <small>{timeLabel(entry.timestamp)}</small>
      </div>
      <ArrowUpRight className="library-work-card__arrow" size={17} />
    </button>
  );
}

export function WorksPage({
  onGoHome,
  onGoCreativeCenter,
  onOpenWorkflows,
  onOpenBoard,
  onOpenAccount,
}: WorksPageProps) {
  const { boards, tasks, cancelTask, retryTask } = useWorkspaceRuntime();
  const { account, checking: checkingAccount } = useAccountSession();
  const [filter, setFilter] = useState<WorkFilter>('all');
  const [query, setQuery] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<WorkSort>('recent');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);

  const entries = useMemo<WorkEntry[]>(() => {
    const canvasEntries = boards.map((board, index) => ({
      id: `board:${board.id}`,
      title: board.name || '未命名画布',
      detail: '无限画布 · 可继续编辑',
      kind: 'canvas' as const,
      image: workImages[index % workImages.length],
      timestamp: board.updatedAt,
      boardId: board.id,
    }));
    const taskEntries = tasks.map((task, index) => ({
      id: `task:${task.id}`,
      title: task.title || '未命名创作',
      detail: taskLabel(task),
      kind: taskKind(task),
      image: task.resultUrl || workImages[index % workImages.length],
      status: statusLabel(task),
      timestamp: task.updatedAt || task.createdAt,
      taskId: task.id,
    }));
    return [...canvasEntries, ...taskEntries].sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }, [boards, tasks]);

  const visibleEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesFilter = filter === 'all' || entry.kind === filter;
      const matchesQuery =
        !normalized ||
        `${entry.title} ${entry.detail}`.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    }).sort((a, b) => sort === 'recent' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
  }, [entries, filter, query, sort]);

  const groupedEntries = useMemo(() => {
    const groups = new Map<'今天' | '本周' | '更早', WorkEntry[]>();
    visibleEntries.forEach((entry) => {
      const label = groupLabel(entry.timestamp);
      groups.set(label, [...(groups.get(label) || []), entry]);
    });
    const order: Array<'今天' | '本周' | '更早'> = sort === 'recent'
      ? ['今天', '本周', '更早']
      : ['更早', '本周', '今天'];
    return order.flatMap((label) => {
      const items = groups.get(label);
      return items?.length ? [{ label, items }] : [];
    });
  }, [visibleEntries, sort]);

  const canvasCount = entries.filter((entry) => entry.kind === 'canvas').length;
  const mediaCount = entries.length - canvasCount;
  const activeCount = tasks.filter(
    (task) => task.status === 'processing' || task.status === 'pending'
  ).length;

  return (
    <div className="library-page library-page--works">
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
          <button type="button" className="is-active" aria-current="page" disabled>
            <FolderOpen size={17} /> 我的作品
          </button>
          <button type="button" onClick={() => onGoCreativeCenter()}>
            <FilePlus2 size={17} /> 创作中心
          </button>
          <button type="button" onClick={onOpenWorkflows}>
            <Workflow size={17} /> 工作流
          </button>
        </nav>
        <div className="library-sidebar__bottom">
            <img className="library-sidebar__account-mark" src="/icons/foxvue-mark.png" alt="" width="28" height="28" />
          <span>
            <strong>{checkingAccount ? '正在读取…' : account?.username || '未登录'}</strong>
            <small>{account ? '作品已同步到当前账户' : '登录后同步作品'}</small>
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
          <div className="library-intro__copy">
            <span className="library-kicker"><Sparkles size={13} /> YOUR LIBRARY</span>
            <h1>我的作品</h1>
            <p>所有画布、生成结果和正在进行的创作，都在这里继续。</p>
            <div className="library-intro__stats" aria-label="作品统计">
              <span><strong>{entries.length}</strong> 全部作品</span>
              <span><strong>{canvasCount}</strong> 创作画布</span>
              <span><strong>{mediaCount}</strong> 生成内容</span>
              {activeCount > 0 && <span className="is-active"><strong>{activeCount}</strong> 正在生成</span>}
            </div>
          </div>
          <button
            className="library-primary-action"
            type="button"
            onClick={() => onGoCreativeCenter()}
          >
            <FilePlus2 size={16} /> 新建创作
          </button>
        </section>

        <div className="library-toolbar">
          <div
            className="library-filter-tabs"
            role="tablist"
            aria-label="作品分类"
          >
            {filters.map((item) => (
              <button
                key={item.value}
                className={filter === item.value ? 'is-active' : ''}
                type="button"
                role="tab"
                aria-selected={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="library-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索作品"
              aria-label="搜索作品"
            />
          </label>
          <label className="library-sort">
            <SortDesc size={16} aria-hidden="true" />
            <select
              aria-label="作品排序"
              value={sort}
              onChange={(event) => setSort(event.target.value as WorkSort)}
            >
              <option value="recent">按最近更新</option>
              <option value="oldest">按最早更新</option>
            </select>
          </label>
          <div
            className="library-view-toggle"
            role="group"
            aria-label="视图模式"
          >
            <button
              className={view === 'grid' ? 'is-active' : ''}
              type="button"
              aria-label="网格视图"
              onClick={() => setView('grid')}
            >
              <Grid2X2 size={16} />
            </button>
            <button
              className={view === 'list' ? 'is-active' : ''}
              type="button"
              aria-label="列表视图"
              onClick={() => setView('list')}
            >
              <List size={17} />
            </button>
          </div>
        </div>

        {visibleEntries.length > 0 ? (
          <div className="library-work-groups">
            {groupedEntries.map((group) => (
              <section className="library-work-group" key={group.label} aria-labelledby={`works-${group.label}`}>
                <div className="library-work-group__heading">
                  <h2 id={`works-${group.label}`}>{group.label}</h2>
                  <span>{group.items.length} 个作品</span>
                </div>
                <div className={`library-work-grid${view === 'list' ? ' is-list' : ''}`}>
                  {group.items.map((entry) => (
                    <WorkCard
                      key={entry.id}
                      entry={entry}
                      onOpen={() => entry.boardId ? void onOpenBoard(entry.boardId) : setSelectedTaskId(entry.taskId || null)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="library-empty">
            <div className="library-empty__visual" aria-hidden="true">
              <span><Image size={24} /></span>
              <span><Grid2X2 size={27} /></span>
              <span><Video size={23} /></span>
            </div>
            <div className="library-empty__copy">
              <Clock3 size={20} />
              <strong>{query || filter !== 'all' ? '没有匹配的作品' : '第一件作品，从这里开始'}</strong>
              <span>{query || filter !== 'all' ? '换个关键词或分类继续查找。' : '开启一个画布，让灵感在这里逐渐成形。'}</span>
              <button type="button" onClick={() => onGoCreativeCenter()}>
                进入创作中心 <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        )}
      </main>
      {selectedTask && (
        <div className="library-task-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedTaskId(null);
        }}>
          <section className="library-task-detail" role="dialog" aria-modal="true" aria-label="创作任务详情">
            <header>
              <div><small>{taskLabel(selectedTask)}</small><h2>{selectedTask.title}</h2></div>
              <button type="button" aria-label="关闭任务详情" onClick={() => setSelectedTaskId(null)}><X size={18} /></button>
            </header>
            {selectedTask.resultUrl && selectedTask.status === 'completed' ? (
              <div className="library-task-detail__result">
                {selectedTask.type === 'video' ? <video controls src={selectedTask.resultUrl} /> :
                  selectedTask.type === 'audio' ? <audio controls src={selectedTask.resultUrl} /> :
                  <img src={selectedTask.resultUrl} alt={selectedTask.title} />}
              </div>
            ) : <p className="library-task-detail__state">{statusLabel(selectedTask)}</p>}
            {selectedTask.prompt && <p className="library-task-detail__prompt">{selectedTask.prompt}</p>}
            {selectedTask.errorMessage && <p className="library-task-detail__error" role="alert">{selectedTask.errorMessage}</p>}
            <footer>
              {(selectedTask.status === 'pending' || selectedTask.status === 'processing') &&
                <button type="button" onClick={() => { cancelTask(selectedTask.id); setSelectedTaskId(null); }}>取消任务</button>}
              {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled') &&
                <button type="button" onClick={() => { retryTask(selectedTask.id); setSelectedTaskId(null); }}>重试任务</button>}
              <button type="button" onClick={() => setSelectedTaskId(null)}>关闭</button>
            </footer>
          </section>
        </div>
      )}
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

export default WorksPage;
