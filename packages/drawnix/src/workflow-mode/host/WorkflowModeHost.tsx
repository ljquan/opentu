import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, RotateCw, Maximize2, ImagePlus, Video, BookOpen, Images, Settings2 } from 'lucide-react';
import './workflow-host.scss';
import {
  MODEL_DEFAULTS_REQUEST,
  MODEL_DEFAULTS_RESPONSE,
} from '../shared/model-defaults';
import { readModelDefaults } from './model-defaults';
import { NATIVE_MODELS_REQUEST, NATIVE_MODELS_RESPONSE, OPEN_PROVIDER_SETTINGS, GENERATE_REQUEST, GENERATE_RESPONSE, GENERATE_CANCEL, isGenerationRequest } from '../shared/generation-bridge';
import { readNativeModels } from './native-models';
import { generateNative } from './native-generation';
import { safeTextError } from '../../services/media-executor/text-response';

const workflowNavigation = [
  { path: 'canvas', label: '我的画布', icon: Maximize2 },
  { path: 'image', label: '生图工作台', icon: ImagePlus },
  { path: 'video', label: '视频创作台', icon: Video },
  { path: 'prompts', label: '提示词库', icon: BookOpen },
  { path: 'assets', label: '我的资产', icon: Images },
  { path: 'config', label: '配置', icon: Settings2 },
];

export function WorkflowModeHost({
  open,
  onExit,
  onOpenProviderSettings,
}: {
  open: boolean;
  onExit: () => void;
  onOpenProviderSettings?: (profileId?: string | null) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const openProviderSettingsRef = useRef(onOpenProviderSettings);
  openProviderSettingsRef.current = onOpenProviderSettings;
  useEffect(() => {
    if (!open) return;
    let current = true;
    void readNativeModels().then((payload) => {
      if (current) frameRef.current?.contentWindow?.postMessage({ type: NATIVE_MODELS_RESPONSE, payload }, window.location.origin);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [open]);
  const [activePage, setActivePage] = useState('canvas');
  const removeNavigationListener = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => removeNavigationListener.current?.(), []);
  const syncFrameNavigation = () => {
    removeNavigationListener.current?.();
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    const sync = () => setActivePage(frame.location.hash.replace(/^#\//, '').split('/')[0] || 'canvas');
    sync();
    frame.addEventListener('hashchange', sync);
    removeNavigationListener.current = () => frame.removeEventListener('hashchange', sync);
  };
  useEffect(() => {
    const pending = new Map<string, AbortController>();
    const receive = async (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (
        !frame ||
        event.source !== frame ||
        event.origin !== window.location.origin
      )
        return;
      const { type, requestId, payload: request } = event.data || {};
      if (type === OPEN_PROVIDER_SETTINGS) {
        const profileId = event.data.profileId;
        if (profileId === undefined || profileId === null || typeof profileId === 'string') openProviderSettingsRef.current?.(profileId);
        return;
      }
      if (type === GENERATE_CANCEL && typeof requestId === 'string') {
        pending.get(requestId)?.abort();
        return;
      }
      if (type === GENERATE_REQUEST) {
        if (typeof requestId !== 'string' || pending.has(requestId)) return;
        if (!isGenerationRequest(request)) {
          frame.postMessage({ type: GENERATE_RESPONSE, requestId, error: '生成参数无效。' }, window.location.origin);
          return;
        }
        const controller = new AbortController();
        pending.set(requestId, controller);
        try {
          const payload = await generateNative(request, controller.signal);
          if (!controller.signal.aborted) frame.postMessage({ type: GENERATE_RESPONSE, requestId, payload }, window.location.origin);
        } catch (error) {
          if (!controller.signal.aborted) frame.postMessage({ type: GENERATE_RESPONSE, requestId, error: request.capability === 'text' ? safeTextError(error).message : 'OpenTu 生成失败，请检查渠道模型绑定、额度和请求参数。' }, window.location.origin);
        } finally {
          pending.delete(requestId);
        }
        return;
      }
      if (type !== MODEL_DEFAULTS_REQUEST && type !== NATIVE_MODELS_REQUEST) return;
      const responseType = type === NATIVE_MODELS_REQUEST ? NATIVE_MODELS_RESPONSE : MODEL_DEFAULTS_RESPONSE;
      try {
        const payload = type === NATIVE_MODELS_REQUEST ? await readNativeModels() : await readModelDefaults();
        if (frameRef.current?.contentWindow === frame) {
          frame.postMessage(
            { type: responseType, payload },
            window.location.origin
          );
        }
      } catch {
        frame.postMessage(
          { type: responseType, error: true },
          window.location.origin
        );
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      pending.forEach((controller) => controller.abort());
    };
  }, []);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useEffect(() => {
    if (!open || status !== 'ready') return;
    let active = true;
    void readNativeModels().then((payload) => {
      if (active) frameRef.current?.contentWindow?.postMessage({ type: NATIVE_MODELS_RESPONSE, payload }, window.location.origin);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [open, status]);
  useEffect(() => {
    if (!mounted) return;
    const controller = new AbortController();
    setStatus('loading');
    fetch('/workflow-app/index.html', {
      signal: controller.signal,
      cache: 'no-cache',
    })
      .then(async (response) => {
        if (
          !response.ok ||
          !(await response.text()).includes('opentu-workflow-app')
        ) {
          throw new Error('Workflow build unavailable');
        }
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [mounted, attempt]);
  if (!mounted) return null;
  return createPortal(
    <section className="workflow-host" hidden={!open} aria-label="工作流模式">
      <header className="workflow-host__header">
        <button className="workflow-host__back" type="button" onClick={onExit} title="返回普通画布">
          <ArrowLeft size={18} />
          返回画布
        </button>
        <nav className="workflow-host__navigation" aria-label="工作流导航">
          {workflowNavigation.map(({ path, label, icon: Icon }) => (
            <button key={path} type="button" aria-current={activePage === path ? 'page' : undefined} disabled={status !== 'ready'} onClick={() => {
              const frame = frameRef.current?.contentWindow;
              if (frame) frame.location.hash = `/${path}`;
            }}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </nav>
      </header>
      {status === 'ready' ? (
        <iframe
          ref={frameRef}
          onLoad={syncFrameNavigation}
          key={attempt}
          title="Infinite Canvas 工作流"
          src="/workflow-app/index.html#/canvas"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      ) : (
        <div className="workflow-host__status" role="status">
          {status === 'loading' ? '正在加载工作流…' : '工作流资源加载失败'}
          {status === 'error' && (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RotateCw size={18} />
              重试
            </button>
          )}
        </div>
      )}
    </section>,
    document.body
  );
}
