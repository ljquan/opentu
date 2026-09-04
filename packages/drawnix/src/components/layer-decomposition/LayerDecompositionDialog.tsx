import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, MessagePlugin, Progress } from 'tdesign-react';
import { Layers3, X } from 'lucide-react';
import type { PlaitBoard } from '@plait/core';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useDrawnix } from '../../hooks/use-drawnix';
import {
  createLayerDecompositionApiClient,
  insertLayerDecomposition,
  LayerDecompositionCorrectionRequiredError,
  type LayerBoundingBoxTuple,
  type LayerDecompositionMode,
  type LayerDecompositionProgress,
  type LayerDecompositionResponse,
} from '../../services/layer-decomposition';
import './layer-decomposition-dialog.scss';

interface LayerDecompositionDialogProps {
  open: boolean;
  board: PlaitBoard;
  sourceElementId: string;
  imageUrl: string;
  language: 'zh' | 'en';
  automatic?: boolean;
  onClose: () => void;
}

const PHASE_LABELS: Record<string, { zh: string; en: string }> = {
  queued: { zh: '等待处理', en: 'Queued' },
  recognizing: { zh: '识别对象', en: 'Recognizing' },
  extracting: { zh: '提取图层', en: 'Extracting' },
  inpainting: { zh: '补全背景', en: 'Rebuilding background' },
  quality_check: { zh: '校验画面', en: 'Validating' },
  validating: { zh: '校验画面', en: 'Validating' },
  correcting: { zh: '等待修正', en: 'Correction needed' },
  completed: { zh: '处理完成', en: 'Completed' },
  applying: { zh: '写入画布', en: 'Applying to canvas' },
};

const MODES: Array<{
  value: LayerDecompositionMode;
  zh: string;
  en: string;
}> = [
  { value: 'auto', zh: '自动识别', en: 'Automatic' },
  { value: 'prompt', zh: '描述指定', en: 'By description' },
  { value: 'bbox', zh: '框选区域', en: 'By bounding box' },
];

const CORRECTION_ACTIONS = [
  { value: 'add' as const, zh: '新增', en: 'Add' },
  { value: 'remove' as const, zh: '移除', en: 'Remove' },
  { value: 'replace' as const, zh: '替换', en: 'Replace' },
];

function parseBoundingBox(
  values: readonly string[],
  errorMessage: string
): LayerBoundingBoxTuple {
  const coordinates = values.map((value) => Number(value));
  if (
    coordinates.length !== 4 ||
    coordinates.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1000
    ) ||
    coordinates[2] <= coordinates[0] ||
    coordinates[3] <= coordinates[1]
  ) {
    throw new Error(errorMessage);
  }
  return coordinates as LayerBoundingBoxTuple;
}

export const LayerDecompositionDialog: React.FC<
  LayerDecompositionDialogProps
