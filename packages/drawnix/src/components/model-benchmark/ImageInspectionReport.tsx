import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Input, MessagePlugin } from 'tdesign-react';
import {
  createImageInspectionApiClient,
  isImageInspectionRunActive,
  selectImageInspectionProfile,
  type ServerImageInspectionCase,
  type ServerImageInspectionModelScope,
  type ServerImageInspectionRun,
} from '../../services/image-inspection-api';
import { IMAGE_INSPECTION_MODEL_IDS } from '../../services/image-inspection-pure';
import {
  providerProfilesSettings,
  type ProviderProfile,
} from '../../utils/settings-manager';
import './image-inspection-report.scss';

const DEFAULT_PROMPT =
  '一只棕色兔子坐在绿色草地上，蓝天白云，主体完整且居中，真实摄影风格，画面清晰，不要文字，不要水印';
const CASE_PAGE_SIZE = 100;
const RUN_POLL_INTERVAL_MS = 2500;
const IDLE_POLL_INTERVAL_MS = 15_000;
const MAX_RETRY_INTERVAL_MS = 30_000;
const OFFLINE_RETRY_INTERVAL_MS = 60_000;

interface ImageInspectionReportProps {
  onBack?: () => void;
  autoRunToken?: number;
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending: '待运行',
  running: '巡检中',
  completed: '已完成',
  partial: '部分失败',
  failed: '全部失败',
  stopped: '已停止',
};

const CASE_STATUS_LABELS: Record<string, string> = {
  pending: '等待执行',
  running: '生成中',
  passed: '通过',
  warning: '警告',
  failed: '失败',
  stopped: '已停止',
};

function useProviderProfiles() {
  const [profiles, setProfiles] = useState<ProviderProfile[]>(() =>
    providerProfilesSettings.get()
  );

  useEffect(() => {
    const listener = (next: ProviderProfile[]) => setProfiles(next);
    providerProfilesSettings.addListener(listener);
    return () => providerProfilesSettings.removeListener(listener);
  }, []);

  return profiles;
}

function formatTimestamp(value: number) {
  return value
    ? new Date(value * 1000).toLocaleString('zh-CN', { hour12: false })
    : '--';
}

function formatDuration(value: number) {
  return value > 0 ? `${(value / 1000).toFixed(1)}s` : '--';
}

function runTitle(run: ServerImageInspectionRun) {
  const trigger = run.trigger_type === 'daily' ? '定时' : '手动';
  return `${formatTimestamp(run.created_at)} · ${trigger} #${run.id}`;
}

function getCompletedCount(run: ServerImageInspectionRun | null) {
  if (!run) return 0;
  return (
    run.passed_cases + run.warning_cases + run.failed_cases + run.stopped_cases
  );
}

