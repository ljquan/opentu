import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  deleteTemporaryElements,
  getTemporaryRef,
  PlaitBoard,
  Transforms,
  type PlaitElement,
} from '@plait/core';
import { MessagePlugin } from 'tdesign-react';
import {
  ArrowRight,
  Image as ImageIcon,
  Scaling,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Dialog, DialogContent } from '../../dialog/dialog';
import { loadImageElementForCanvas } from '../../../data/image';
import {
  type CanvasInsertionResultData,
  executeCanvasInsertion,
} from '../../../services/canvas-operations/canvas-insertion';
import { getCanvasBoardBinding } from '../../../services/canvas-operations/canvas-board-ref';
import { requestAIInputPrefill } from '../../../services/ai-input-ui-events';
import { createCanvasAssociationLines } from '../../../plugins/canvas-association';
import {
  buildImageAnglePrompt,
  drawImageRegion,
  imageResizeDimensions,
  imageSplitCuts,
} from '../../../utils/canvas-image-tools';
import type { DataURL } from '../../../types';
import './canvas-image-tools.scss';

export type ImageToolMode = 'split' | 'resize' | 'angle';
const titles = { split: '手动拆图', resize: '本地放大', angle: 'AI 视角编辑' };
const descriptions = {
  split: '按分割线裁出多张图片，保留每一处细节。',
  resize: '提升图片像素尺寸，保持原始比例。',
  angle: '调整拍摄角度，为新的画面准备生成指令。',
};

// Give the browser a paint opportunity before synchronous Canvas/PNG work.
const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });

