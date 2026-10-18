import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FileText, Image as ImageIcon, Music2, Video } from 'lucide-react';
import type { CanvasAssociationRef } from '../../types/shared/core.types';
import { RetryImage } from '../retry-image';
import { HoverCard } from '../shared/hover';
import {
  buildCanvasAssociationHighlightSegments,
  type CanvasAssociationHighlightSegment,
} from './canvas-association-state';
import { findCanvasAssociationElement } from './canvas-association-resolver';
import type { PlaitElement } from '@plait/core';
import './canvas-association-highlight.scss';

export function getAssociationPreviewUrl(
  reference: CanvasAssociationRef,
  boardId: string | null | undefined,
  elements: readonly PlaitElement[]
): string | undefined {
  if (reference.boardId !== boardId || reference.kind !== 'image') return;
  const element = findCanvasAssociationElement(elements, reference.elementId);
  if (!element) return;
  const image = element.image;
  const url =
    typeof element.url === 'string'
      ? element.url
      : image &&
        typeof image === 'object' &&
        'url' in image &&
        typeof image.url === 'string'
      ? image.url
      : undefined;
  return url?.trim() || undefined;
}

interface Props {
  prompt: string;
  references: CanvasAssociationRef[];
  boardId: string | null | undefined;
  elements: readonly PlaitElement[];
  inputRef: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
  expanded?: boolean;
}

export const CanvasAssociationHighlight = forwardRef<HTMLDivElement, Props>(
  function CanvasAssociationHighlight(
    { prompt, references, boardId, elements, inputRef, disabled, expanded },
    ref
  ) {
    const layerRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => layerRef.current as HTMLDivElement, []);
    const segments = buildCanvasAssociationHighlightSegments(
      prompt,
      references
    );
    const byId = new Map(
      references.map((reference) => [reference.referenceId, reference])
    );
    const [selection, setSelection] = useState({ start: -1, end: -1 });

    useLayoutEffect(() => {
      const input = inputRef.current;
      const layer = layerRef.current;
      if (!input || !layer) return;
      const syncSize = () => {
        // clientWidth excludes the textarea scrollbar, keeping native wrap points.
        layer.style.width = `${input.clientWidth}px`;
        layer.style.height = `${input.clientHeight}px`;
        layer.scrollTop = input.scrollTop;
      };
      syncSize();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(syncSize);
      observer.observe(input);
      return () => observer.disconnect();
    }, [inputRef]);

    useLayoutEffect(() => {
      const input = inputRef.current;
      if (!input) return;
      const update = () =>
        setSelection({ start: input.selectionStart, end: input.selectionEnd });
      update();
      input.addEventListener('select', update);
      input.addEventListener('keyup', update);
      input.addEventListener('click', update);
      return () => {
        input.removeEventListener('select', update);
        input.removeEventListener('keyup', update);
        input.removeEventListener('click', update);
      };
    }, [inputRef, prompt]);

    return (
      <div
        ref={layerRef}
        className={`ai-input-bar__highlight-layer canvas-association-highlight${
          expanded ? ' canvas-association-highlight--expanded' : ''
        }`}
      >
        {segments.map((segment, index) => {
          const reference = segment.referenceId
            ? byId.get(segment.referenceId)
            : undefined;
          if (!reference)
            return (
              <span key={index} aria-hidden="true">
                {segment.text}
              </span>
            );
          return (
            <AssociationChip
              key={reference.referenceId}
              segment={segment}
              prompt={prompt}
              reference={reference}
              previewUrl={getAssociationPreviewUrl(
                reference,
                boardId,
                elements
              )}
              selected={
                selection.start < (reference.mentionEnd ?? -1) &&
                selection.end > (reference.mentionStart ?? Infinity)
              }
              disabled={disabled}
              onSelect={() => {
                const input = inputRef.current;
                if (
                  !input ||
                  reference.mentionStart === undefined ||
                  reference.mentionEnd === undefined
                )
                  return;
                input.focus();
                input.setSelectionRange(
                  reference.mentionStart,
                  reference.mentionEnd
                );
                setSelection({
                  start: reference.mentionStart,
                  end: reference.mentionEnd,
                });
              }}
            />
          );
        })}
      </div>
    );
  }
);

function AssociationChip({
  segment,
  prompt,
  reference,
  previewUrl,
  selected,
  disabled,
  onSelect,
}: {
  segment: CanvasAssociationHighlightSegment;
  prompt: string;
  reference: CanvasAssociationRef;
  previewUrl?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    if (textRef.current) {
      setWrapped(textRef.current.getClientRects().length > 1);
    }
  }, [prompt]);
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const measure = () => setWrapped(text.getClientRects().length > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    const layer = text.closest('.canvas-association-highlight');
    if (layer) observer.observe(layer);
    return () => observer.disconnect();
  }, [segment.text]);
  const Icon =
    reference.kind === 'image'
      ? ImageIcon
      : reference.kind === 'video'
      ? Video
      : reference.kind === 'audio'
      ? Music2
      : FileText;

  return (
    <HoverCard
      autoFocus={false}
      placement="top"
      openDelay={180}
      disabled={disabled || !previewUrl}
      contentClassName="canvas-association-highlight__preview"
      content={
        previewUrl ? (
          <>
            <RetryImage
              src={previewUrl}
              alt={reference.label}
              preferCachedBlob
              showSkeleton={false}
            />
            <span>{reference.label}</span>
          </>
        ) : null
      }
    >
      <span
        className={`canvas-association-highlight__mention${
          selected ? ' canvas-association-highlight__mention--selected' : ''
        }${wrapped ? ' canvas-association-highlight__mention--wrapped' : ''}`}
        onPointerDown={(event) => {
          if (!wrapped || disabled) return;
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }}
      >
        {/* Original glyphs preserve the native textarea's caret and wrap points. */}
        <span
          ref={textRef}
          className="canvas-association-highlight__sizer"
          aria-hidden="true"
        >
          {segment.text}
        </span>
        <button
          type="button"
          className="canvas-association-highlight__chip"
          aria-label={reference.label}
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') event.stopPropagation();
          }}
        >
          <span className="canvas-association-highlight__thumbnail">
            {previewUrl ? (
              <RetryImage
                key={previewUrl}
                src={previewUrl}
                alt=""
                preferCachedBlob
                showSkeleton={false}
                fallback={<Icon size={12} aria-hidden="true" />}
              />
            ) : (
              <Icon size={12} aria-hidden="true" />
            )}
          </span>
          <span className="canvas-association-highlight__label">
            {reference.label}
          </span>
        </button>
      </span>
    </HoverCard>
  );
}
