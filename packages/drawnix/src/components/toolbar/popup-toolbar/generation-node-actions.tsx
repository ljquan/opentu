import React from 'react';
import {
  deleteFragment,
  duplicateElements,
  PlaitBoard,
  PlaitElement,
} from '@plait/core';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import {
  isGenerationNode,
  notifyGenerationNodeChange,
} from '../../../services/generation-node';

/** Keep draft actions visible without exposing ordinary shape styling controls. */
export function GenerationNodeActions({
  board,
  elements,
  language,
}: {
  board: PlaitBoard;
  elements: PlaitElement[];
  language: string;
}) {
  const zh = language === 'zh';
  const singleNode =
    elements.length === 1 && isGenerationNode(elements[0]) ? elements[0] : null;
  const hasNodes = elements.some(isGenerationNode);
  return (
    <div
      className="generation-node-actions"
      role="toolbar"
      aria-label={zh ? '生成卡片操作' : 'Generation card actions'}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerUp={(event) => event.stopPropagation()}
    >
      {singleNode && (
        <button
          type="button"
          onClick={() => notifyGenerationNodeChange(board, singleNode.id)}
        >
          <Pencil size={16} aria-hidden="true" />
          {zh ? '编辑' : 'Edit'}
        </button>
      )}
      {hasNodes && (
        <button type="button" onClick={() => duplicateElements(board)}>
          <Copy size={16} aria-hidden="true" />
          {zh ? '复制' : 'Duplicate'}
        </button>
      )}
      <button
        type="button"
        className="generation-node-actions__delete"
        title={
          zh ? '删除选中项，可撤销恢复' : 'Delete selection; undo to restore'
        }
        onClick={() => deleteFragment(board)}
      >
        <Trash2 size={16} aria-hidden="true" />
        {zh ? '删除' : 'Delete'}
      </button>
    </div>
  );
}
