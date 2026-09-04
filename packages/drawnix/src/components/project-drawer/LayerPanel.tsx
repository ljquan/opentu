/**
 * LayerPanel Component
 *
 * 在项目抽屉中展示当前画布的图层列表
 * 支持元素的可见性控制和锁定/解锁
 */

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, Pencil } from 'lucide-react';

import {
  BrowseIcon,
  BrowseOffIcon,
  LockOnIcon,
  LockOffIcon,
} from 'tdesign-icons-react';
import {
  PlaitBoard,
  PlaitElement,
  PlaitHistoryBoard,
  Transforms,
  getSelectedElements,
  clearSelectedElement,
  addSelectedElement,
  BoardTransforms,
  RectangleClient,
  getRectangleByElements,
} from '@plait/core';
import { PlaitDrawElement } from '@plait/draw';
import { MindElement } from '@plait/mind';
import { Freehand } from '../../plugins/freehand/type';
import { PenPath } from '../../plugins/pen/type';
import { getFrameDisplayName, isFrameElement } from '../../types/frame.types';
import { isToolElement } from '../../plugins/with-tool';
import { useDrawnix } from '../../hooks/use-drawnix';
import { extractTextFromElement } from '../../utils/selection-utils';
import { HoverTip } from '../shared';
import { getSemanticLayerMetadata } from '../../services/layer-decomposition';
import { exportSemanticLayerGroup } from '../../services/layer-decomposition';
import type { LayerManifestItem } from '../../services/layer-decomposition';
import { DownloadIcon } from '../icons';
import { MessagePlugin } from 'tdesign-react';

interface LayerItem {
  element: PlaitElement;
  index: number;
  name: string;
  typeLabel: string;
  icon: React.ReactNode;
  hidden: boolean;
  locked: boolean;
  semantic?: ReturnType<typeof getSemanticLayerMetadata>;
}

function getElementTypeInfo(
  element: PlaitElement,
  board: PlaitBoard
): { typeLabel: string; icon: React.ReactNode } {
  if (isFrameElement(element)) {
    return {
      typeLabel: 'PPT 页面',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="1.5"
            y="1.5"
            width="13"
            height="13"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="3 2"
            fill="none"
          />
        </svg>
      ),
    };
  }

  if (isToolElement(element)) {
    return {
      typeLabel: 'Tool',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      ),
    };
  }

  if (element.type === 'workzone') {
    return {
      typeLabel: 'Workzone',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ),
    };
  }

  if (element.type === 'audio') {
    return {
      typeLabel: 'Audio',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="3"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <path d="M6 10V6l4 2-4 2Z" fill="currentColor" />
        </svg>
      ),
    };
  }

  if (Freehand.isFreehand(element)) {
    return {
      typeLabel: 'Freehand',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 12c2-4 4-2 5-6s3-2 5-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      ),
    };
  }

  if (PenPath.isPenPath(element)) {
    return {
      typeLabel: 'Vector',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 13L8 3l5 10"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ),
    };
  }

  if (MindElement.isMindElement(board, element)) {
    return {
      typeLabel: 'Mind',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle
            cx="8"
            cy="8"
            r="3"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <line
            x1="11"
            y1="5"
            x2="14"
            y2="3"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <line
            x1="11"
            y1="11"
            x2="14"
            y2="13"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <line
            x1="5"
            y1="8"
            x2="2"
            y2="8"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      ),
    };
  }

  if (PlaitDrawElement.isImage?.(element)) {
    return {
      typeLabel: 'Image',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <circle cx="6" cy="6" r="1.5" fill="currentColor" />
          <path
            d="M2 12l3-4 2 2 3-4 4 6"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      ),
    };
  }

  if (element.type === 'video') {
    return {
      typeLabel: 'Video',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="3"
            width="12"
            height="10"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <path d="M7 6l3 2-3 2V6z" fill="currentColor" />
        </svg>
      ),
    };
  }

  if (PlaitDrawElement.isText?.(element)) {
    return {
      typeLabel: 'Text',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M4 3h8M8 3v10M5 13h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      ),
    };
  }

  if (
    PlaitDrawElement.isArrowLine?.(element) ||
    PlaitDrawElement.isVectorLine?.(element)
  ) {
    return {
      typeLabel: 'Line',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <line
            x1="3"
            y1="13"
            x2="13"
            y2="3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M9 3h4v4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      ),
    };
  }

  if (PlaitDrawElement.isTable?.(element)) {
    return {
      typeLabel: 'Table',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
          <line
            x1="2"
            y1="6"
            x2="14"
            y2="6"
            stroke="currentColor"
            strokeWidth="1"
          />
          <line
            x1="2"
            y1="10"
            x2="14"
            y2="10"
            stroke="currentColor"
            strokeWidth="1"
          />
          <line
            x1="7"
            y1="2"
            x2="7"
            y2="14"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      ),
    };
  }

  if (PlaitDrawElement.isGeometry?.(element)) {
    return {
      typeLabel: 'Shape',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      ),
    };
  }

  return {
    typeLabel: element.type || 'Element',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
    ),
  };
}