> = ({
  open,
  board,
  sourceElementId,
  imageUrl,
  language,
  automatic = false,
  onClose,
}) => {
  const { board: activeBoard } = useDrawnix();
  const [mode, setMode] = useState<LayerDecompositionMode>('auto');
  const [prompt, setPrompt] = useState('');
  const [bbox, setBbox] = useState(['0', '0', '1000', '1000']);
  const [maxLayers, setMaxLayers] = useState(16);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('queued');
  const [result, setResult] = useState<LayerDecompositionResponse | null>(null);
  const [needsCorrection, setNeedsCorrection] = useState(false);
  const [correctionPrompt, setCorrectionPrompt] = useState('');
  const [correctionAction, setCorrectionAction] = useState<
    'add' | 'remove' | 'replace'
  >('replace');
  const [correctionLayer, setCorrectionLayer] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const taskIdRef = useRef<string | null>(null);
  const autoStartedRef = useRef(false);
  const activeBoardRef = useRef(activeBoard);
  const isZh = language === 'zh';

  useEffect(() => {
    activeBoardRef.current = activeBoard;
  }, [activeBoard]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      taskIdRef.current = null;
      setProcessing(false);
      setProgress(0);
      setPhase('queued');
      setResult(null);
      setNeedsCorrection(false);
      setCorrectionPrompt('');
      autoStartedRef.current = false;
    }
    return () => abortRef.current?.abort();
  }, [open]);

  const ensureSourceIsActive = useCallback(() => {
    if (activeBoardRef.current !== board) {
      throw new Error(
        isZh
          ? '画板已切换，请重新选择图片'
          : 'Board changed; select the image again'
      );
    }
    if (!board.children.some((element) => element.id === sourceElementId)) {
      throw new Error(
        isZh ? '源图片已不存在' : 'Source image no longer exists'
      );
    }
  }, [board, isZh, sourceElementId]);

  const handleProgress = useCallback((item: LayerDecompositionProgress) => {
    taskIdRef.current = item.taskId;
    setProgress(item.progress);
    setPhase(item.phase || item.status);
  }, []);

  const cancel = useCallback(async () => {
    const taskId = taskIdRef.current;
    abortRef.current?.abort();
    if (taskId && processing) {
      try {
        await createLayerDecompositionApiClient().cancel(taskId);
      } catch {
        // 本地取消立即生效；服务端任务可能已自然结束。
      }
    }
    close();
  }, [close, processing]);

  const buildPrompt = useCallback((): string | undefined => {
    if (mode === 'auto') return undefined;
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      throw new Error(
        isZh ? '请填写需要识别的对象' : 'Describe the target object'
      );
    }
    if (mode === 'prompt') return normalizedPrompt;
    const region = parseBoundingBox(
      bbox,
      isZh
        ? '区域坐标需为 0-1000 内的有效矩形'
        : 'Bounding box must be a valid rectangle within 0-1000'
    );
    return `${normalizedPrompt}\n<bbox>${region.join(' ')}</bbox>`;
  }, [bbox, isZh, mode, prompt]);

  const runTask = useCallback(
    async (
      operation: (
        client: ReturnType<typeof createLayerDecompositionApiClient>,
        signal: AbortSignal
      ) => Promise<LayerDecompositionResponse>
    ) => {
      if (processing || runningRef.current) return;
      try {
        ensureSourceIsActive();
      } catch (error) {
        MessagePlugin.warning(
          error instanceof Error ? error.message : String(error)
        );
        close();
        return;
      }

      const controller = new AbortController();
      runningRef.current = true;
      abortRef.current = controller;
      setProcessing(true);
      setProgress(0);
      setPhase('queued');
      try {
        const response = await operation(
          createLayerDecompositionApiClient(),
          controller.signal
        );
        if (response.resultKind === 'test') {
          MessagePlugin.warning(
            isZh
              ? '当前为测试后端，未接入真实 AI 分层模型；源图片未修改'
              : 'The test backend has no real AI layer model; the source image is unchanged'
          );
          if (automatic) close();
          return;
        }
        setResult(response);
        setNeedsCorrection(false);
        setProgress(100);
        if (automatic) {
          setPhase('applying');
          ensureSourceIsActive();
          await insertLayerDecomposition(board, sourceElementId, response, {
            signal: controller.signal,
            boardGuard: () =>
              activeBoardRef.current === board &&
              board.children.some((element) => element.id === sourceElementId),
          });
          MessagePlugin.success(
            isZh
              ? `已生成 ${response.layers.length + 1} 个可编辑图层`
              : `Created ${response.layers.length + 1} editable layers`
          );
          close();
        } else {
          setPhase('completed');
        }
      } catch (error) {
        if (error instanceof LayerDecompositionCorrectionRequiredError) {
          if (automatic) {
            MessagePlugin.warning(
              isZh
                ? '分层质量未通过，源图片保持不变'
                : 'Layer quality check failed; the source image is unchanged'
            );
            close();
            return;
          }
          taskIdRef.current = error.taskId;
          setNeedsCorrection(true);
          setPhase('correcting');
          return;
        }
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        MessagePlugin.error(
          error instanceof Error
            ? error.message
            : isZh
            ? '图片分层失败'
            : 'Layer decomposition failed'
        );
        if (automatic) close();
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        runningRef.current = false;
        setProcessing(false);
      }
    },
    [
      automatic,
      board,
      close,
      ensureSourceIsActive,
      isZh,
      processing,
      sourceElementId,
    ]
  );

  const submit = useCallback(async () => {
    let targetPrompt: string | undefined;
    try {
      targetPrompt = buildPrompt();
    } catch (error) {
      MessagePlugin.warning(
        error instanceof Error ? error.message : String(error)
      );
      return;
    }
    taskIdRef.current = null;
    await runTask((client, signal) =>
      client.decompose(
        {
          image: imageUrl,
          ...(targetPrompt ? { prompt: targetPrompt } : {}),
          mode: mode === 'auto' ? 'auto' : 'prompt',
          maxLayers,
        },
        { signal, onProgress: handleProgress }
      )
    );
  }, [buildPrompt, handleProgress, imageUrl, maxLayers, mode, runTask]);

  useEffect(() => {
    if (!open || !automatic || autoStartedRef.current) return;
    const timer = window.setTimeout(() => {
      if (autoStartedRef.current) return;
      autoStartedRef.current = true;
      void submit();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [automatic, open, submit]);

  const correct = useCallback(async () => {
    const taskId = taskIdRef.current;
    const normalizedPrompt = correctionPrompt.trim();
    if (!taskId || !normalizedPrompt) {
      MessagePlugin.warning(
        isZh ? '请填写修正说明' : 'Describe the correction'
      );
      return;
    }
    let correctionBox: LayerBoundingBoxTuple | undefined;
    if (mode === 'bbox') {
      try {
        correctionBox = parseBoundingBox(
          bbox,
          isZh ? '请检查修正区域坐标' : 'Check the correction bounding box'
        );
      } catch (error) {
        MessagePlugin.warning(
          error instanceof Error ? error.message : String(error)
        );
        return;
      }
    }
    const layerZIndex = correctionLayer.trim()
      ? Number(correctionLayer)
      : undefined;
    if (
      layerZIndex !== undefined &&
      (!Number.isInteger(layerZIndex) || layerZIndex < 1 || layerZIndex > 16)
    ) {
      MessagePlugin.warning(
        isZh ? '图层序号需为 1-16 的整数' : 'Layer index must be 1-16'
      );
      return;
    }
    await runTask((client, signal) =>
      client.correct(
        taskId,
        {
          prompt: normalizedPrompt,
          action: correctionAction,
          ...(layerZIndex === undefined ? {} : { layerZIndex }),
          ...(correctionBox ? { boundingBox: correctionBox } : {}),
        },
        { signal, onProgress: handleProgress }
      )
    );
  }, [
    bbox,
    correctionAction,
    correctionLayer,
    correctionPrompt,
    handleProgress,
    isZh,
    mode,
    runTask,
  ]);

  const applyResult = useCallback(async () => {
    if (!result || processing) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setProcessing(true);
    setPhase('applying');
    try {
      ensureSourceIsActive();
      await insertLayerDecomposition(board, sourceElementId, result, {
        signal: controller.signal,
        boardGuard: () =>
          activeBoardRef.current === board &&
          board.children.some((element) => element.id === sourceElementId),
      });
      MessagePlugin.success(
        isZh
          ? `已生成 ${result.layers.length + 1} 个可编辑图层`
          : `Created ${result.layers.length + 1} editable layers`
      );
      onClose();
    } catch (error) {
      if (!controller.signal.aborted) {
        MessagePlugin.error(
          error instanceof Error ? error.message : String(error)
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProcessing(false);
    }
  }, [
    board,
    ensureSourceIsActive,
    isZh,
    onClose,
    processing,
    result,
    sourceElementId,
  ]);

  const phaseLabel = PHASE_LABELS[phase]?.[language] || phase;
  const primaryAction = result
    ? applyResult
    : needsCorrection
    ? correct
    : submit;
  const primaryLabel = result
    ? isZh
      ? '应用到画布'
      : 'Apply to canvas'
    : needsCorrection
    ? isZh
      ? '提交修正'
      : 'Submit correction'
    : isZh
    ? '开始分层'
    : 'Create layers';

  return (
    <ConfirmDialog
      open={open}
      title={
        <span className="layer-decomposition-dialog__title">
          <Layers3 size={18} />
          {isZh ? 'AI 图片分层' : 'AI Image Layers'}
        </span>
      }
      className="layer-decomposition-dialog"
      closeOnConfirm={false}
      closeOnCancel={false}
      confirmDisabled={processing}
      onConfirm={primaryAction}
      onCancel={processing ? cancel : close}
      onOpenChange={(nextOpen) =>
        !nextOpen && (processing ? cancel() : close())
      }
      footer={
        automatic ? (
          <div className="layer-decomposition-dialog__footer">
            <Button
              variant="outline"
              icon={processing ? <X size={15} /> : undefined}
              onClick={processing ? cancel : close}
            >
              {processing
                ? isZh
                  ? '取消任务'
                  : 'Cancel task'
                : isZh
                ? '取消'
                : 'Cancel'}
            </Button>
          </div>
        ) : (
          <div className="layer-decomposition-dialog__footer">
            <Button
              variant="outline"
              icon={processing ? <X size={15} /> : undefined}
              onClick={processing ? cancel : close}
            >
              {processing
                ? isZh
                  ? '取消任务'
                  : 'Cancel task'
                : isZh
                ? '取消'
                : 'Cancel'}
            </Button>
            <Button
              theme="primary"
              loading={processing}
              onClick={primaryAction}
            >
              {processing ? phaseLabel : primaryLabel}
            </Button>
          </div>
        )
      }
    >
      <div className="layer-decomposition-dialog__body">
        <img
          src={imageUrl}
          alt=""
          className="layer-decomposition-dialog__preview"
        />

        {!automatic && !result && !needsCorrection && (
          <>
            <div
              className="layer-decomposition-dialog__modes"
              role="group"
              aria-label={isZh ? '分层方式' : 'Layer mode'}
            >
              {MODES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={mode === item.value}
                  disabled={processing}
                  onClick={() => setMode(item.value)}
                >
                  {item[language]}
                </button>
              ))}
            </div>
            {mode !== 'auto' && (
              <label className="layer-decomposition-dialog__field">
                <span>{isZh ? '指定对象' : 'Target object'}</span>
                <textarea
                  value={prompt}
                  maxLength={4000}
                  disabled={processing}
                  placeholder={
                    isZh
                      ? '例如：人物、标题文字和前景装饰'
                      : 'e.g. person, title text, foreground decoration'
                  }
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
            )}
          </>
        )}

        {!automatic && !result && mode === 'bbox' && (
          <div className="layer-decomposition-dialog__bbox">
            {['x1', 'y1', 'x2', 'y2'].map((label, index) => (
              <label key={label}>
                <span>{label}</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={bbox[index]}
                  disabled={processing}
                  onChange={(event) =>
                    setBbox((current) =>
                      current.map((value, itemIndex) =>
                        itemIndex === index ? event.target.value : value
                      )
                    )
                  }
                />
              </label>
            ))}
          </div>
        )}

        {!automatic && !result && !needsCorrection && (
          <label className="layer-decomposition-dialog__field layer-decomposition-dialog__layer-count">
            <span>{isZh ? '最多前景图层' : 'Maximum foreground layers'}</span>
            <output>{maxLayers}</output>
            <input
              type="range"
              min={1}
              max={16}
              step={1}
              value={maxLayers}
              disabled={processing}
              onChange={(event) => setMaxLayers(Number(event.target.value))}
            />
          </label>
        )}

        {!automatic && needsCorrection && !result && (
          <div className="layer-decomposition-dialog__correction">
            <strong>
              {isZh
                ? '质量校验未通过，请修正分层'
                : 'Quality check needs a correction'}
            </strong>
            <div
              className="layer-decomposition-dialog__modes"
              role="group"
              aria-label={isZh ? '修正操作' : 'Correction action'}
            >
              {CORRECTION_ACTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={correctionAction === item.value}
                  disabled={processing}
                  onClick={() => setCorrectionAction(item.value)}
                >
                  {item[language]}
                </button>
              ))}
            </div>
            <label className="layer-decomposition-dialog__field">
              <span>{isZh ? '修正说明' : 'Correction description'}</span>
              <textarea
                value={correctionPrompt}
                maxLength={4000}
                disabled={processing}
                placeholder={
                  isZh
                    ? '例如：补回人物帽子边缘，并移除背景残影'
                    : 'e.g. restore the hat edge and remove the background halo'
                }
                onChange={(event) => setCorrectionPrompt(event.target.value)}
              />
            </label>
            <label className="layer-decomposition-dialog__field">
              <span>
                {isZh
                  ? '目标图层序号（可选）'
                  : 'Target layer index (optional)'}
              </span>
              <input
                type="number"
                min={1}
                max={16}
                step={1}
                value={correctionLayer}
                disabled={processing}
                onChange={(event) => setCorrectionLayer(event.target.value)}
              />
            </label>
          </div>
        )}

        {!automatic && result && (
          <div
            className="layer-decomposition-dialog__quality"
            aria-live="polite"
          >
            <strong>{isZh ? '分层已就绪' : 'Layers are ready'}</strong>
            <span>
              {isZh ? '图层数量' : 'Layers'}: {result.layers.length + 1}
            </span>
            <span>SSIM: {result.quality?.ssim?.toFixed(4) ?? '-'}</span>
            <span>
              {isZh ? '通道误差' : 'Channel error'}:{' '}
              {result.quality?.channelErrorRate === undefined
                ? '-'
                : `${(result.quality.channelErrorRate * 100).toFixed(3)}%`}
            </span>
          </div>
        )}

        {processing && (
          <div
            className="layer-decomposition-dialog__progress"
            aria-live="polite"
          >
            <div>
              <span>{phaseLabel}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress percentage={Math.round(progress)} label={false} />
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
};

export default LayerDecompositionDialog;
