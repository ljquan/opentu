import { Component, lazy, Suspense, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Maximize2, ImagePlus, Video, BookOpen, Images, Settings2, Rows3 } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { navigateWorkflow, subscribeWorkflowNavigation } from './workflow-navigation';
import './workflow-host.scss';

const WorkflowApp = lazy(() => import('../web/src/WorkflowApp').then(module => ({ default: module.WorkflowApp })));
const workflowNavigation = [
  { path: 'canvas', label: '我的画布', icon: Maximize2 },
  { path: 'image', label: '生图工作台', icon: ImagePlus },
  { path: 'video', label: '视频创作台', icon: Video },
  { path: 'prompts', label: '提示词库', icon: BookOpen },
  { path: 'assets', label: '我的资产', icon: Images },
  { path: 'config', label: '配置', icon: Settings2 },
  { path: 'batch-generation', label: '批量生成', icon: Rows3 },
];

class WorkflowErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="workflow-host__status" role="alert">工作流加载失败，请返回画布或刷新页面重试。现有本地数据不会删除。</div> : this.props.children;
  }
}

export function WorkflowModeHost({ open, onExit, onOpenProviderSettings }: {
  open: boolean;
  onExit: () => void;
  onOpenProviderSettings?: (profileId?: string | null) => void;
}) {
  const pathname = useSyncExternalStore(subscribeWorkflowNavigation, () => window.location.pathname);
  const activePage = pathname.slice('/workflow/'.length).split('/')[0] || 'canvas';
  return createPortal(
    <section className="workflow-host" hidden={!open} aria-label="工作流模式">
      <header className="workflow-host__header">
        <nav className="workflow-host__navigation" aria-label="工作流导航">
          {workflowNavigation.map(({ path, label, icon: Icon }) => (
            <button key={path} type="button" aria-current={activePage === path ? 'page' : undefined} onClick={() => navigateWorkflow(`/workflow/${path}`)}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="workflow-host__back" type="button" onClick={onExit} title="返回普通画布" aria-label="返回画布">
          <ArrowLeft size={18} /><span>返回画布</span>
        </button>
      </header>
      {open && <WorkflowErrorBoundary>
          <Suspense fallback={activePage === 'docs' ? null : <div className="workflow-host__status" role="status">正在加载工作流…</div>}>
            <WorkflowApp onOpenProviderSettings={onOpenProviderSettings} />
          </Suspense>
        </WorkflowErrorBoundary>}
    </section>, document.body,
  );
}
