import {
  Activity,
  Box,
  Brush,
  ChevronDown,
  ChevronRight,
  Command,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  Headphones,
  ImagePlus,
  Layers3,
  Menu,
  MoreHorizontal,
  MousePointer2,
  PanelRight,
  Redo2,
  Search,
  Scan,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  Type,
  Undo2,
  Upload,
  WandSparkles,
  Waypoints,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AI_INPUT_PREFILL_EVENT,
  type AIInputPrefillEventDetail,
  requestAIInputCreate,
  requestMusicPlayerOpen,
} from '@drawnix/drawnix/ui-events';
import { useWorkspaceRuntime } from '../application/use-workspace-runtime';
import { WorkspaceProjectSwitcher } from './WorkspaceProjectSwitcher';
import { WorkspaceTaskList } from './WorkspaceTaskList';
import {
  WorkspaceComposer,
  type WorkspaceCreationMode,
} from './WorkspaceComposer';
import {
  WorkspaceCommandPalette,
  type WorkspaceCommandItem,
} from './WorkspaceCommandPalette';
import {
  WorkspaceCanvasControls,
  type WorkspaceCanvasAction,
} from './WorkspaceCanvasControls';
import {
  C1_DEFAULT_PROMPT,
  WorkspaceC1Scene,
} from './WorkspaceC1Scene';
import './workspace-shell.scss';

type InspectorTab = 'layers' | 'properties' | 'tasks';
type LayoutPreferences = {
  panelOpen: boolean;
  activeTab: InspectorTab;
  composerOpen: boolean;
};

const layoutStorageKey = 'foxvue.workspace-layout.v1';
const defaultLayout: LayoutPreferences = {
  panelOpen: false,
  activeTab: 'properties',
  composerOpen: true,
};

function readLayoutPreferences(): LayoutPreferences {
  if (typeof window === 'undefined') return defaultLayout;
  try {
    const stored = JSON.parse(window.localStorage.getItem(layoutStorageKey) || 'null');
    if (!stored || typeof stored !== 'object') return defaultLayout;
    return {
      panelOpen: typeof stored.panelOpen === 'boolean' ? stored.panelOpen : false,
      activeTab: ['layers', 'properties', 'tasks'].includes(stored.activeTab)
        ? stored.activeTab
        : 'properties',
      composerOpen: typeof stored.composerOpen === 'boolean' ? stored.composerOpen : true,
    };
  } catch {
    return defaultLayout;
  }
}

type WorkspaceShellProps = {
  children: ReactNode;
  boardName: string;
  boardId?: string | null;
  elementCount: number;
  isReady: boolean;
  onCreateBoard: () => Promise<void>;
  onSwitchBoard?: (boardId: string) => Promise<void>;
  onRenameBoard?: (boardId: string, name: string) => Promise<void>;
  onOpenWorkflows?: () => void;
  onOpenAccount?: () => void;
};

const imageModelOptions = [{ value: 'gpt-image-2', label: 'gpt-image-2' }];
const videoModelOptions = [
  { value: 'seedance-1.5-pro', label: 'Seedance 1.5 Pro' },
];
const quickPromptSuggestions = [
  '创建一个春季护肤品牌主视觉',
  '探索 3 个产品视觉方向',
  '把当前画布扩展为系列海报',
];

