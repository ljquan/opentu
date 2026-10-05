import React, { useEffect, useState } from 'react';
import { ATTACHED_ELEMENT_CLASS_NAME } from '@plait/core';
import { Info, RefreshCw, X } from 'lucide-react';
import { ToolButton } from '../../tool-button';
import { HoverTip } from '../../shared/hover';
import { Popover, PopoverContent, PopoverTrigger } from '../../popover/popover';
import {
  findCanvasImageTask,
  getCanvasImageDetails,
  type CanvasImageDetailsSource,
} from '../../../utils/canvas-image-details';
import type { Task } from '../../../types/task.types';
import {
  readImageDetailsOnClickEnabled,
  persistImageDetailsOnClickEnabled,
} from './image-details-settings';
import './image-details-button.scss';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; task?: Task };

type ImageScreenRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

function getImageDetailsPanelStyle(
  rect?: ImageScreenRect
): React.CSSProperties | undefined {
  if (!rect || typeof window === 'undefined') return undefined;
  const gap = 12;
  const rightSpace = window.innerWidth - rect.right - gap * 2;
  const leftSpace = rect.left - gap * 2;
  const side = rightSpace >= 240 ? 'right' : leftSpace >= 240 ? 'left' : null;
  if (side) {
    const width = Math.min(380, side === 'right' ? rightSpace : leftSpace);
    const top = Math.max(
      gap,
      Math.min(rect.top, window.innerHeight - 180 - gap)
    );
    return {
      position: 'fixed',
      transform: 'none',
      width,
      left: side === 'right' ? rect.right + gap : rect.left - width - gap,
      top,
      maxHeight: Math.min(560, window.innerHeight - top - gap),
    };
  }
  // Use vertical space when neither side can hold a readable panel.
  const below = window.innerHeight - rect.bottom - gap * 2;
  const above = rect.top - gap * 2;
  const placeBelow = below >= above || above < 80;
  const height = Math.max(80, Math.min(560, placeBelow ? below : above));
  return {
    position: 'fixed',
    transform: 'none',
    left: gap,
    width: Math.min(380, window.innerWidth - gap * 2),
    top: placeBelow
      ? rect.bottom + gap
      : Math.max(gap, rect.top - height - gap),
    maxHeight: height,
  };
}

function formatTime(value: number | undefined, language: 'zh' | 'en') {
  if (!value || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
        hour12: false,
      });
}

export function PopupImageDetailsButton({
  image,
  language,
  autoOpenRequest = 0,
  selectionRect,
}: {
  image: CanvasImageDetailsSource;
  language: 'zh' | 'en';
  autoOpenRequest?: number;
  selectionRect?: ImageScreenRect;
}) {
  const [autoEnabled, setAutoEnabled] = useState(
    readImageDetailsOnClickEnabled
  );
  const [open, setOpen] = useState(
    () => autoOpenRequest > 0 && readImageDetailsOnClickEnabled()
  );
  const [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const zh = language === 'zh';
  const title = zh ? '图片详情' : 'Image details';
  const unrecorded = zh ? '未记录' : 'Not recorded';
  const { id, url, generationTaskId } = image;

  useEffect(() => {
    if (autoOpenRequest > 0 && readImageDetailsOnClickEnabled()) setOpen(true);
  }, [autoOpenRequest]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoad({ status: 'loading' });
    void findCanvasImageTask({ id, url, generationTaskId }).then(
      (task) => {
        if (active) setLoad({ status: 'ready', task });
      },
      () => {
        if (active) setLoad({ status: 'error' });
      }
    );
    return () => {
      active = false;
    };
  }, [open, id, url, generationTaskId, retry]);

  const details = getCanvasImageDetails(
    image,
    load.status === 'ready' ? load.task : undefined
  );
  const rows = [
    [
      zh ? '生成时间' : 'Generation time',
      formatTime(details.createdAt, language),
    ],
    ...(details.completedAt
      ? [
          [
            zh ? '完成时间' : 'Completion time',
            formatTime(details.completedAt, language),
          ],
        ]
      : []),
    [zh ? '模型' : 'Model', details.model],
    [zh ? '图片尺寸' : 'Image dimensions', details.dimensions],
  ];

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="right-start"
      sideOffset={8}
    >
      <PopoverTrigger asChild>
        <ToolButton
          type="icon"
          visible
          icon={<Info size={16} />}
          aria-label={zh ? '查看图片详情' : 'View image details'}
          tooltip={zh ? '查看图片详情' : 'View image details'}
          selected={open}
          data-track="toolbar_click_image_details"
          onClick={() => setOpen((value) => !value)}
        />
      </PopoverTrigger>
      <PopoverContent
        className={`image-details-panel ${ATTACHED_ELEMENT_CLASS_NAME}`}
        style={getImageDetailsPanelStyle(selectionRect)}
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          event.stopPropagation();
        }}
      >
        <div className="image-details-panel__header">
          <h3>{title}</h3>
          <HoverTip
            content={
              zh
                ? '点击图片自动打开详情'
                : 'Automatically open details on image click'
            }
            showArrow={false}
          >
            <label className="image-details-panel__auto">
              <input
                type="checkbox"
                role="switch"
                aria-label={
                  zh
                    ? '点击图片自动打开详情'
                    : 'Automatically open details on image click'
                }
                checked={autoEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  persistImageDetailsOnClickEnabled(enabled);
                  setAutoEnabled(enabled);
                }}
              />
              <span aria-hidden="true" />
            </label>
          </HoverTip>
          <ToolButton
            type="icon"
            visible
            icon={<X size={16} />}
            aria-label={zh ? '关闭图片详情' : 'Close image details'}
            tooltip={zh ? '关闭' : 'Close'}
            onClick={() => setOpen(false)}
          />
        </div>
        {load.status === 'loading' && (
          <p role="status">
            {zh ? '正在读取生成记录…' : 'Loading generation record…'}
          </p>
        )}
        {load.status === 'error' && (
          <div className="image-details-panel__error">
            <p role="alert">
              {zh ? '生成记录读取失败' : 'Failed to load generation record'}
            </p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              <RefreshCw size={14} />
              {zh ? '重试' : 'Retry'}
            </button>
          </div>
        )}
        {load.status === 'ready' && (
          <>
            {!load.task && (
              <p className="image-details-panel__missing">
                {zh
                  ? '未找到该图片的生成记录'
                  : 'No generation record found for this image'}
              </p>
            )}
            <dl className="image-details-panel__fields">
              {rows.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value || unrecorded}</dd>
                </React.Fragment>
              ))}
            </dl>
            <section>
              <h4>{zh ? '提示词' : 'Prompt'}</h4>
              <p className="image-details-panel__prompt">
                {details.prompt || unrecorded}
              </p>
            </section>
            <section>
              <h4>{zh ? '模型参数' : 'Model parameters'}</h4>
              {details.parameters.length ? (
                <dl className="image-details-panel__fields">
                  {details.parameters.map(({ name, value }) => (
                    <React.Fragment key={name}>
                      <dt>{name}</dt>
                      <dd>{value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : (
                <p>{unrecorded}</p>
              )}
            </section>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
