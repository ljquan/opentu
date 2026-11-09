import { useEffect, useRef, useState } from 'react';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  PlaitBoard,
  PlaitHistoryBoard,
  Transforms,
} from '@plait/core';
import { Code2, Pause, Play } from 'lucide-react';
import { MessagePlugin } from 'tdesign-react';
import { ToolButton } from '../../tool-button';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import { useSvgCanvasSource } from '../../../hooks/useSvgCanvasSource';
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion';
import { supportsSvgPlayback } from '../../../utils/svg-source';
import {
  insertEditableSvgParts,
  measureSvgVectorParts,
  updateSvgVectorPart,
  type SvgImageElement,
} from '../../../services/svg-canvas-edit';
import { getCanvasBoardBinding } from '../../../services/canvas-operations/canvas-board-ref';
import { workspaceService } from '../../../services/workspace-service';
import {
  getSvgPlaybackState,
  SVG_PLAYBACK_STATE_EVENT,
} from '../../../services/svg-playback-state';
import './svg-tools-button.scss';

export function SvgToolsButton({
  board,
  image,
  language = 'zh',
}: {
  board: PlaitBoard;
  image: SvgImageElement;
  language?: 'zh' | 'en';
}) {
  const state = useSvgCanvasSource(image.url);
  const source = state?.source;
  const zh = language === 'zh';
  const reduceMotion = usePrefersReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fill, setFill] = useState(image.svgVectorPart?.fill || '');
  const [stroke, setStroke] = useState(image.svgVectorPart?.stroke || '');
  const [text, setText] = useState(image.svgVectorPart?.text || '');
  const controller = useRef<AbortController>();
  const [playbackState, setPlaybackState] = useState(() =>
    getSvgPlaybackState(board, image.id, image.url)
  );
  useEffect(() => {
    const sync = () =>
      setPlaybackState(getSvgPlaybackState(board, image.id, image.url));
    sync();
    window.addEventListener(SVG_PLAYBACK_STATE_EVENT, sync);
    return () => window.removeEventListener(SVG_PLAYBACK_STATE_EVENT, sync);
  }, [board, image.id, image.url]);
  useEffect(() => {
    setFill(image.svgVectorPart?.fill || '');
    setStroke(image.svgVectorPart?.stroke || '');
    setText(image.svgVectorPart?.text || '');
    setError('');
    return () => controller.current?.abort();
  }, [image.id, image.url, image.svgVectorPart]);
  if (!state) return null;
  const begin = () => {
    controller.current?.abort();
    controller.current = new AbortController();
    const operation = controller.current;
    const binding = getCanvasBoardBinding();
    const boardId = workspaceService.getState().currentBoardId;
    return () =>
      !operation.signal.aborted &&
      getCanvasBoardBinding()?.board === board &&
      binding?.board === board &&
      getCanvasBoardBinding()?.boardId === boardId &&
      workspaceService.getState().currentBoardId === boardId &&
      board.children.some(
        (node) => node.id === image.id && node.url === image.url
      );
  };
  const convert = async () => {
    if (!source || busy) return;
    const current = begin();
    setBusy(true);
    setError('');
    try {
      if (!current())
        throw new Error(
          zh
            ? '画布或图片已变化，请重新选择'
            : 'Canvas or image changed; select it again'
        );
      const parts = await measureSvgVectorParts(
        source,
        controller.current?.signal
      );
      const count = await insertEditableSvgParts(
        board,
        image,
        source,
        parts,
        current
      );
      MessagePlugin.success(
        zh
          ? `已创建 ${count} 个可编辑矢量部件，原图已保留`
          : `Created ${count} editable vector parts; original retained`
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SVG 转换失败');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!source || busy || !image.svgVectorPart) return;
    setBusy(true);
    setError('');
    try {
      await updateSvgVectorPart(
        board,
        image,
        source,
        {
          ...(image.svgVectorPart.fill !== undefined ? { fill } : {}),
          ...(image.svgVectorPart.stroke !== undefined ? { stroke } : {}),
          ...(image.svgVectorPart.text !== undefined ? { text } : {}),
        },
        begin(),
        undefined,
        controller.current?.signal
      );
      MessagePlugin.success(
        zh ? 'SVG 部件已更新，可撤销' : 'SVG part updated; undo is available'
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SVG 保存失败');
    } finally {
      setBusy(false);
    }
  };
  const canPlay =
    !!source &&
    !image.image3DTransform &&
    supportsSvgPlayback(source) &&
    playbackState?.status === 'ready';
  const paused =
    image.svgPlayback === 'paused' ||
    (image.svgPlayback !== 'playing' && reduceMotion);
  const toggle = () => {
    if (!canPlay || !begin()()) return;
    const index = board.children.findIndex(
      (node) => node.id === image.id && node.url === image.url
    );
    if (index >= 0)
      PlaitHistoryBoard.withNewBatch(board, () =>
        Transforms.setNode(
          board,
          {
            svgPlayback: paused ? 'playing' : 'paused',
          } as Partial<SvgImageElement>,
          [index]
        )
      );
  };
  return (
    <>
      {canPlay && (
        <ToolButton
          type="icon"
          visible
          className="svg-playback"
          icon={paused ? <Play size={15} /> : <Pause size={15} />}
          aria-label={
            zh
              ? paused
                ? '播放 SVG 动画'
                : '暂停 SVG 动画'
              : paused
              ? 'Play SVG animation'
              : 'Pause SVG animation'
          }
          tooltip={
            zh
              ? '仅播放文件自带的动画'
              : 'Play only the animation already in this file'
          }
          onClick={toggle}
        />
      )}
      <Popover>
        <PopoverTrigger asChild>
          <ToolButton
            type="icon"
            visible
            className="svg-tools"
            icon={<Code2 size={16} />}
            aria-label={zh ? 'SVG 工具' : 'SVG tools'}
            tooltip={zh ? 'SVG 工具' : 'SVG tools'}
          />
        </PopoverTrigger>
        <PopoverContent
          container={PlaitBoard.getBoardContainer(board)}
          className={`${ATTACHED_ELEMENT_CLASS_NAME} svg-tools-panel`}
        >
          <strong>{zh ? 'SVG 原文件' : 'SVG source'}</strong>
          {state.status === 'loading' && (
            <p role="status">
              {zh ? '正在读取 SVG 原文件…' : 'Reading SVG source…'}
            </p>
          )}
          {state.error && <p role="alert">{state.error}</p>}
          {source && (
            <>
              <p>
                {zh
                  ? `${source.vectorCount} 个矢量结构${
                      source.hasRaster ? '，含位图' : ''
                    } · ${
                      source.animation.detected
                        ? canPlay
                          ? '含可播放动画'
                          : '含暂不支持控制的动画'
                        : '静态 SVG'
                    }`
                  : `${source.vectorCount} vector structures · ${
                      source.animation.detected
                        ? canPlay
                          ? 'Animation available'
                          : 'Animation controls unavailable'
                        : 'Static SVG'
                    }`}
              </p>
              {image.svgVectorPart ? (
                <>
                  <p>{image.svgVectorPart.label}</p>
                  {image.svgVectorPart.fill !== undefined && (
                    <label>
                      {zh ? '填充颜色' : 'Fill color'}
                      <input
                        value={fill}
                        onChange={(event) => setFill(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  {image.svgVectorPart.stroke !== undefined && (
                    <label>
                      {zh ? '描边颜色' : 'Stroke color'}
                      <input
                        value={stroke}
                        onChange={(event) => setStroke(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  {image.svgVectorPart.text !== undefined && (
                    <label>
                      {zh ? '文字内容' : 'Text'}
                      <input
                        value={text}
                        maxLength={2000}
                        onChange={(event) => setText(event.target.value)}
                        disabled={busy}
                      />
                    </label>
                  )}
                  {image.svgVectorPart.fill === undefined &&
                  image.svgVectorPart.stroke === undefined &&
                  image.svgVectorPart.text === undefined ? (
                    <p>
                      {zh
                        ? '颜色由渐变或引用定义，可在画布移动和缩放此部件。'
                        : 'Paint comes from gradients or references. Move and resize this part on the canvas.'}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void save()}
                      disabled={busy}
                    >
                      {zh
                        ? busy
                          ? '保存中…'
                          : '保存修改'
                        : busy
                        ? 'Saving…'
                        : 'Save changes'}
                    </button>
                  )}
                </>
              ) : (
                <>
                  {source.conversionReason && <p>{source.conversionReason}</p>}
                  <button
                    type="button"
                    disabled={!source.canConvert || busy}
                    onClick={() => void convert()}
                  >
                    {zh
                      ? busy
                        ? '转换中…'
                        : '转为可编辑副本'
                      : busy
                      ? 'Converting…'
                      : 'Create editable copy'}
                  </button>
                  <p>
                    {zh
                      ? '保留原图；副本中的部件可单独移动、缩放和修改适用颜色。'
                      : 'The original is retained. Move, resize and edit supported colors on each copy part.'}
                  </p>
                </>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </PopoverContent>
      </Popover>
    </>
  );
}
