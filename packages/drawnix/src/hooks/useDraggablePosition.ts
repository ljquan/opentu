import { useCallback, useEffect, useRef, useState } from 'react';

export interface DraggablePosition {
  x: number;
  y: number;
}

interface UseDraggablePositionOptions {
  storageKey?: string;
  enabled?: boolean;
  initialPosition?: DraggablePosition | null;
  viewportPadding?: number;
  onCommit?: (position: DraggablePosition) => void;
}

const DRAG_THRESHOLD = 5;

function clampToViewport(
  pos: DraggablePosition,
  elWidth: number,
  elHeight: number,
  padding: number
): DraggablePosition {
  const minX = Math.min(padding, Math.max(0, window.innerWidth - elWidth));
  const minY = Math.min(padding, Math.max(0, window.innerHeight - elHeight));
  const maxX = Math.max(minX, window.innerWidth - elWidth - padding);
  const maxY = Math.max(minY, window.innerHeight - elHeight - padding);
  return {
    x: Math.max(minX, Math.min(pos.x, maxX)),
    y: Math.max(minY, Math.min(pos.y, maxY)),
  };
}

function readPosition(key: string): DraggablePosition | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function writePosition(key: string, pos: DraggablePosition) {
  try {
    localStorage.setItem(key, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

export function useDraggablePosition(options: UseDraggablePositionOptions) {
  const {
    storageKey,
    enabled = true,
    initialPosition = null,
    viewportPadding = 0,
    onCommit,
  } = options;
  const [position, setPosition] = useState<DraggablePosition | null>(() =>
    enabled
      ? initialPosition || (storageKey ? readPosition(storageKey) : null)
      : null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState<'left' | 'right' | null>(
    null
  );
  const wasDraggedRef = useRef(false);
  const positionRef = useRef(position);
  const onCommitRef = useRef(onCommit);
  const resetDraggedFrameRef = useRef(0);
  const dragStateRef = useRef<{
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    startElX: number;
    startElY: number;
    activated: boolean;
    frameId: number;
    latestPosition: DraggablePosition | null;
  } | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const initialX = initialPosition?.x;
  const initialY = initialPosition?.y;
  const hasPosition = position !== null;

  positionRef.current = position;
  onCommitRef.current = onCommit;

  const applyPosition = useCallback((nextPosition: DraggablePosition) => {
    positionRef.current = nextPosition;
    setPosition(nextPosition);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      // Only left button
      if (e.button !== 0) return;
      const el = elementRef.current;
      if (!el || dragStateRef.current) return;

      const rect = el.getBoundingClientRect();
      e.preventDefault();
      e.stopPropagation();
      dragStateRef.current = {
        pointerId: e.pointerId,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startElX: rect.left,
        startElY: rect.top,
        activated: false,
        frameId: 0,
        latestPosition: null,
      };
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    const handlePointerMove = (e: PointerEvent) => {
      const state = dragStateRef.current;
      if (!state || e.pointerId !== state.pointerId) return;

      const dx = e.clientX - state.startPointerX;
      const dy = e.clientY - state.startPointerY;

      if (!state.activated) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
          return;
        }
        state.activated = true;
        setIsDragging(true);
      }

      if (Math.abs(dx) >= 1) {
        setDragDirection(dx < 0 ? 'left' : 'right');
      }

      const el = elementRef.current;
      if (!el) return;
      state.latestPosition = clampToViewport(
        { x: state.startElX + dx, y: state.startElY + dy },
        el.offsetWidth,
        el.offsetHeight,
        viewportPadding
      );
      cancelAnimationFrame(state.frameId);
      state.frameId = requestAnimationFrame(() => {
        if (state.latestPosition) {
          applyPosition(state.latestPosition);
        }
      });
    };

    const finishDrag = (event: PointerEvent, commit: boolean) => {
      const state = dragStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      cancelAnimationFrame(state.frameId);
      const wasDragging = state.activated;
      const finalPosition = state.latestPosition || positionRef.current;
      dragStateRef.current = null;
      setIsDragging(false);
      setDragDirection(null);

      if (wasDragging && finalPosition) {
        applyPosition(finalPosition);
        wasDraggedRef.current = true;
        cancelAnimationFrame(resetDraggedFrameRef.current);
        resetDraggedFrameRef.current = requestAnimationFrame(() => {
          wasDraggedRef.current = false;
        });
        if (commit) {
          if (storageKey) writePosition(storageKey, finalPosition);
          onCommitRef.current?.(finalPosition);
        }
      }
    };

    const handlePointerUp = (event: PointerEvent) => finishDrag(event, true);
    const handlePointerCancel = (event: PointerEvent) =>
      finishDrag(event, false);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      const state = dragStateRef.current;
      if (state) cancelAnimationFrame(state.frameId);
      cancelAnimationFrame(resetDraggedFrameRef.current);
      dragStateRef.current = null;
    };
  }, [applyPosition, enabled, storageKey, viewportPadding]);

  useEffect(() => {
    if (
      !enabled ||
      typeof initialX !== 'number' ||
      typeof initialY !== 'number' ||
      dragStateRef.current
    ) {
      return;
    }
    const requestedPosition = { x: initialX, y: initialY };
    const el = elementRef.current;
    const nextPosition = el
      ? clampToViewport(
          requestedPosition,
          el.offsetWidth,
          el.offsetHeight,
          viewportPadding
        )
      : requestedPosition;
    applyPosition(nextPosition);
  }, [applyPosition, enabled, initialX, initialY, viewportPadding]);

  // Clamp on resize
  useEffect(() => {
    if (!enabled || !positionRef.current) return;
    const handleResize = () => {
      const el = elementRef.current;
      if (!el) return;
      setPosition((prev) => {
        if (!prev) return prev;
        const next = clampToViewport(
          prev,
          el.offsetWidth,
          el.offsetHeight,
          viewportPadding
        );
        positionRef.current = next;
        return next;
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [enabled, hasPosition, viewportPadding]);

  const resetPosition = useCallback(() => {
    setPosition(null);
    positionRef.current = null;
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    }
  }, [storageKey]);

  return {
    position,
    isDragging,
    dragDirection,
    wasDraggedRef,
    elementRef,
    handlePointerDown,
    resetPosition,
  };
}