export function CanvasImageToolsDialog({
  board,
  element,
  mode,
  onClose,
}: {
  board: PlaitBoard;
  element: PlaitElement;
  mode: ImageToolMode;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resizeStage, setResizeStage] = useState<
    'resizing' | 'inserting' | null
  >(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const [horizontal, setHorizontal] = useState('50');
  const [vertical, setVertical] = useState('50');
  const [target, setTarget] = useState(2048);
  const [algorithm, setAlgorithm] = useState<'high' | 'bilinear' | 'nearest'>(
    'high'
  );
  const [angle, setAngle] = useState({
    horizontal: 0,
    pitch: 9,
    distance: 4.8,
    wide: false,
  });
  const [binding] = useState(getCanvasBoardBinding);
  const isCurrentBoard = () => {
    const current = getCanvasBoardBinding();
    return (
      mounted.current &&
      current?.board === board &&
      current?.boardId === binding?.boardId
    );
  };
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setImage(null);
    setError('');
    setPreviewError('');
    void loadImageElementForCanvas(element.url as DataURL)
      .then((loaded) => {
        if (active) {
          setImage(loaded);
          setTarget(Math.max(2048, Math.max(loaded.width, loaded.height) * 2));
        }
      })
      .catch(() => {
        if (active) setError('图片读取失败，请确认原图仍可访问。');
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [element.url]);
  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!image || !canvas) return;
    try {
      const scale = Math.min(1, 560 / image.width, 280 / image.height);
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('预览画布不可用');
      // Reuse decoded pixels: cached images may carry an already revoked blob URL.
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } catch {
      setPreviewError('图片预览暂不可用，可关闭后重新打开。');
    }
  }, [image]);
  const preview = useMemo(() => {
    if (!image) return null;
    try {
      const x = imageSplitCuts(vertical, image.width);
      const y = imageSplitCuts(horizontal, image.height);
      const output = imageResizeDimensions(image.width, image.height, target);
      return {
        x,
        y,
        output,
        count: (x.length - 1) * (y.length - 1),
        error: '',
      };
    } catch (cause) {
      return {
        x: [],
        y: [],
        output: { width: 0, height: 0 },
        count: 0,
        error: cause instanceof Error ? cause.message : '参数无效',
      };
    }
  }, [image, vertical, horizontal, target]);
  const submit = async () => {
    if (!image || !preview || preview.error || lock.current) return;
    if (!isCurrentBoard()) {
      setError('画布已切换，请重新选择图片。');
      return;
    }
    if (mode === 'angle') {
      if (
        ![angle.horizontal, angle.pitch, angle.distance].every(
          Number.isFinite
        ) ||
        angle.distance <= 0
      ) {
        setError('请输入有效角度和正数拍摄距离');
        return;
      }
      requestAIInputPrefill({
        generationType: 'image',
        prompt: buildImageAnglePrompt(angle),
        images: [
          {
            url: element.url,
            name: '视角参考图',
            width: image.width,
            height: image.height,
          },
        ],
        source: 'canvas-toolbar',
      });
      onClose();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const items: Array<{
        type: 'image';
        content: string;
        waitForImageLoad: boolean;
        metadata?: Record<string, unknown>;
      }> = [];
      if (mode === 'resize') {
        if (target <= Math.max(image.width, image.height))
          throw new Error('目标长边必须大于原图长边');
        setResizeStage('resizing');
        await waitForPaint();
        if (!isCurrentBoard()) throw new Error('画布已切换，请重新选择图片。');
        items.push({
          type: 'image',
          content: drawImageRegion(
            image,
            0,
            0,
            image.width,
            image.height,
            preview.output,
            algorithm
          ),
          waitForImageLoad: true,
          metadata: {
            localImageOperation: {
              type: 'resize',
              sourceWidth: image.naturalWidth || image.width,
              sourceHeight: image.naturalHeight || image.height,
              outputWidth: preview.output.width,
              outputHeight: preview.output.height,
              algorithm,
              createdAt: Date.now(),
              sourcePrompt: [
                element.localImageOperation?.sourcePrompt,
                element.generationPrompt,
                element.aiPrompt,
                element.prompt,
              ].find((value) => typeof value === 'string' && value.trim()),
            },
          },
        });
        setResizeStage('inserting');
        await waitForPaint();
        if (!isCurrentBoard()) throw new Error('画布已切换，请重新选择图片。');
      } else {
        const x = preview.x;
        const y = preview.y;
        for (let row = 0; row < y.length - 1; row++) {
          for (let col = 0; col < x.length - 1; col++) {
            items.push({
              type: 'image',
              content: drawImageRegion(
                image,
                x[col],
                y[row],
                x[col + 1] - x[col],
                y[row + 1] - y[row]
              ),
              waitForImageLoad: true,
            });
          }
        }
      }
      const result = await executeCanvasInsertion({
        board,
        items,
        boardGuard: isCurrentBoard,
      });
      if (!result.success) throw new Error(result.error || '图片插入失败');
      if (mode === 'resize' && isCurrentBoard()) {
        void MessagePlugin.success(
          `放大完成：${preview.output.width} × ${preview.output.height} 像素，已加入画布，原图保留。`,
          4000
        );
      }
      if (binding?.boardId && isCurrentBoard()) {
        for (const item of (
          result.data as CanvasInsertionResultData | undefined
        )?.items || []) {
          if (item.elementId)
            createCanvasAssociationLines(board, {
              boardId: binding.boardId,
              sourceElementIds: [element.id],
              resultElementId: item.elementId,
            });
        }
      }
      if (mode === 'resize' && isCurrentBoard()) {
        const firstResultId = (
          result.data as CanvasInsertionResultData | undefined
        )?.items.find((item) => item.type === 'image')?.elementId;
        const resizedImage = firstResultId
          ? board.children.find((item) => item.id === firstResultId)
          : undefined;
        if (resizedImage) {
          // Insertion queues selection before metadata replaces the image node.
          // Cancel that stale reference and notify the board's selection/render
          // lifecycle with the current node, including its resize record.
          const pendingSelection = getTemporaryRef(board);
          if (pendingSelection) {
            clearTimeout(pendingSelection.timeoutId);
            deleteTemporaryElements(board);
          }
          Transforms.addSelectionWithTemporaryElements(board, [resizedImage]);
        }
      }
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : '图片处理失败');
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        setResizeStage(null);
      }
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        container={PlaitBoard.getBoardContainer(board)}
        className="canvas-image-tools"
        aria-label={titles[mode]}
        aria-describedby={descriptionId}
      >
        <header className="canvas-image-tools__header">
          <span className="canvas-image-tools__icon" aria-hidden="true">
            {mode === 'resize' ? (
              <Scaling size={20} />
            ) : (
              <ImageIcon size={20} />
            )}
          </span>
          <div>
            <h2>{titles[mode]}</h2>
            <p id={descriptionId}>{descriptions[mode]}</p>
          </div>
          <button
            className="canvas-image-tools__close"
            type="button"
            aria-label="关闭图片工具"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="canvas-image-tools__body">
          <section className="canvas-image-tools__visual" aria-label="图片预览">
            <div className="canvas-image-tools__section-heading">
              <span>原图预览</span>
              {image && (
                <span className="canvas-image-tools__pixel-size">
                  {image.width} × {image.height} px
                </span>
              )}
            </div>
            <div className="canvas-image-tools__stage">
              {previewError && (
                <p className="canvas-image-tools__preview-error" role="alert">
                  {previewError}
                </p>
              )}
              {!image && !error && <p role="status">正在读取图片…</p>}
              {!image && error && <ImageIcon size={32} aria-hidden="true" />}
              {image && (
                <div
                  className="canvas-image-tools__preview"
                  hidden={!!previewError}
                >
                  <canvas
                    ref={previewCanvas}
                    role="img"
                    aria-label="原图与操作预览"
                    style={
                      mode === 'angle'
                        ? {
                            transform: `perspective(520px) rotateY(${
                              -angle.horizontal * 0.45
                            }deg) rotateX(${angle.pitch * 0.35}deg)`,
                          }
                        : undefined
                    }
                  />
                  {mode === 'split' && preview && !preview.error && (
                    <div
                      className="canvas-image-tools__lines"
                      aria-hidden="true"
                    >
                      {preview.x.slice(1, -1).map((x) => (
                        <span
                          key={`x${x}`}
                          style={{
                            left: `${(x / image.width) * 100}%`,
                            top: 0,
                            bottom: 0,
                            borderLeft: '2px solid #e5484d',
                          }}
                        />
                      ))}
                      {preview.y.slice(1, -1).map((y) => (
                        <span
                          key={`y${y}`}
                          style={{
                            top: `${(y / image.height) * 100}%`,
                            left: 0,
                            right: 0,
                            borderTop: '2px solid #e5484d',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="canvas-image-tools__caption">
              {mode === 'angle'
                ? '视角变化仅作平面示意'
                : '完整保留原图，处理后创建新图片'}
            </p>
          </section>
          <section
            className="canvas-image-tools__settings"
            aria-label="图片处理设置"
          >
            <div className="canvas-image-tools__section-heading">
              {mode === 'resize'
                ? '放大设置'
                : mode === 'split'
                ? '分割设置'
                : '视角设置'}
            </div>
            {mode === 'split' && (
              <>
                <p>
                  以百分比设置分割线，多条用逗号分隔，留空表示不沿该方向拆分。
                </p>
                <label>
                  横向分割线
                  <input
                    value={horizontal}
                    onChange={(event) => setHorizontal(event.target.value)}
                  />
                </label>
                <label>
                  纵向分割线
                  <input
                    value={vertical}
                    onChange={(event) => setVertical(event.target.value)}
                  />
                </label>
                {preview && !preview.error && (
                  <p>将生成 {preview.count} 张图片，原图保留。</p>
                )}
              </>
            )}
            {mode === 'resize' && (
              <>
                <label>
                  目标长边（像素）
                  <input
                    type="number"
                    disabled={busy}
                    min={1}
                    step={1}
                    value={target}
                    onChange={(event) => setTarget(Number(event.target.value))}
                  />
                </label>
                <label>
                  插值方式
                  <select
                    disabled={busy}
                    value={algorithm}
                    onChange={(event) =>
                      setAlgorithm(event.target.value as typeof algorithm)
                    }
                  >
                    <option value="high">高质量</option>
                    <option value="bilinear">平滑</option>
                    <option value="nearest">最近邻（像素画）</option>
                  </select>
                </label>
                {image && preview && !preview.error && (
                  <div
                    className="canvas-image-tools__dimensions"
                    aria-label="放大前后尺寸"
                  >
                    <div>
                      <span>原图尺寸</span>
                      <strong>
                        {image.width} × {image.height}
                      </strong>
                    </div>
                    <ArrowRight size={16} aria-hidden="true" />
                    <div>
                      <span>输出尺寸 · 像素</span>
                      <strong>
                        {preview.output.width} × {preview.output.height}
                      </strong>
                    </div>
                  </div>
                )}
                <p className="canvas-image-tools__hint">
                  本地插值处理，不调用 AI，也不增加真实细节。
                </p>
              </>
            )}
            {mode === 'angle' && (
              <>
                <p>
                  预览仅示意。确认后填入底部输入栏，手动发送才会生成，效果取决于所选模型。
                </p>
                {(['horizontal', 'pitch', 'distance'] as const).map((key) => (
                  <label key={key}>
                    {
                      {
                        horizontal: '水平角度（°）',
                        pitch: '俯仰角度（°）',
                        distance: '相对拍摄距离',
                      }[key]
                    }
                    <input
                      type="number"
                      step={key === 'distance' ? 0.1 : 1}
                      value={angle[key]}
                      onChange={(event) =>
                        setAngle({
                          ...angle,
                          [key]: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                ))}
                <label className="canvas-image-tools__checkbox">
                  <input
                    type="checkbox"
                    checked={angle.wide}
                    onChange={(event) =>
                      setAngle({ ...angle, wide: event.target.checked })
                    }
                  />
                  广角镜头
                </label>
              </>
            )}
            {busy && resizeStage && (
              <div
                className="canvas-image-tools__progress"
                role="status"
                aria-live="polite"
              >
                <strong>
                  {resizeStage === 'resizing'
                    ? '第 1 / 2 步：正在放大图片…'
                    : '第 2 / 2 步：正在保存并加入画布…'}
                </strong>
                <progress aria-label="图片放大处理进度" />
                <span>
                  输出 {preview?.output.width} × {preview?.output.height}{' '}
                  像素，请稍候。
                </span>
              </div>
            )}
            {(error || preview?.error) && (
              <p className="canvas-image-tools__error" role="alert">
                {error || preview?.error}
              </p>
            )}
          </section>
        </div>
        <footer className="canvas-image-tools__footer">
          <span className="canvas-image-tools__preserve">
            <ShieldCheck size={15} aria-hidden="true" />
            原图保留
          </span>
          <div className="canvas-image-tools__actions">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              className="canvas-image-tools__primary"
              type="button"
              disabled={busy || !image || !!preview?.error}
              onClick={() => void submit()}
            >
              {busy
                ? '正在处理…'
                : mode === 'angle'
                ? '填入生成输入栏'
                : '确认'}
              {!busy && <ArrowRight size={15} aria-hidden="true" />}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
