/**
 * useVirtualList Hook
 *
 * A reusable hook for implementing virtual scrolling in lists.
 * Wraps @tanstack/react-virtual to provide a consistent API.
 */

import { useRef, useCallback, useMemo } from 'react';
import { useVirtualizer, VirtualItem, type Virtualizer } from '@tanstack/react-virtual';

export interface UseVirtualListOptions<T> {
  /** Array of items to virtualize */
  items: T[];
  /** Estimated size of each item in pixels */
  estimateSize: number | ((index: number) => number);
  /** Number of items to render outside the visible area (default: 5) */
  overscan?: number;
  /** Get unique key for each item */
  getItemKey?: (item: T, index: number) => string | number;
  /** Gap between items in pixels (default: 0) */
  gap?: number;
  /** Whether to enable horizontal scrolling (default: false, vertical) */
  horizontal?: boolean;
}

export interface UseVirtualListReturn<T> {
  /** Ref to attach to the scroll container */
  parentRef: React.RefObject<HTMLDivElement>;
  /** Virtual items to render */
  virtualItems: VirtualItem[];
  /** Total size of the virtualized list */
  totalSize: number;
  /** Get the item at a virtual index */
  getItem: (virtualIndex: number) => T | undefined;
  /** Scroll to a specific index */
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end' }) => void;
  /** Scroll to a specific offset */
  scrollToOffset: (offset: number) => void;
  /** Measure an item (call when item size changes) */
  measureItem: (index: number) => void;
  /** Get the virtualizer instance for advanced usage */
  virtualizer: Virtualizer<HTMLDivElement, Element>;
}

/**
 * Hook for implementing virtual scrolling in lists
 *
 * @example
 * ```tsx
 * const { parentRef, virtualItems, totalSize, getItem } = useVirtualList({
 *   items: tasks,
 *   estimateSize: 200,
 *   overscan: 3,
 * });
 *
 * return (
 *   <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
 *     <div style={{ height: totalSize, position: 'relative' }}>
 *       {virtualItems.map((virtualItem) => {
 *         const item = getItem(virtualItem.index);
 *         return (
 *           <div
 *             key={virtualItem.key}
 *             style={{
 *               position: 'absolute',
 *               top: 0,
 *               left: 0,
 *               width: '100%',
 *               transform: `translateY(${virtualItem.start}px)`,
 *             }}
 *           >
 *             <TaskItem task={item} />
 *           </div>
 *         );
 *       })}
 *     </div>
 *   </div>
 * );
 * ```
 */
export function useVirtualList<T>(
  options: UseVirtualListOptions<T>
): UseVirtualListReturn<T> {
  const {
    items,
    estimateSize,
    overscan = 5,
    getItemKey,
    gap = 0,
    horizontal = false,
  } = options;

  const parentRef = useRef<HTMLDivElement>(null);

  // Convert estimateSize to function if it's a number
  const estimateSizeFn = useCallback(
    (index: number) => {
      const size = typeof estimateSize === 'function' ? estimateSize(index) : estimateSize;
      // Add gap to all items except the last one
      return index < items.length - 1 ? size + gap : size;
    },
    [estimateSize, gap, items.length]
  );

  // Generate stable keys
  const getItemKeyFn = useCallback(
    (index: number) => {
      if (getItemKey && items[index]) {
        return getItemKey(items[index], index);
      }
      return index;
    },
    [getItemKey, items]
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: estimateSizeFn,
    overscan,
    getItemKey: getItemKeyFn,
    horizontal,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const getItem = useCallback(
    (virtualIndex: number): T | undefined => {
      return items[virtualIndex];
    },
    [items]
  );

  const scrollToIndex = useCallback(
    (index: number, options?: { align?: 'start' | 'center' | 'end' }) => {
      virtualizer.scrollToIndex(index, options);
    },
    [virtualizer]
  );

  const scrollToOffset = useCallback(
    (offset: number) => {
      virtualizer.scrollToOffset(offset);
    },
    [virtualizer]
  );

  const measureItem = useCallback(
    (index: number) => {
      virtualizer.measureElement(parentRef.current?.children[index] as HTMLElement);
    },
    [virtualizer]
  );

  return useMemo(
    () => ({
      parentRef,
      virtualItems,
      totalSize,
      getItem,
      scrollToIndex,
      scrollToOffset,
      measureItem,
      virtualizer,
    }),
    [virtualItems, totalSize, getItem, scrollToIndex, scrollToOffset, measureItem, virtualizer]
  );
}
