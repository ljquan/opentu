import React, { useId } from 'react';
import type {
  ImageResizeOptions,
  ImageResizeStage,
} from '../../services/canvas-operations/resize-canvas-image';

const SCALE_FACTORS = [0.25, 0.5, 1, 2, 4];

export const ImageResizePanel: React.FC<{
  width: number;
  height: number;
  target: number;
  algorithm: ImageResizeOptions['algorithm'];
  output: { width: number; height: number } | null;
  error: string;
  stage: ImageResizeStage | null;
  onTargetChange: (target: number) => void;
  onAlgorithmChange: (algorithm: ImageResizeOptions['algorithm']) => void;
}> = ({
  width,
  height,
  target,
  algorithm,
  output,
  error,
  stage,
  onTargetChange,
  onAlgorithmChange,
}) => {
  const helpId = useId();
  const errorId = useId();
  const longEdge = Math.max(width, height);
  const selectedFactor =
    longEdge > 0
      ? target === longEdge
        ? 1
        : SCALE_FACTORS.find(
            (factor) => Math.max(1, Math.round(longEdge * factor)) === target
          )
      : undefined;
  return (
    <div className="image-editor-core__resize-panel">
      <p id={helpId}>
        目标长边小于原图时缩小，大于原图时放大。保持比例并创建新图片。不调用
        AI，也不增加真实细节。裁剪、旋转和滤镜编辑不参与缩放。
      </p>
      <label>
        缩放倍数
        <select
          value={selectedFactor?.toString() || 'custom'}
          disabled={!!stage || longEdge <= 0}
          aria-describedby={helpId}
          onChange={(event) => {
            if (event.target.value !== 'custom') {
              onTargetChange(
                Math.max(1, Math.round(longEdge * Number(event.target.value)))
              );
            }
          }}
        >
          {SCALE_FACTORS.map((factor) => (
            <option key={factor} value={factor}>
              {factor}×{factor === 1 ? '（原尺寸）' : ''}
            </option>
          ))}
          <option value="custom" disabled>
            自定义（手动输入长边）
          </option>
        </select>
      </label>
      <label>
        目标长边（像素）
        <input
          type="number"
          min={1}
          step={1}
          value={target}
          disabled={!!stage}
          aria-describedby={`${helpId} ${errorId}`}
          aria-invalid={!!error}
          onChange={(event) => onTargetChange(Number(event.target.value))}
        />
      </label>
      <label>
        插值方式
        <select
          value={algorithm}
          disabled={!!stage}
          onChange={(event) =>
            onAlgorithmChange(
              event.target.value as ImageResizeOptions['algorithm']
            )
          }
        >
          <option value="high">高质量</option>
          <option value="bilinear">平滑</option>
          <option value="nearest">最近邻（像素画）</option>
        </select>
      </label>
      {width > 0 && (
        <div aria-label="缩放前后尺寸">
          <p>
            原图尺寸：{width} × {height}
          </p>
          {output && (
            <p>
              输出尺寸 · 像素：{output.width} × {output.height}
            </p>
          )}
        </div>
      )}
      <p>原图保留，使用顶部确认按钮缩放并插入画布。</p>
      <p id={errorId} role={error ? 'alert' : undefined}>
        {error}
      </p>
      {stage && (
        <div role="status" aria-live="polite">
          <strong>
            {stage === 'resizing'
              ? '第 1 / 2 步：正在缩放图片…'
              : '第 2 / 2 步：正在保存并加入画布…'}
          </strong>
          <progress aria-label="图片缩放处理进度" />
          {output && (
            <p>
              输出 {output.width} × {output.height} 像素，请稍候。
            </p>
          )}
        </div>
      )}
    </div>
  );
};