export function WorkspaceShell({
  children,
  boardName,
  boardId,
  elementCount,
  isReady,
  onCreateBoard,
  onSwitchBoard,
  onRenameBoard,
  onOpenWorkflows,
  onOpenAccount,
}: WorkspaceShellProps) {
  const [layout] = useState(readLayoutPreferences);
  const [panelOpen, setPanelOpen] = useState(layout.panelOpen);
  const [activeTab, setActiveTab] = useState<InspectorTab>(layout.activeTab);
  const [composerOpen, setComposerOpen] = useState(layout.composerOpen);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [creationMode, setCreationMode] =
    useState<WorkspaceCreationMode>('image');
  const [generationModel, setGenerationModel] = useState('gpt-image-2');
  const [generationRatio, setGenerationRatio] = useState('1x1');
  const [generationResolution, setGenerationResolution] = useState('1k');
  const [generationCount, setGenerationCount] = useState(1);
  const [styleStrength, setStyleStrength] = useState(80);
  const [referenceImages, setReferenceImages] = useState<AIInputPrefillEventDetail['images']>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState('select');
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [projectSwitcherRequest, setProjectSwitcherRequest] = useState(0);
  const [selectedSceneNode, setSelectedSceneNode] = useState('主画板');
  const [starterSceneBoardId, setStarterSceneBoardId] = useState<string | null>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const runtime = useWorkspaceRuntime();
  const currentBoardKey = boardId || '__current-board__';
  const showStarterScene = isReady && elementCount === 0 && starterSceneBoardId === currentBoardKey;

  const commands = useMemo<WorkspaceCommandItem[]>(
    () => [
      {
        label: '开始 AI 生成',
        description: '从一句描述开始，把结果放进当前画布',
        icon: <WandSparkles size={16} />,
        action: 'generation',
      },
      {
        label: '使用 C1 创作模板',
        description: '打开参考图、提示词与生成结果的创作示例',
        icon: <Sparkles size={16} />,
        action: 'starter-c1',
      },
      {
        label: '打开素材库',
        description: '查找最近使用、上传和生成的素材',
        icon: <ImagePlus size={16} />,
        action: 'assets',
      },
      {
        label: '查看生成任务',
        description: '管理进行中、完成和失败的任务',
        icon: <Activity size={16} />,
        action: 'tasks',
      },
      {
        label: '切换创作空间',
        description: '快速打开最近使用的画布',
        icon: <FolderOpen size={16} />,
        action: 'projects',
      },
      {
        label: '新建创作空间',
        description: '创建一个干净的无限画布',
        icon: <FilePlus2 size={16} />,
        action: 'new-board',
      },
      {
        label: '适应画布',
        description: '将全部内容重新居中到可视区域',
        icon: <Scan size={16} />,
        action: 'fit',
      },
      {
        label: '切换专注模式',
        description: '隐藏面板，只保留画布和创作入口',
        icon: <Scan size={16} />,
        action: 'focus',
      },
      {
        label: '打开应用菜单',
        description: '导出、备份、设置和更多工具',
        icon: <MoreHorizontal size={16} />,
        action: 'menu',
      },
    ],
    []
  );
  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? commands.filter((command) =>
          `${command.label} ${command.description}`
            .toLowerCase()
            .includes(normalized)
        )
      : commands;
  }, [commands, query]);
  const activeTaskCount = runtime.tasks.filter(
    (task) => task.status === 'processing' || task.status === 'pending'
  ).length;
  const completedTaskCount = runtime.tasks.filter(
    (task) => task.status === 'completed'
  ).length;

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (paletteOpen) {
      window.setTimeout(() => paletteInputRef.current?.focus(), 0);
      setActiveCommandIndex(0);
    } else {
      setQuery('');
      setActiveCommandIndex(0);
    }
  }, [paletteOpen]);

  useEffect(() => setActiveCommandIndex(0), [query]);

  useEffect(() => {
    try {
      localStorage.setItem(layoutStorageKey, JSON.stringify({ panelOpen, activeTab, composerOpen }));
    } catch {
      // Layout preferences are optional when storage is unavailable.
    }
  }, [panelOpen, activeTab, composerOpen]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  // 创作中心通过事件把请求交接到画布；同步到可见创作助手，避免只回填隐藏输入栏。
  useEffect(() => {
    const handlePrefill = (event: Event) => {
      const detail = (event as CustomEvent<AIInputPrefillEventDetail>).detail;
      if (!detail?.prompt?.trim()) return;

      const nextMode: WorkspaceCreationMode =
        detail.generationType === 'video' ? 'video' : 'image';
      setCreationMode(nextMode);
      const nextModel = detail.model || (nextMode === 'image' ? imageModelOptions[0].value : videoModelOptions[0].value);
      const validModels = nextMode === 'image' ? imageModelOptions : videoModelOptions;
      setGenerationModel(
        validModels.some((option) => option.value === nextModel)
          ? nextModel
          : validModels[0].value
      );
      setPrompt(detail.prompt);
      setReferenceImages(detail.images || []);
      const size = detail.params?.size;
      if (size) setGenerationRatio(size.replace(':', 'x'));
      const quality = detail.params?.quality;
      if (quality) setStyleStrength(quality === 'high' ? 80 : quality === 'low' ? 30 : 55);
      setComposerOpen(true);
      setNotice(detail.images?.length ? '已带入创作描述和参考图' : '已带入创作描述');
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    };

    window.addEventListener(AI_INPUT_PREFILL_EVENT, handlePrefill);
    return () => window.removeEventListener(AI_INPUT_PREFILL_EVENT, handlePrefill);
  }, []);

  const createBoard = async () => {
    if (isCreatingBoard) return;
    setIsCreatingBoard(true);
    try {
      await onCreateBoard();
      setNotice('新的创作空间已创建');
      await runtime.refresh();
    } catch (error) {
      console.error('[Workspace] Failed to create board:', error);
      setNotice('创建失败，请稍后重试');
    } finally {
      setIsCreatingBoard(false);
    }
  };

  const switchBoard = async (nextBoardId: string) => {
    try {
      if (!onSwitchBoard) {
        setNotice('当前页面暂不支持切换空间');
        return;
      }
      await onSwitchBoard(nextBoardId);
      setNotice('已切换创作空间');
      await runtime.refresh();
    } catch (error) {
      console.error('[Workspace] Failed to switch board:', error);
      setNotice('切换失败，请稍后重试');
    }
  };

  const renameBoard = async (nextBoardId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) {
      setNotice('空间名称不能为空');
      return;
    }
    try {
      if (!onRenameBoard) {
        setNotice('当前页面暂不支持重命名');
        return;
      }
      await onRenameBoard(nextBoardId, nextName);
      await runtime.refresh();
      setNotice('创作空间已重命名');
    } catch (error) {
      console.error('[Workspace] Failed to rename board:', error);
      setNotice('重命名失败，请稍后重试');
    }
  };

  const triggerCanvasControl = (label: string) => {
    const control = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        '.next-workspace__canvas input[aria-label], .next-workspace__canvas button[aria-label]'
      )
    ).find((element) => element.getAttribute('aria-label')?.startsWith(label));
    if (!control) {
      setNotice(`${label}当前不可用，请等待画布加载完成`);
      return false;
    }
    control.click();
    return true;
  };

  const handleCanvasAction = (action: WorkspaceCanvasAction) => {
    const labels: Record<WorkspaceCanvasAction, string> = {
      undo: '撤销',
      redo: '重做',
      'zoom-out': '缩小',
      fit: '自适应',
      'zoom-in': '放大',
      minimap: '小地图',
      focus: '专注模式',
    };
    if (action === 'focus') {
      setFocusMode((value) => !value);
      return;
    }
    triggerCanvasControl(labels[action]);
  };

  const activateCanvasTool = (tool: string, label: string) => {
    if (triggerCanvasControl(label)) {
      setActiveTool(tool);
    }
  };

  const runCommand = (command: WorkspaceCommandItem) => {
    setPaletteOpen(false);
    switch (command.action) {
      case 'assets':
        setPanelOpen(true);
        triggerCanvasControl('素材库');
        break;
      case 'tasks':
        setPanelOpen(true);
        setActiveTab('tasks');
        break;
      case 'projects':
        setProjectSwitcherRequest((request) => request + 1);
        break;
      case 'generation':
        setComposerOpen(true);
        window.setTimeout(() => composerInputRef.current?.focus(), 0);
        setNotice('已准备好创作入口');
        break;
      case 'starter-c1':
        openStarterScene();
        break;
      case 'new-board':
        void createBoard();
        break;
      case 'fit':
        handleCanvasAction('fit');
        break;
      case 'focus':
        setFocusMode((value) => !value);
        break;
      case 'menu':
        triggerCanvasControl('应用菜单');
        break;
    }
  };

  const handlePaletteKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveCommandIndex((index) =>
        filteredCommands.length === 0
          ? 0
          : (index + 1) % filteredCommands.length
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveCommandIndex((index) =>
        filteredCommands.length === 0
          ? 0
          : (index - 1 + filteredCommands.length) % filteredCommands.length
      );
    } else if (event.key === 'Enter' && filteredCommands[activeCommandIndex]) {
      event.preventDefault();
      runCommand(filteredCommands[activeCommandIndex]);
    }
  };

  const submitCreation = (value: string) => {
    const images = referenceImages ?? [];
    requestAIInputCreate({
      generationType: creationMode,
      prompt: value,
      model: generationModel,
      ...(images.length ? { images } : {}),
      params:
        creationMode === 'image'
          ? {
              size: generationRatio,
              resolution: generationResolution,
              quality:
                styleStrength >= 75
                  ? 'high'
                  : styleStrength >= 45
                  ? 'medium'
                  : 'low',
            }
          : undefined,
      count: generationCount,
    });
    setActiveTab('tasks');
    setPanelOpen(true);
    setNotice('创作任务已加入队列');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = prompt.trim();
    if (!value) {
      composerInputRef.current?.focus();
      return;
    }
    setPrompt('');
    setReferenceImages([]);
    submitCreation(value);
  };

  const startCopilotSuggestion = (suggestion: string) => {
    setPrompt(suggestion);
    setComposerOpen(true);
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
    setNotice('创作建议已填入输入框');
  };

  const openStarterScene = () => {
    if (!isReady || elementCount > 0) {
      setNotice('C1 示例仅可在空白画布中打开');
      return;
    }
    setStarterSceneBoardId(currentBoardKey);
    setPrompt((current) => current || C1_DEFAULT_PROMPT);
  };

  const handleCreationModeChange = (mode: WorkspaceCreationMode) => {
    setCreationMode(mode);
    setGenerationModel(
      mode === 'image' ? imageModelOptions[0].value : videoModelOptions[0].value
    );
  };

  const shareWorkspace = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice('本地工作区链接已复制');
    } catch (error) {
      console.error('[Workspace] Failed to copy share link:', error);
      setNotice('复制失败，请从地址栏复制链接');
    }
  };

  return (
    <div
      className={`next-workspace next-workspace--canvas-first${focusMode ? ' next-workspace--focus' : ''}${panelOpen ? ' next-workspace--panel-open' : ''}${composerOpen ? ' next-workspace--composer-open' : ''}${showStarterScene ? ' next-workspace--starter' : ''}`}
    >
      <div className="next-workspace__canvas">{children}</div>

      <header className="next-workspace__topbar">
        <div className="next-workspace__brand-lockup">
          <img className="next-workspace__mark" src="/icons/foxvue-mark.png" alt="" width="32" height="32" />
          <span className="next-workspace__brand">狐图 <small>FoxVue</small></span>
          <span className="next-workspace__divider" />
          <WorkspaceProjectSwitcher
            boardName={
              runtime.boards.find((board) => board.id === boardId)?.name ||
              boardName
            }
            currentBoardId={boardId}
            boards={runtime.boards}
            disabled={isCreatingBoard}
            openRequest={projectSwitcherRequest}
            onSelect={(id) => void switchBoard(id)}
            onCreate={() => void createBoard()}
            onRename={(id, name) => void renameBoard(id, name)}
          />
        </div>
        <div className="next-workspace__topbar-actions">
          <span className="next-workspace__save-state">
            <span className="next-workspace__save-dot" />
            {isReady ? '本地已保存' : '正在同步'}
          </span>
          <span className="next-workspace__topbar-divider" aria-hidden="true" />
          <button
            className="next-workspace__icon-button"
            type="button"
            aria-label="撤销"
            title="撤销"
            onClick={() => handleCanvasAction('undo')}
          >
            <Undo2 size={17} />
          </button>
          <button
            className="next-workspace__icon-button"
            type="button"
            aria-label="重做"
            title="重做"
            onClick={() => handleCanvasAction('redo')}
          >
            <Redo2 size={17} />
          </button>
          <button
            className="next-workspace__icon-button"
            type="button"
            aria-label="搜索"
            onClick={() => setPaletteOpen(true)}
          >
            <Search size={17} />
          </button>
          <button
            className={`next-workspace__icon-button${
              focusMode ? ' is-active' : ''
            }`}
            type="button"
            aria-label={focusMode ? '退出专注模式' : '专注模式'}
            title={focusMode ? '退出专注模式' : '专注模式'}
            onClick={() => setFocusMode((value) => !value)}
          >
            <Scan size={17} />
          </button>
          <button
            className="next-workspace__share-button"
            type="button"
            onClick={() => void shareWorkspace()}
          >
            <Upload size={15} /> 分享
          </button>
          <button
            className="next-workspace__export-button"
            type="button"
            onClick={() => {
              triggerCanvasControl('应用菜单');
              setNotice('请从应用菜单选择导出格式');
            }}
          >
            <Download size={15} /> 导出
          </button>
          <button
            className="next-workspace__avatar"
            type="button"
            aria-label="账户菜单"
            onClick={() => onOpenAccount?.()}
          >
            L
          </button>
        </div>
      </header>

      <aside className="next-workspace__rail" aria-label="工作区导航">
        <div className="next-workspace__rail-nav">
          <button
            className="next-workspace__rail-home is-active"
            type="button"
            aria-label="画布"
            aria-current="page"
            disabled
          >
            <Box size={17} />
            <span>画布</span>
          </button>
        </div>

        <div className="next-workspace__rail-group">
          <button
            type="button"
            aria-label="选择"
            className={activeTool === 'select' ? 'is-active' : ''}
            onClick={() => activateCanvasTool('select', '选择')}
          >
            <MousePointer2 size={15} />
            <span>选择</span>
          </button>
          <button
            type="button"
            aria-label="文本"
            className={activeTool === 'text' ? 'is-active' : ''}
            onClick={() => activateCanvasTool('text', '文本')}
          >
            <Type size={15} />
            <span>文本</span>
          </button>
          <button
            type="button"
            aria-label="图片"
            className={activeTool === 'image' ? 'is-active' : ''}
            onClick={() => activateCanvasTool('image', '图片')}
          >
            <ImagePlus size={15} />
            <span>图片</span>
          </button>
          <button
            type="button"
            aria-label="画笔"
            className={activeTool === 'brush' ? 'is-active' : ''}
            onClick={() => activateCanvasTool('brush', '画笔')}
          >
            <Brush size={15} />
            <span>画笔</span>
          </button>
          <button
            type="button"
            aria-label="形状"
            className={activeTool === 'shape' ? 'is-active' : ''}
            onClick={() => activateCanvasTool('shape', '形状')}
          >
            <Shapes size={15} />
            <span>形状</span>
          </button>
          <button
            type="button"
            aria-label="素材库"
            onClick={() => triggerCanvasControl('素材库')}
          >
            <ImagePlus size={15} />
            <span>素材</span>
          </button>
          <button
            type="button"
            aria-label="我的 Workflow"
            onClick={() => onOpenWorkflows?.()}
          >
            <Waypoints size={15} />
            <span>工作流</span>
          </button>
        </div>

        <div className="next-workspace__rail-footer">
          <button
            type="button"
            aria-label="音乐播放器"
            title="音乐播放器"
            onClick={requestMusicPlayerOpen}
          >
            <Headphones size={16} />
            <span>音频</span>
          </button>
          <button
            className="next-workspace__rail-task-button"
            type="button"
            aria-label="任务"
            onClick={() => {
              setPanelOpen(true);
              setActiveTab('tasks');
            }}
          >
            <Activity size={16} />
            <span>任务</span>
            {activeTaskCount > 0 && <em>{activeTaskCount}</em>}
          </button>
          <button
            type="button"
            aria-label="命令面板"
            onClick={() => setPaletteOpen(true)}
          >
            <Command size={16} />
            <span>命令</span>
          </button>
          <button
            type="button"
            aria-label="菜单"
            onClick={() => triggerCanvasControl('应用菜单')}
          >
            <MoreHorizontal size={16} />
            <span>更多</span>
          </button>
        </div>
      </aside>

      <WorkspaceCanvasControls onAction={handleCanvasAction} />
      {showStarterScene && (
        <WorkspaceC1Scene
          prompt={prompt}
          onPromptChange={setPrompt}
          onAddReference={() => activateCanvasTool('image', '图片')}
          onSelectionChange={(label) => {
            setSelectedSceneNode(label);
            setNotice(`已选择${label}节点`);
          }}
        />
      )}
      {isReady && elementCount === 0 && !showStarterScene && (
        <div className="next-workspace__blank-state">
          <span className="next-workspace__blank-mark"><Sparkles size={23} /></span>
          <h1>从空白画布开始</h1>
          <p>自由放置文字、图片和形状，或从一个创作场景开始。</p>
          <div className="next-workspace__blank-actions">
            <button type="button" onClick={() => { setComposerOpen(true); window.setTimeout(() => composerInputRef.current?.focus(), 0); }}>
              <WandSparkles size={16} /> AI 创作
            </button>
            <button type="button" onClick={openStarterScene}>
              <Layers3 size={16} /> 使用 C1 创作模板
            </button>
          </div>
        </div>
      )}
      {showStarterScene && (
        <button className="next-workspace__starter-close" type="button" onClick={() => setStarterSceneBoardId(null)}>
          <X size={15} /> 关闭示例
        </button>
      )}
      {elementCount > 0 && <div className="next-workspace__canvas-hint">
        <span className="next-workspace__canvas-hint-kicker">
          Infinite AI Workspace
        </span>
        <span className="next-workspace__canvas-hint-title">
          把想法放在一起，快速做出下一版
        </span>
        <span className="next-workspace__canvas-hint-meta">
          {elementCount} 个画布元素 · {runtime.boards.length || 1} 个创作空间 ·{' '}
          {activeTaskCount
            ? `${activeTaskCount} 个任务进行中`
            : completedTaskCount
            ? `${completedTaskCount} 个结果已就绪`
            : '准备开始探索'}
        </span>
      </div>}

      <button
        className={`next-workspace__panel-toggle${
          panelOpen ? ' next-workspace__panel-toggle--open' : ''
        }`}
        type="button"
        aria-label={panelOpen ? '收起右侧面板' : '展开右侧面板'}
        onClick={() => setPanelOpen((open) => !open)}
      >
        {panelOpen ? <PanelRight size={17} /> : <SlidersHorizontal size={17} />}
      </button>

      {panelOpen && (
        <aside className="next-workspace__inspector" aria-label="工作区上下文">
          <div
            className="next-workspace__inspector-tabs next-workspace__inspector-tabs--primary"
            role="tablist"
            aria-label="画布检查器"
          >
            <button
              className={activeTab === 'layers' ? 'is-active' : ''}
              type="button"
              onClick={() => setActiveTab('layers')}
              role="tab"
            >
              图层
            </button>
            <button
              className={activeTab === 'properties' ? 'is-active' : ''}
              type="button"
              onClick={() => setActiveTab('properties')}
              role="tab"
            >
              属性
            </button>
            <button
              className={activeTab === 'tasks' ? 'is-active' : ''}
              type="button"
              onClick={() => setActiveTab('tasks')}
              role="tab"
            >
              任务{activeTaskCount > 0 ? ` ${activeTaskCount}` : ''}
            </button>
            <button
              className="next-workspace__inspector-close"
              type="button"
              aria-label="关闭面板"
              title="关闭面板"
              onClick={() => setPanelOpen(false)}
            ><X size={16} /></button>
          </div>

          {activeTab === 'properties' && (
            <div className="next-workspace__inspector-content">
              <section className="next-workspace__property-layer-section">
                <div className="next-workspace__section-heading">
                  <h2>图层</h2>
                  <span>{elementCount} 个元素</span>
                </div>
                <button type="button" onClick={() => handleCanvasAction('fit')}>
                  <Eye size={14} />
                  <span className="next-workspace__layer-thumbnail"><Layers3 size={13} /></span>
                   <strong>{selectedSceneNode}</strong>
                   <span>{elementCount}</span>
                </button>
                <button type="button" onClick={() => setActiveTab('tasks')}>
                  <Eye size={14} />
                  <span className="next-workspace__layer-thumbnail"><Sparkles size={13} /></span>
                  <strong>生成结果</strong>
                  <span>{completedTaskCount}</span>
                </button>
              </section>
              <section className="next-workspace__property-section">
                <h2>画布设置</h2>
                <div className="next-workspace__setting-row">
                  <span>尺寸</span>
                  <div className="next-workspace__setting-pair">
                    <select
                      aria-label="属性面板画面比例"
                      value={generationRatio}
                      onChange={(event) => setGenerationRatio(event.target.value)}
                    >
                      <option value="1x1">1:1</option>
                      <option value="4x3">4:3</option>
                      <option value="3x4">3:4</option>
                      <option value="16x9">16:9</option>
                      <option value="9x16">9:16</option>
                    </select>
                    <select
                      aria-label="属性面板输出分辨率"
                      value={generationResolution}
                      onChange={(event) => setGenerationResolution(event.target.value)}
                    >
                      <option value="1k">1K</option>
                      <option value="2k">2K</option>
                      <option value="4k">4K</option>
                    </select>
                  </div>
                </div>
                <label className="next-workspace__setting-row">
                  <span>模型</span>
                  <select
                    aria-label="属性面板生成模型"
                    value={generationModel}
                    onChange={(event) => setGenerationModel(event.target.value)}
                  >
                    {(creationMode === 'image'
                      ? imageModelOptions
                      : videoModelOptions
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="next-workspace__setting-row next-workspace__setting-row--slider">
                  <span>风格强度</span>
                  <input
                    aria-label="细节强度"
                    type="range"
                    min="20"
                    max="100"
                    step="10"
                    value={styleStrength}
                    onChange={(event) => setStyleStrength(Number(event.target.value))}
                  />
                  <output>{(styleStrength / 100).toFixed(1)}</output>
                </label>
                <label className="next-workspace__setting-row next-workspace__setting-row--slider">
                  <span>生成数量</span>
                  <input
                    aria-label="属性面板生成数量"
                    type="range"
                    min="1"
                    max="4"
                    step="1"
                    value={generationCount}
                    onChange={(event) => setGenerationCount(Number(event.target.value))}
                  />
                  <output>{generationCount}</output>
                </label>
                <button
                  className="next-workspace__advanced-toggle"
                  type="button"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <SlidersHorizontal size={14} />
                  高级设置
                  <ChevronDown size={15} />
                </button>
                {advancedOpen && (
                  <div className="next-workspace__copilot-suggestions" aria-label="创作建议">
                    {quickPromptSuggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion}
                        onClick={() => startCopilotSuggestion(suggestion)}
                      >
                        <span>{suggestion}</span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="next-workspace__generate-button"
                  type="button"
                  onClick={() => {
                    const value = prompt.trim();
                    if (value) {
                      setPrompt('');
                      submitCreation(value);
                    } else {
                      composerInputRef.current?.focus();
                      setNotice('请先输入创作描述');
                    }
                  }}
                >
                  <Sparkles size={16} /> 生成
                </button>
              </section>
              <section className="next-workspace__task-dock">
                <div className="next-workspace__section-heading">
                  <h2>生成任务 ({runtime.tasks.length})</h2>
                  <button type="button" onClick={() => setActiveTab('tasks')}>
                    查看全部
                  </button>
                </div>
                {runtime.tasks.length > 0 ? (
                  <WorkspaceTaskList
                    tasks={runtime.tasks.slice(0, 1)}
                    onCancel={runtime.cancelTask}
                    onRetry={runtime.retryTask}
                  />
                ) : (
                  <div className="next-workspace__task-empty">
                    <WandSparkles size={16} /> 暂无生成任务
                  </div>
                )}
              </section>
            </div>
          )}
          {activeTab === 'layers' && (
            <div className="next-workspace__inspector-content">
              <div className="next-workspace__section-heading">
                <h2>图层</h2>
                  <span>{elementCount} 个元素</span>
              </div>
              <div className="next-workspace__c1-layer-list">
                <div className="is-selected">
                  <Eye size={15} />
                  <span className="next-workspace__layer-thumbnail"><Layers3 size={14} /></span>
                  <strong>当前画布</strong>
                </div>
                {Array.from({ length: Math.min(elementCount, 6) }, (_, index) => (
                  <div key={index}>
                    <Eye size={15} />
                    <span className="next-workspace__layer-thumbnail">{index + 1}</span>
                    <strong>画布元素 {index + 1}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeTab === 'tasks' && (
            <div className="next-workspace__inspector-content">
              <WorkspaceTaskList
                tasks={runtime.tasks}
                onCancel={runtime.cancelTask}
                onRetry={runtime.retryTask}
              />
              <button
                className="next-workspace__back-to-properties"
                type="button"
                onClick={() => setActiveTab('properties')}
              >
                返回属性设置
              </button>
            </div>
          )}
        </aside>
      )}

      {composerOpen ? <WorkspaceComposer
        prompt={prompt}
        mode={creationMode}
        model={generationModel}
        modelOptions={
          creationMode === 'image' ? imageModelOptions : videoModelOptions
        }
        ratio={generationRatio}
        resolution={generationResolution}
        count={generationCount}
        inputRef={composerInputRef}
        onPromptChange={setPrompt}
        onModeChange={handleCreationModeChange}
        onModelChange={setGenerationModel}
        onRatioChange={setGenerationRatio}
        onResolutionChange={setGenerationResolution}
        onCountChange={setGenerationCount}
        onSubmit={handleSubmit}
        onClose={() => setComposerOpen(false)}
      /> : <button className="next-workspace__composer-collapsed" type="button" aria-label="打开 AI 创作助手" onClick={() => { setComposerOpen(true); window.setTimeout(() => composerInputRef.current?.focus(), 0); }}><WandSparkles size={18} /><span>AI 创作</span></button>}
      {notice && (
        <div className="next-workspace__toast" role="status">
          {notice}
        </div>
      )}
      {paletteOpen && (
        <WorkspaceCommandPalette
          commands={filteredCommands}
          query={query}
          activeIndex={activeCommandIndex}
          inputRef={paletteInputRef}
          onQueryChange={setQuery}
          onKeyDown={handlePaletteKeyDown}
          onHover={setActiveCommandIndex}
          onRun={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