function getGroupCount(scope: ServerImageInspectionModelScope | null) {
  if (!scope) return 0;
  return new Set(Object.values(scope.groups).flat()).size;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ResultRow({
  entry,
  imageExpanded,
  onImageExpandedChange,
}: {
  entry: ServerImageInspectionCase;
  imageExpanded: boolean;
  onImageExpandedChange: (caseId: number | null) => void;
}) {
  const expectedSize =
    entry.requested_size ||
    (entry.expected_width > 0 && entry.expected_height > 0
      ? `${entry.expected_width}x${entry.expected_height}`
      : '');
  const actualSize =
    entry.actual_width > 0 && entry.actual_height > 0
      ? `${entry.actual_width}x${entry.actual_height}`
      : '--';

  return (
    <tr>
      <td>{formatTimestamp(entry.finished_at || entry.started_at)}</td>
      <td>
        <span className="image-inspection__pill image-inspection__pill--group">
          {entry.group}
        </span>
      </td>
      <td>
        <span className="image-inspection__pill image-inspection__pill--model">
          {entry.model}
        </span>
      </td>
      <td>{formatDuration(entry.duration_ms)}</td>
      <td>
        {entry.aspect_ratio.replace('x', ':')}
        <br />
        {entry.requested_resolution?.toUpperCase() || '默认'}
        {expectedSize ? (
          <>
            <br />
            期望 {expectedSize}
          </>
        ) : null}
        <br />
        实际 {actualSize}
      </td>
      <td>
        <span
          className={`image-inspection__status image-inspection__status--${entry.status}`}
        >
          {CASE_STATUS_LABELS[entry.status] || entry.status}
        </span>
        <div className="image-inspection__message">
          {entry.message || '等待服务端更新'}
        </div>
        {entry.task_id ? <code>任务：{entry.task_id}</code> : null}
      </td>
      <td className="image-inspection__result">
        {entry.image_url ? (
          <>
            <a href={entry.image_url} target="_blank" rel="noreferrer">
              图片 URL
            </a>
            <a
              className="image-inspection__url"
              href={entry.image_url}
              target="_blank"
              rel="noreferrer"
            >
              {entry.image_url}
            </a>
            <details
              open={imageExpanded}
              onToggle={(event) => {
                if (event.currentTarget.open) {
                  onImageExpandedChange(entry.id);
                } else if (imageExpanded) {
                  onImageExpandedChange(null);
                }
              }}
            >
              <summary>查看图片</summary>
              {imageExpanded ? (
                <img
                  src={entry.image_url}
                  alt={`${entry.group} ${entry.model}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
            </details>
          </>
        ) : null}
        <pre>{entry.formula || '等待实际图片与 URL…'}</pre>
        {entry.error ? (
          <div className="image-inspection__error">{entry.error}</div>
        ) : null}
      </td>
    </tr>
  );
}

export function ImageInspectionReport({
  onBack,
  autoRunToken,
}: ImageInspectionReportProps) {
  const profiles = useProviderProfiles();
  const profile = useMemo(
    () => selectImageInspectionProfile(profiles),
    [profiles]
  );
  const client = useMemo(
    () => (profile ? createImageInspectionApiClient(profile) : null),
    [profile]
  );
  const [runs, setRuns] = useState<ServerImageInspectionRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<ServerImageInspectionRun | null>(
    null
  );
  const [cases, setCases] = useState<ServerImageInspectionCase[]>([]);
  const [caseTotal, setCaseTotal] = useState(0);
  const [casePage, setCasePage] = useState(0);
  const [modelScope, setModelScope] =
    useState<ServerImageInspectionModelScope | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedImageCaseId, setExpandedImageCaseId] = useState<number | null>(
    null
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const requestAbortRef = useRef<AbortController | null>(null);
  const actionAbortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedRefreshRef = useRef<{
    immediate?: boolean;
    runId?: number | null;
  } | null>(null);
  const retryCountRef = useRef(0);
  const activeRunIdRef = useRef<number | null>(null);
  const casePageRef = useRef(0);
  const autoRunTokenRef = useRef<number | null>(null);
  const startLockRef = useRef(false);
  const mountedRef = useRef(true);

  activeRunIdRef.current = activeRunId;
  casePageRef.current = casePage;

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback(
    (refreshCallback: () => void, delay: number) => {
      clearPollTimer();
      if (!mountedRef.current || document.visibilityState === 'hidden') return;
      pollTimerRef.current = window.setTimeout(refreshCallback, delay);
    },
    [clearPollTimer]
  );

  const refresh = useCallback(
    async (options?: { immediate?: boolean; runId?: number | null }) => {
      if (!mountedRef.current || !client) return;
      clearPollTimer();
      if (refreshPromiseRef.current) {
        const queued = queuedRefreshRef.current;
        queuedRefreshRef.current = {
          immediate: Boolean(queued?.immediate || options?.immediate),
          runId:
            options?.runId === undefined ? queued?.runId : options.runId,
        };
        await refreshPromiseRef.current;
        return;
      }

      const runRefreshLoop = async () => {
        let nextOptions = options;
        let nextDelay = IDLE_POLL_INTERVAL_MS;
        do {
          const currentOptions = nextOptions;
          queuedRefreshRef.current = null;
          if (currentOptions?.immediate) setIsRefreshing(true);

          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setOnline(false);
            setConnectionError('网络已断开；服务端巡检仍在后台继续运行');
            nextDelay = OFFLINE_RETRY_INTERVAL_MS;
          } else {
            const controller = new AbortController();
            requestAbortRef.current = controller;
            try {
              const nextRuns = await client.listRuns(controller.signal);
              if (controller.signal.aborted) {
                throw new DOMException('aborted', 'AbortError');
              }
              if (!mountedRef.current) return;
              setRuns(nextRuns);
              const requestedRunId =
                currentOptions?.runId === undefined
                  ? activeRunIdRef.current
                  : currentOptions.runId;
              const selectedRun =
                nextRuns.find((run) => run.id === requestedRunId) ||
                nextRuns.find((run) => isImageInspectionRunActive(run.status)) ||
                nextRuns[0] ||
                null;

              if (!selectedRun) {
                activeRunIdRef.current = null;
                setActiveRunId(null);
                setActiveRun(null);
                setCases([]);
                setCaseTotal(0);
                retryCountRef.current = 0;
                setConnectionError(null);
                nextDelay = IDLE_POLL_INTERVAL_MS;
              } else {
                const previousActiveRunId = activeRunIdRef.current;
                if (selectedRun.id !== previousActiveRunId) {
                  activeRunIdRef.current = selectedRun.id;
                  setActiveRunId(selectedRun.id);
                  casePageRef.current = 0;
                  setCasePage(0);
                }
                const requestedPage =
                  selectedRun.id === previousActiveRunId
                    ? casePageRef.current
                    : 0;
                const page = await client.getRun(
                  selectedRun.id,
                  CASE_PAGE_SIZE,
                  requestedPage * CASE_PAGE_SIZE,
                  controller.signal
                );
                if (controller.signal.aborted) {
                  throw new DOMException('aborted', 'AbortError');
                }
                if (!mountedRef.current) return;
                setActiveRun(page.run);
                setRuns((current) =>
                  current.map((run) =>
                    run.id === page.run.id ? page.run : run
                  )
                );
                setCases(page.cases);
                setExpandedImageCaseId(null);
                setCaseTotal(page.caseTotal);
                retryCountRef.current = 0;
                setConnectionError(null);
                setOnline(true);
                nextDelay = isImageInspectionRunActive(page.run.status)
                  ? RUN_POLL_INTERVAL_MS
                  : IDLE_POLL_INTERVAL_MS;
              }
            } catch (error) {
              if (!mountedRef.current) return;
              if (controller.signal.aborted) {
                nextDelay = 0;
              } else {
                retryCountRef.current += 1;
                const message =
                  error instanceof Error ? error.message : '巡检报表同步失败';
                setConnectionError(message);
                nextDelay = Math.min(
                  RUN_POLL_INTERVAL_MS * 2 ** (retryCountRef.current - 1),
                  MAX_RETRY_INTERVAL_MS
                );
              }
            } finally {
              if (requestAbortRef.current === controller) {
                requestAbortRef.current = null;
              }
            }
          }

          if (currentOptions?.immediate && mountedRef.current) {
            setIsRefreshing(false);
          }
          nextOptions = queuedRefreshRef.current || undefined;
          if (
            typeof navigator !== 'undefined' &&
            !navigator.onLine &&
            nextOptions
          ) {
            nextOptions = undefined;
          }
        } while (nextOptions && mountedRef.current);

        scheduleRefresh(() => void refresh(), nextDelay);
      };

      refreshPromiseRef.current = runRefreshLoop().finally(() => {
        refreshPromiseRef.current = null;
        if (mountedRef.current) setIsRefreshing(false);
      });
      await refreshPromiseRef.current;
    },
    [clearPollTimer, client, scheduleRefresh]
  );

  useEffect(() => {
    clearPollTimer();
    requestAbortRef.current?.abort();
    setRuns([]);
    setActiveRunId(null);
    setActiveRun(null);
    setCases([]);
    setCaseTotal(0);
    setCasePage(0);
    setConnectionError(null);
    if (!client) return;
    const controller = new AbortController();
    void client
      .getModels(controller.signal)
      .then(setModelScope)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setConnectionError(
            error instanceof Error ? error.message : '巡检模型范围读取失败'
          );
        }
      });
    void refresh({ immediate: true, runId: null });
    return () => controller.abort();
  }, [clearPollTimer, client, refresh]);

  useEffect(() => {
    const suspendOfflineSync = () => {
      setOnline(false);
      setConnectionError('网络已断开；服务端巡检仍在后台继续运行');
      clearPollTimer();
    };
    const handleConnectivityRefresh = () => {
      const isOnline =
        typeof navigator === 'undefined' ? true : navigator.onLine;
      if (!isOnline) {
        suspendOfflineSync();
        return;
      }
      setOnline(true);
      retryCountRef.current = 0;
      void refresh({ immediate: true });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleConnectivityRefresh();
      } else {
        clearPollTimer();
      }
    };
    window.addEventListener('online', handleConnectivityRefresh);
    window.addEventListener('offline', suspendOfflineSync);
    window.addEventListener('focus', handleConnectivityRefresh);
    window.addEventListener('pageshow', handleConnectivityRefresh);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('online', handleConnectivityRefresh);
      window.removeEventListener('offline', suspendOfflineSync);
      window.removeEventListener('focus', handleConnectivityRefresh);
      window.removeEventListener('pageshow', handleConnectivityRefresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [clearPollTimer, refresh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPollTimer();
      requestAbortRef.current?.abort();
      actionAbortRef.current?.abort();
    };
  }, [clearPollTimer]);

  const handleStart = useCallback(async () => {
    if (!client) {
      MessagePlugin.warning('请先在供应商设置中配置并启用 Tuzi API Token');
      return;
    }
    const running = runs.find((run) => isImageInspectionRunActive(run.status));
    if (running) {
      activeRunIdRef.current = running.id;
      setActiveRunId(running.id);
      MessagePlugin.info('巡检正在后台运行，已打开当前报表');
      void refresh({ immediate: true, runId: running.id });
      return;
    }
    if (startLockRef.current) {
      MessagePlugin.info('巡检正在启动，请稍候');
      return;
    }
    startLockRef.current = true;
    setIsStarting(true);
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    try {
      const run = await client.createRun(prompt.trim(), controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      activeRunIdRef.current = run.id;
      setActiveRunId(run.id);
      setActiveRun(run);
      setCasePage(0);
      MessagePlugin.success(
        `服务端已接管 ${run.total_cases} 个巡检用例，关闭页面也会继续运行`
      );
      await refresh({ immediate: true, runId: run.id });
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const message = error instanceof Error ? error.message : '巡检启动失败';
      MessagePlugin.error(message);
      setConnectionError(message);
    } finally {
      if (actionAbortRef.current === controller) {
        actionAbortRef.current = null;
      }
      startLockRef.current = false;
      if (mountedRef.current) setIsStarting(false);
    }
  }, [client, prompt, refresh, runs]);

  useEffect(() => {
    if (!autoRunToken || autoRunTokenRef.current === autoRunToken || !client) {
      return;
    }
    autoRunTokenRef.current = autoRunToken;
    void handleStart();
  }, [autoRunToken, client, handleStart]);

  const handleStop = async () => {
    if (!client || !activeRun) return;
    setIsStopping(true);
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    try {
      await client.stopRun(activeRun.id, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      MessagePlugin.success('已停止尚未提交的巡检用例');
      await refresh({ immediate: true, runId: activeRun.id });
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      MessagePlugin.error(
        error instanceof Error ? error.message : '停止巡检失败'
      );
    } finally {
      if (actionAbortRef.current === controller) {
        actionAbortRef.current = null;
      }
      if (mountedRef.current) setIsStopping(false);
    }
  };

  const handleExportJson = async () => {
    if (!client || !activeRun) return;
    setIsExporting(true);
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    try {
      const blob = await client.exportRun(activeRun.id, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      downloadBlob(blob, `opentu-image-inspection-${activeRun.id}.json`);
      MessagePlugin.success('完整 JSON 报表已导出');
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      MessagePlugin.error(
        error instanceof Error ? error.message : '导出 JSON 失败'
      );
    } finally {
      if (actionAbortRef.current === controller) {
        actionAbortRef.current = null;
      }
      if (mountedRef.current) setIsExporting(false);
    }
  };

  const handleExportExcel = async () => {
    if (!client || !activeRun) return;
    setIsExporting(true);
    actionAbortRef.current?.abort();
    const controller = new AbortController();
    actionAbortRef.current = controller;
    try {
      const blob = await client.exportRun(activeRun.id, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      const payload = JSON.parse(await blob.text()) as {
        cases?: ServerImageInspectionCase[];
      };
      if (controller.signal.aborted || !mountedRef.current) return;
      const XLSX = await import('xlsx');
      if (controller.signal.aborted || !mountedRef.current) return;
      const rows = (payload.cases || []).map((entry) => ({
        时间: formatTimestamp(entry.finished_at || entry.started_at),
        分组: entry.group,
        模型: entry.model,
        任务ID: entry.task_id,
        请求比例: entry.aspect_ratio.replace('x', ':'),
        请求分辨率: entry.requested_resolution.toUpperCase(),
        期望尺寸: entry.requested_size,
        实际尺寸:
          entry.actual_width > 0 && entry.actual_height > 0
            ? `${entry.actual_width}x${entry.actual_height}`
            : '',
        耗时秒:
          entry.duration_ms > 0
            ? Number((entry.duration_ms / 1000).toFixed(2))
            : '',
        状态: CASE_STATUS_LABELS[entry.status] || entry.status,
        结果说明: entry.message,
        图片URL: entry.image_url,
        计算公式: entry.formula,
        错误: entry.error,
      }));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '生图巡检结果');
      XLSX.writeFile(workbook, `opentu-image-inspection-${activeRun.id}.xlsx`);
      MessagePlugin.success('完整 Excel 报表已导出');
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      MessagePlugin.error(
        error instanceof Error ? error.message : '导出 Excel 失败'
      );
    } finally {
      if (actionAbortRef.current === controller) {
        actionAbortRef.current = null;
      }
      if (mountedRef.current) setIsExporting(false);
    }
  };

  const completedCount = getCompletedCount(activeRun);
  const totalPages = Math.max(1, Math.ceil(caseTotal / CASE_PAGE_SIZE));
  const pageStart = caseTotal ? casePage * CASE_PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(caseTotal, (casePage + 1) * CASE_PAGE_SIZE);
  return (
    <div className="image-inspection">
      <header className="image-inspection__header">
        <div>
          {onBack ? (
            <button
              type="button"
              className="image-inspection__back"
              onClick={onBack}
            >
              ← 返回模型测试
            </button>
          ) : null}
          <h1>OpenTu 生图巡检报表</h1>
          <p>Tuzi 服务端后台运行；关闭、刷新 OpenTu 或短时断网都不会中断。</p>
        </div>
        <div className="image-inspection__header-actions">
          {activeRun ? (
            <>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void handleExportJson()}
              >
                导出 JSON
              </button>
              <button
                type="button"
                disabled={isExporting}
                onClick={() => void handleExportExcel()}
              >
                {isExporting ? '导出中…' : '导出 Excel'}
              </button>
            </>
          ) : null}
          {activeRun && isImageInspectionRunActive(activeRun.status) ? (
            <button
              type="button"
              className="danger"
              disabled={isStopping}
              onClick={() => void handleStop()}
            >
              {isStopping ? '停止中…' : '停止巡检'}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!client || isStarting}
              onClick={() => void handleStart()}
            >
              {isStarting ? '正在创建…' : '立即运行一次'}
            </button>
          )}
        </div>
      </header>

      {!profile ? (
        <div className="image-inspection__connection-warning" role="status">
          未找到已启用的 Tuzi API Token，请先在供应商设置中配置。
        </div>
      ) : !online || connectionError ? (
        <div className="image-inspection__connection-warning" role="status">
          {connectionError || '网络已断开'}；后台巡检不受影响，恢复后自动同步。
        </div>
      ) : null}

      <section className="image-inspection__setup">
        <div className="image-inspection__scope">
          <div className="image-inspection__matrix">
            <strong>{getGroupCount(modelScope)}</strong> 个启用分组
            <span>·</span>
            <strong>
              {modelScope?.models.length || IMAGE_INSPECTION_MODEL_IDS.length}
            </strong>{' '}
            个指定模型
            <span>·</span>
            <strong>{activeRun?.total_cases || 0}</strong> 个实际用例
          </div>
          <details className="image-inspection__model-scope">
            <summary>只测试指定白名单，其他模型由服务端自动跳过</summary>
            <div>
              {(modelScope?.models || IMAGE_INSPECTION_MODEL_IDS).map(
                (modelId) => (
                  <code key={modelId}>{modelId}</code>
                )
              )}
            </div>
          </details>
        </div>
        <Input
          value={prompt}
          onChange={setPrompt}
          placeholder="巡检提示词"
          disabled={Boolean(
            activeRun && isImageInspectionRunActive(activeRun.status)
          )}
        />
      </section>

      <div className="image-inspection__layout">
        <aside className="image-inspection__history">
          <h2>历史报表</h2>
          {runs.length ? (
            runs.map((run) => (
              <div key={run.id} className="image-inspection__history-row">
                <button
                  type="button"
                  className={run.id === activeRunId ? 'active' : ''}
                  onClick={() => {
                    activeRunIdRef.current = run.id;
                    casePageRef.current = 0;
                    setCasePage(0);
                    setActiveRunId(run.id);
                    void refresh({ immediate: true, runId: run.id });
                  }}
                >
                  <span>{runTitle(run)}</span>
                  <small>
                    {RUN_STATUS_LABELS[run.status] || run.status} ·{' '}
                    {run.total_cases} 个用例
                  </small>
                </button>
              </div>
            ))
          ) : (
            <div className="image-inspection__empty-history">
              {client ? '暂无历史巡检报表' : '等待配置 Tuzi API Token'}
            </div>
          )}
        </aside>

        <main className="image-inspection__report">
          <section className="image-inspection__summary">
            <h2>{activeRun ? runTitle(activeRun) : '等待开始巡检'}</h2>
            <p>
              状态：
              {activeRun ? RUN_STATUS_LABELS[activeRun.status] : '--'} ｜ 计划{' '}
              {activeRun?.total_cases || 0} ｜完成 {completedCount} ｜通过{' '}
              {activeRun?.passed_cases || 0} ｜警告{' '}
              {activeRun?.warning_cases || 0} ｜失败{' '}
              {activeRun?.failed_cases || 0}
              {isRefreshing ? ' ｜同步中…' : ''}
            </p>
            {caseTotal > CASE_PAGE_SIZE ? (
              <div className="image-inspection__pagination">
                <button
                  type="button"
                  disabled={casePage === 0}
                  onClick={() => {
                    const nextPage = Math.max(0, casePageRef.current - 1);
                    casePageRef.current = nextPage;
                    setCasePage(nextPage);
                    void refresh({ immediate: true });
                  }}
                >
                  上一页
                </button>
                <span>
                  显示 {pageStart}-{pageEnd} / {caseTotal}（第 {casePage + 1}/
                  {totalPages} 页）
                </span>
                <button
                  type="button"
                  disabled={casePage >= totalPages - 1}
                  onClick={() => {
                    const nextPage = Math.min(
                      totalPages - 1,
                      casePageRef.current + 1
                    );
                    casePageRef.current = nextPage;
                    setCasePage(nextPage);
                    void refresh({ immediate: true });
                  }}
                >
                  下一页
                </button>
              </div>
            ) : null}
          </section>
          <div className="image-inspection__table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>分组</th>
                  <th>模型</th>
                  <th>耗时</th>
                  <th>比例/尺寸</th>
                  <th>状态</th>
                  <th>生成结果与图片 URL</th>
                </tr>
              </thead>
              <tbody>
                {cases.length ? (
                  cases.map((entry) => (
                    <ResultRow
                      key={entry.id}
                      entry={entry}
                      imageExpanded={expandedImageCaseId === entry.id}
                      onImageExpandedChange={setExpandedImageCaseId}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="image-inspection__empty-results">
                      {activeRun
                        ? '等待服务端生成实际图片…'
                        : '点击“立即运行一次”启动后台巡检'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
