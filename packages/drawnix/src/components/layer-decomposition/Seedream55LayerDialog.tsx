import { useEffect, useRef, useState } from 'react';
import type { PlaitBoard } from '@plait/core';
import { Button } from 'tdesign-react';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useDrawnix } from '../../hooks/use-drawnix';
import { getCanvasBoardBinding } from '../../services/canvas-operations/canvas-board-ref';
import { decomposeSeedream55 } from '../../services/layer-decomposition/seedream55';
import type { LayerRecoveryHandle } from '../../services/layer-decomposition/recovery';
import './layer-decomposition-dialog.scss';

export function Seedream55LayerDialog({
  board,
  source,
  onClose,
}: {
  board: PlaitBoard;
  source: { id: string; url: string };
  onClose: () => void;
}) {
  const { board: activeBoard } = useDrawnix();
  const [maxLayers, setMaxLayers] = useState(16);
  const [textRecognition, setTextRecognition] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [recovery, setRecovery] = useState<LayerRecoveryHandle>();
  const controller = useRef<AbortController | null>(null);
  const originalSource = useRef({ id: source.id, url: source.url });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (
      activeBoard !== board ||
      source.id !== originalSource.current.id ||
      source.url !== originalSource.current.url
    ) {
      controller.current?.abort();
      onClose();
    }
  }, [activeBoard, board, source.id, source.url, onClose]);
  const close = () => {
    controller.current?.abort();
    onClose();
  };
  const submit = async () => {
    if (controller.current || done) return;
    const binding = getCanvasBoardBinding();
    if (!binding || binding.board !== board) {
      setError('画布已变化，请重新选择图片');
      return;
    }
    const run = new AbortController();
    controller.current = run;
    setBusy(true);
    setError('');
    setStatus(recovery ? '正在获取已有结果…' : '正在拆分图层…');
    try {
      const result = await decomposeSeedream55(binding, source, {
        maxLayers,
        textRecognition,
        signal: run.signal,
        recovery,
        onRecoveryAvailable: (handle) => {
          if (mounted.current) setRecovery(handle);
        },
        onProgress: (progress) => {
          if (mounted.current)
            setStatus(
              progress.phase === 'recovering'
                ? '正在获取已有结果，不会重新生图…'
                : `正在拆分图层… ${progress.progress}%`
            );
        },
      });
      if (mounted.current && !run.signal.aborted) {
        setDone(true);
        setStatus(
          `已生成 ${result.layerCount} 张图层，其中 ${result.textLayerCount} 层含 OCR。选中文字图片层可转换为可编辑文字。`
        );
      }
    } catch (cause) {
      if (mounted.current && !run.signal.aborted) {
        setStatus('');
        setError(
          `${
            cause instanceof Error ? cause.message : '分层失败'
          }。如请求已发送，请先核对调用记录再重试。`
        );
      }
    } finally {
      if (controller.current === run) controller.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const invalid =
    !Number.isInteger(maxLayers) || maxLayers < 1 || maxLayers > 99;
  return (
    <ConfirmDialog
      open
      title="Seedream 5.5 原生分层"
      className="layer-decomposition-dialog"
      onCancel={close}
      description="将当前图片拆成底图和独立图层；使用已配置的 Seedream 5.5 供应商。"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            {busy ? '取消等待' : '关闭'}
          </Button>
          {!done && (
            <Button
              theme="primary"
              loading={busy}
              disabled={invalid || busy}
              onClick={() => {
                void submit();
              }}
            >
              {recovery ? '获取已有结果' : '开始分层'}
            </Button>
          )}
        </>
      }
    >
      <label className="layer-decomposition-dialog__field">
        <span>最多前景图层（1–99）</span>
        <input
          type="number"
          min={1}
          max={99}
          step={1}
          value={Number.isNaN(maxLayers) ? '' : maxLayers}
          disabled={busy || done || Boolean(recovery)}
          aria-invalid={invalid}
          onChange={(event) =>
            setMaxLayers(
              event.target.value === '' ? NaN : Number(event.target.value)
            )
          }
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={textRecognition}
          disabled={busy || done || Boolean(recovery)}
          onChange={(event) => setTextRecognition(event.target.checked)}
        />{' '}
        识别文字与近似样式（OCR）
      </label>
      <p>
        {invalid
          ? '请输入 1–99 的整数。'
          : `最多返回 ${
              maxLayers + 1
            } 张图片（含 1 张底图），按实际成功产物计费。`}
      </p>
      <p>
        艺术字可能没有 OCR；字体与字号为近似还原。取消等待不保证上游停止计费。
      </p>
      {recovery && (
        <p style={{ overflowWrap: 'anywhere' }}>
          请求 ID：{recovery.requestId}。获取已有结果不会再次生图。
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </ConfirmDialog>
  );
}
