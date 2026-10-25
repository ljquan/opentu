import { useEffect, useId, useRef, useState } from 'react';
import { PlaitBoard, type PlaitElement } from '@plait/core';
import { ArrowRight, Image as ImageIcon, ShieldCheck, X } from 'lucide-react';
import { Dialog, DialogContent } from '../../dialog/dialog';
import { loadImageElementForCanvas } from '../../../data/image';
import { getCanvasBoardBinding } from '../../../services/canvas-operations/canvas-board-ref';
import { requestAIInputPrefill } from '../../../services/ai-input-ui-events';
import { buildImageAnglePrompt } from '../../../utils/canvas-image-tools';
import type { DataURL } from '../../../types';
import './canvas-image-tools.scss';

export type ImageToolMode = 'angle';
const titles = { angle: 'AI 视角编辑' };
const descriptions = { angle: '调整拍摄角度，为新的画面准备生成指令。' };

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
  const mounted = useRef(true);
  const [angle, setAngle] = useState({
    horizontal: '0',
    pitch: '9',
    distance: '4.8',
    wide: false,
  });
  const lastValidDistance = useRef(angle.distance);
  const numericAngle = {
    horizontal: Number(angle.horizontal),
    pitch: Number(angle.pitch),
    distance: Number(angle.distance),
    wide: angle.wide,
  };
  const fieldErrors = {
    horizontal:
      !angle.horizontal.trim() || !Number.isFinite(numericAngle.horizontal)
        ? '请输入有效的水平角度'
        : '',
    pitch:
      !angle.pitch.trim() || !Number.isFinite(numericAngle.pitch)
        ? '请输入有效的俯仰角度'
        : '',
    distance:
      !angle.distance.trim() ||
      !Number.isFinite(numericAngle.distance) ||
      numericAngle.distance <= 0
        ? '拍摄距离必须大于 0'
        : '',
  };
  const hasInvalidAngle = Object.values(fieldErrors).some(Boolean);
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
  const submit = () => {
    if (!image) return;
    if (!isCurrentBoard()) {
      setError('画布已切换，请重新选择图片。');
      return;
    }
    if (hasInvalidAngle) {
      setError('请输入有效角度和正数拍摄距离');
      return;
    }
    requestAIInputPrefill({
      generationType: 'image',
      prompt: buildImageAnglePrompt(numericAngle),
      images: [
        {
          url: element.url,
          name: '视角参考图',
          sourceElementId: element.id,
          width: image.width,
          height: image.height,
        },
      ],
      source: 'canvas-toolbar',
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
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
            <ImageIcon size={20} />
          </span>
          <div>
            <h2>{titles[mode]}</h2>
            <p id={descriptionId}>{descriptions[mode]}</p>
          </div>
          <button
            className="canvas-image-tools__close"
            type="button"
            aria-label="关闭图片工具"
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
                              Number.isFinite(numericAngle.horizontal)
                                ? -numericAngle.horizontal * 0.45
                                : 0
                            }deg) rotateX(${
                              Number.isFinite(numericAngle.pitch)
                                ? numericAngle.pitch * 0.35
                                : 0
                            }deg)`,
                          }
                        : undefined
                    }
                  />
                </div>
              )}
            </div>
            <p className="canvas-image-tools__caption">视角变化仅作平面示意</p>
          </section>
          <section
            className="canvas-image-tools__settings"
            aria-label="图片处理设置"
          >
            <div className="canvas-image-tools__section-heading">视角设置</div>
            {mode === 'angle' && (
              <>
                <p>
                  预览仅示意。确认后填入底部输入栏，手动发送才会生成，效果取决于所选模型。
                </p>
                {(['horizontal', 'pitch', 'distance'] as const).map((key) => (
                  <label key={key}>
                    <span id={`${descriptionId}-${key}-label`}>
                      {
                        {
                          horizontal: '水平角度（°）',
                          pitch: '俯仰角度（°）',
                          distance: '相对拍摄距离',
                        }[key]
                      }
                    </span>
                    <input
                      type="number"
                      step="any"
                      min={key === 'distance' ? 0 : undefined}
                      required
                      value={angle[key]}
                      aria-labelledby={`${descriptionId}-${key}-label`}
                      aria-invalid={!!fieldErrors[key]}
                      aria-describedby={`${descriptionId}-${key}-hint`}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (
                          key === 'distance' &&
                          Number.isFinite(Number(value)) &&
                          Number(value) > 0
                        ) {
                          lastValidDistance.current = value;
                        }
                        setAngle({ ...angle, [key]: value });
                      }}
                      onBlur={() => {
                        if (key === 'distance' && fieldErrors.distance) {
                          setAngle({
                            ...angle,
                            distance: lastValidDistance.current,
                          });
                        }
                      }}
                    />
                    <span
                      id={`${descriptionId}-${key}-hint`}
                      className={
                        fieldErrors[key]
                          ? 'canvas-image-tools__error'
                          : undefined
                      }
                      role={fieldErrors[key] ? 'alert' : undefined}
                    >
                      {fieldErrors[key] ||
                        {
                          horizontal: '正值向右，负值向左',
                          pitch: '正值俯视，负值仰视',
                          distance:
                            '必须大于 0，支持小数；无效输入失焦后恢复上次有效值',
                        }[key]}
                    </span>
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
            {error && (
              <p className="canvas-image-tools__error" role="alert">
                {error}
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
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button
              className="canvas-image-tools__primary"
              type="button"
              disabled={!image || hasInvalidAngle}
              onClick={() => void submit()}
            >
              填入生成输入栏 <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