function getElementDisplayName(
  element: PlaitElement,
  board: PlaitBoard,
  typeInfo: { typeLabel: string }
): string {
  const semantic = getSemanticLayerMetadata(element);
  if (semantic?.name) return semantic.name;
  if (isFrameElement(element)) {
    return getFrameDisplayName(element);
  }

  if (isToolElement(element) && element.metadata?.name) {
    return element.metadata.name;
  }

  if (
    element.type === 'audio' &&
    typeof (element as any).title === 'string' &&
    (element as any).title.trim()
  ) {
    return (element as any).title.trim();
  }

  const text = extractTextFromElement(element, board);
  if (text) {
    return text.length > 30 ? text.slice(0, 30) + '...' : text;
  }

  return `${typeInfo.typeLabel} ${(element as any).id?.slice(-4) || ''}`.trim();
}

export const LayerPanel: React.FC = () => {
  const { board } = useDrawnix();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [lockedIds, setLockedIds] = useState<Set<string>>(() => {
    if (!board?.children) return new Set<string>();
    const ids = new Set<string>();
    (board.children as PlaitElement[]).forEach((el) => {
      if ((el as any).locked && el.id) ids.add(el.id);
    });
    return ids;
  });

  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!board) return;
    const originalAfterChange = board.afterChange;
    board.afterChange = () => {
      originalAfterChange();
      setRefreshKey((k) => k + 1);
    };
    return () => {
      board.afterChange = originalAfterChange;
    };
  }, [board]);

  const semanticGroups = useMemo(() => {
    if (!board) return [];
    return board.children.filter(
      (element) => element.type === 'group' && element.metadata?.semanticLayerGroup
    );
  }, [board, refreshKey]);

  const exportGroup = useCallback(
    async (group: PlaitElement) => {
      const providerGroupId = group.metadata?.semanticLayerGroup?.providerGroupId;
      if (!providerGroupId) return;
      try {
        await exportSemanticLayerGroup(board!, providerGroupId);
        MessagePlugin.success('分层 ZIP 导出完成');
      } catch (error) {
        MessagePlugin.error(error instanceof Error ? error.message : '分层导出失败');
      }
    },
    [board]
  );

  const moveSemanticLayer = useCallback(
    (item: LayerItem, direction: 'up' | 'down', event: React.MouseEvent) => {
      event.stopPropagation();
      if (!board || !item.semantic || item.semantic.kind === 'background') return;
      const groupId = item.element.groupId;
      if (!groupId) return;
      const semanticItems = (board.children as PlaitElement[])
        .map((element, index) => ({
          element,
          index,
          semantic: getSemanticLayerMetadata(element),
        }))
        .filter(
          (entry) =>
            entry.element.groupId === groupId &&
            entry.semantic?.providerGroupId === item.semantic?.providerGroupId
        )
        .sort((left, right) => left.index - right.index);
      const currentIndex = semanticItems.findIndex(
        (entry) => entry.element.id === item.element.id
      );
      if (currentIndex < 0) return;
      const targetIndex = direction === 'up' ? currentIndex + 1 : currentIndex - 1;
      if (targetIndex < 0 || targetIndex >= semanticItems.length) return;

      const from = semanticItems[currentIndex].index;
      const targetBoardIndex = semanticItems[targetIndex].index;
      const to = direction === 'up' ? targetBoardIndex + 1 : targetBoardIndex;
      Transforms.moveNode(board, [from], [to]);

      const movedItems = (board.children as PlaitElement[])
        .map((element, index) => ({
          element,
          index,
          semantic: getSemanticLayerMetadata(element),
        }))
        .filter(
          (entry) =>
            entry.element.groupId === groupId &&
            entry.semantic?.providerGroupId === item.semantic?.providerGroupId
        )
        .sort((left, right) => left.index - right.index);
      movedItems.forEach((entry, index) => {
        if (!entry.semantic) return;
        const zIndex = entry.semantic.kind === 'background' ? 0 : index;
        if (entry.semantic.zIndex === zIndex) return;
        Transforms.setNode(
          board,
          {
            metadata: {
              ...((entry.element as any).metadata || {}),
              semanticLayer: { ...entry.semantic, zIndex },
            },
          } as any,
          [entry.index]
        );
      });

      const groupIndex = (board.children as PlaitElement[]).findIndex(
        (element) =>
          element.type === 'group' &&
          element.metadata?.semanticLayerGroup?.providerGroupId ===
            item.semantic?.providerGroupId
      );
      if (groupIndex >= 0) {
        const group = board.children[groupIndex];
        const groupMetadata = group.metadata?.semanticLayerGroup;
        if (groupMetadata?.manifest?.layers) {
          const zByUrl = new Map(
            movedItems
              .filter((entry) => entry.semantic)
              .map((entry, index) => [
                (entry.element as any).url,
                entry.semantic!.kind === 'background' ? 0 : index,
              ])
          );
          const manifest = {
            ...groupMetadata.manifest,
            layers: [...groupMetadata.manifest.layers]
              .map((layer) => ({
                ...layer,
                zIndex: zByUrl.get(layer.url) ?? layer.zIndex,
              }))
              .sort((left, right) => left.zIndex - right.zIndex),
          };
          Transforms.setNode(
            board,
            {
              metadata: {
                ...(group.metadata || {}),
                semanticLayerGroup: { ...groupMetadata, manifest },
              },
            } as any,
            [groupIndex]
          );
        }
      }
      setRefreshKey((value) => value + 1);
    },
    [board]
  );

  const startRename = useCallback(
    (item: LayerItem, event: React.MouseEvent) => {
      event.stopPropagation();
      if (!item.semantic) return;
      setEditingId(item.element.id!);
      setEditingName(item.semantic.name);
    },
    []
  );

  const commitRename = useCallback(
    (item: LayerItem) => {
      if (!board || !item.semantic || editingId !== item.element.id) return;
      const name = editingName.trim();
      if (!name) {
        MessagePlugin.warning('图层名称不能为空');
        return;
      }
      const elementIndex = (board.children as PlaitElement[]).findIndex(
        (element) => element.id === item.element.id
      );
      if (elementIndex < 0) return;

      PlaitHistoryBoard.withNewBatch(board, () => {
        Transforms.setNode(
          board,
          {
            metadata: {
              ...((item.element as any).metadata || {}),
              semanticLayer: { ...item.semantic, name },
            },
          } as any,
          [elementIndex]
        );
        const groupIndex = (board.children as PlaitElement[]).findIndex(
          (element) =>
            element.type === 'group' &&
            element.metadata?.semanticLayerGroup?.providerGroupId ===
              item.semantic?.providerGroupId
        );
        if (groupIndex < 0) return;
        const group = board.children[groupIndex];
        const groupMetadata = group.metadata?.semanticLayerGroup;
        if (!groupMetadata?.manifest?.layers) return;
        const manifest = {
          ...groupMetadata.manifest,
          layers: groupMetadata.manifest.layers.map((layer: LayerManifestItem) =>
            layer.zIndex === item.semantic?.zIndex
              ? { ...layer, name }
              : layer
          ),
        };
        Transforms.setNode(
          board,
          {
            metadata: {
              ...(group.metadata || {}),
              semanticLayerGroup: { ...groupMetadata, manifest },
            },
          } as any,
          [groupIndex]
        );
      });
      setEditingId(null);
      setRefreshKey((value) => value + 1);
    },
    [board, editingId, editingName]
  );

  const layers: LayerItem[] = useMemo(() => {
    if (!board?.children) return [];

    const items: LayerItem[] = [];
    (board.children as PlaitElement[]).forEach((element, index) => {
      const typeInfo = getElementTypeInfo(element, board);
      const semantic = getSemanticLayerMetadata(element);
      const name = getElementDisplayName(element, board, typeInfo);
      items.push({
        element,
        index,
        name,
        typeLabel: typeInfo.typeLabel,
        icon: typeInfo.icon,
        hidden: hiddenIds.has(element.id!) || !!semantic?.hidden,
        locked: lockedIds.has(element.id!) || !!(element as any).locked,
        semantic,
      });
    });

    return items.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, refreshKey, hiddenIds, lockedIds]);

  const handleLayerClick = useCallback(
    (item: LayerItem) => {
      if (!board) return;
      setSelectedId(item.element.id!);

      clearSelectedElement(board);
      if (!item.locked) {
        addSelectedElement(board, item.element);
      }

      try {
        const rect = getRectangleByElements(board, [item.element], false);
        const container = PlaitBoard.getBoardContainer(board);
        const viewportWidth = container.clientWidth;
        const viewportHeight = container.clientHeight;

        const padding = 80;
        const scaleX = viewportWidth / (rect.width + padding * 2);
        const scaleY = viewportHeight / (rect.height + padding * 2);
        const zoom = Math.min(scaleX, scaleY, 2);

        const centerX = rect.x + rect.width / 2;
        const centerY = rect.y + rect.height / 2;

        const origination: [number, number] = [
          centerX - viewportWidth / 2 / zoom,
          centerY - viewportHeight / 2 / zoom,
        ];

        BoardTransforms.updateViewport(board, origination, zoom);
      } catch {
        // 部分元素可能无法获取矩形
      }
    },
    [board]
  );

  const toggleVisibility = useCallback(
    (item: LayerItem, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!board) return;
      const id = item.element.id!;
      const willHide = !item.hidden;

      setHiddenIds((prev) => {
        const next = new Set(prev);
        if (willHide) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });

      try {
        const g = PlaitElement.getElementG(item.element);
        if (g) {
          g.style.display = willHide ? 'none' : '';
        }
      } catch {
        // ignore
      }
      const index = (board.children as PlaitElement[]).findIndex(
        (child) => child.id === id
      );
      const current = getSemanticLayerMetadata(item.element);
      if (index >= 0 && current) {
        Transforms.setNode(
          board,
          {
            metadata: {
              ...((item.element as any).metadata || {}),
              semanticLayer: { ...current, hidden: willHide },
            },
          } as any,
          [index]
        );
      }
    },
    [board, hiddenIds]
  );

  const toggleLock = useCallback(
    (item: LayerItem, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!board) return;
      const id = item.element.id!;
      const willLock = !lockedIds.has(id);

      setLockedIds((prev) => {
        const next = new Set(prev);
        if (willLock) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });

      const currentIndex = (board.children as PlaitElement[]).findIndex(
        (child) => child.id === id
      );
      if (currentIndex < 0) {
        return;
      }

      Transforms.setNode(board, { locked: willLock } as any, [currentIndex]);
    },
    [board, lockedIds]
  );

  if (!board) {
    return (
      <div className="layer-panel__empty">
        <p>画布未初始化</p>
      </div>
    );
  }

  if (layers.length === 0) {
    return (
      <div className="layer-panel__empty">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          style={{ color: 'var(--td-text-color-placeholder)' }}
        >
          <path
            d="M12 2L2 7l10 5 10-5-10-5z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M2 17l10 5 10-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M2 12l10 5 10-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <p>当前画布没有元素</p>
      </div>
    );
  }

  return (
    <div className="layer-panel">
      <div className="layer-panel__header">
        <span className="layer-panel__title">图层</span>
        <span className="layer-panel__count">{layers.length} 个元素</span>
        {semanticGroups.length > 0 && (
          <div className="layer-panel__exports">
            {semanticGroups.map((group) => (
              <HoverTip key={group.id} content="导出分层 ZIP">
                <button
                  type="button"
                  className="layer-panel__action-btn"
                  onClick={() => void exportGroup(group)}
                >
                  <DownloadIcon />
                </button>
              </HoverTip>
            ))}
          </div>
        )}
      </div>

      <div className="layer-panel__list">
        {layers.map((item) => (
          <div
            key={item.element.id}
            className={`layer-panel__item${
              selectedId === item.element.id ? ' layer-panel__item--active' : ''
            }${item.hidden ? ' layer-panel__item--hidden' : ''}`}
            onClick={() => handleLayerClick(item)}
          >
            <div className="layer-panel__item-icon">{item.icon}</div>

            <div className="layer-panel__item-content">
              {editingId === item.element.id ? (
                <input
                  autoFocus
                  className="layer-panel__item-name-input"
                  value={editingName}
                  maxLength={128}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setEditingName(event.target.value)}
                  onBlur={() => commitRename(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span className="layer-panel__item-name">{item.name}</span>
              )}
              {item.semantic && (
                <span className="layer-panel__item-meta">
                  {item.semantic.kind === 'background' ? '背景' : `z ${item.semantic.zIndex}`}
                </span>
              )}
            </div>

            <div className="layer-panel__item-actions">
              {item.semantic && (
                <HoverTip content="重命名">
                  <button
                    type="button"
                    className="layer-panel__action-btn"
                    aria-label="重命名图层"
                    onClick={(event) => startRename(item, event)}
                  >
                    <Pencil size={14} />
                  </button>
                </HoverTip>
              )}
              <HoverTip content={item.hidden ? '显示' : '隐藏'}>
                <button
                  type="button"
                  className={`layer-panel__action-btn${
                    item.hidden ? ' layer-panel__action-btn--active' : ''
                  }`}
                  onClick={(e) => toggleVisibility(item, e)}
                >
                  {item.hidden ? (
                    <BrowseOffIcon size="16px" />
                  ) : (
                    <BrowseIcon size="16px" />
                  )}
                </button>
              </HoverTip>
              <HoverTip content={item.locked ? '解锁' : '锁定'}>
                <button
                  type="button"
                  className={`layer-panel__action-btn${
                    item.locked ? ' layer-panel__action-btn--active' : ''
                  }`}
                  onClick={(e) => toggleLock(item, e)}
                >
                  {item.locked ? (
                    <LockOnIcon size="16px" />
                  ) : (
                    <LockOffIcon size="16px" />
                  )}
                </button>
              </HoverTip>
              {item.semantic?.kind === 'foreground' && (
                <>
                  <HoverTip content="上移一层">
                    <button
                      type="button"
                      className="layer-panel__action-btn"
                      aria-label="上移一层"
                      onClick={(e) => moveSemanticLayer(item, 'up', e)}
                    >
                      <ArrowUp size={14} />
                    </button>
                  </HoverTip>
                  <HoverTip content="下移一层">
                    <button
                      type="button"
                      className="layer-panel__action-btn"
                      aria-label="下移一层"
                      onClick={(e) => moveSemanticLayer(item, 'down', e)}
                    >
                      <ArrowDown size={14} />
                    </button>
                  </HoverTip>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
