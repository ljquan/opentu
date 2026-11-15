import { useEffect, useRef, useState } from 'react';
import {
  clearSelectedElement,
  getSelectedElements,
  PlaitBoard,
  RectangleClient,
  Transforms,
} from '@plait/core';
import {
  GENERATION_NODE_CHANGE,
  GenerationNodeData,
  GenerationNodeReference,
  isGenerationNode,
  snapshotGenerationReferences,
  updateGenerationNode,
} from '../services/generation-node';

export interface GenerationNodeEditor {
  read: () => GenerationNodeData;
  load: (data: GenerationNodeData, starting: boolean) => void;
  detach: (boardChanged: boolean) => void;
  unsupported: () => void;
}

/** The canvas draft owns references; the existing input bar is its editor. */
export function useGenerationNodeDraft(
  boardRef: React.MutableRefObject<PlaitBoard | null>,
  boardId: string | null | undefined,
  editor: GenerationNodeEditor,
  value: GenerationNodeData
) {
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [missingReferences, setMissingReferences] = useState('');
  const [rect, setRect] = useState<RectangleClient | null>(null);
  const active = useRef<{
    id: string;
    board: PlaitBoard;
    boardId: string | null | undefined;
    data: GenerationNodeData;
  } | null>(null);
  const writing = useRef(false);
  const loading = useRef<GenerationNodeData | null>(null);
  const lastEditorValue = useRef<string | null>(null);
  const unsupportedId = useRef<string | null>(null);
  const dismissedId = useRef<string | null>(null);
  const end = (clearSelection = true) => {
    dismissedId.current = active.current?.id || null;
    const boardChanged = active.current?.boardId !== latestBoardId.current;
    const board = active.current?.board;
    active.current = null;
    loading.current = null;
    lastEditorValue.current = null;
    setActiveId(null);
    setRect(null);
    setMissingReferences('');
    if (board && !boardChanged && clearSelection) {
      clearSelectedElement(board);
      Transforms.setSelection(board, null);
    }
    editorRef.current.detach(boardChanged);
  };
  const latestBoardId = useRef(boardId);
  latestBoardId.current = boardId;
  useEffect(() => {
    if (active.current && active.current.boardId !== boardId) end();
  }, [boardId]);
  useEffect(() => {
    const handle = (event: Event) => {
      const { board, openNodeId } = (
        event as CustomEvent<{ board: PlaitBoard; openNodeId?: string }>
      ).detail;
      if (board !== boardRef.current || writing.current) return;
      // Selection may still hold the previous immutable element during history updates.
      const selected = getSelectedElements(board)
        .map((element) =>
          board.children.find((current) => current.id === element.id)
        )
        .filter((element): element is NonNullable<typeof element> => !!element);
      if (
        selected.length === 1 &&
        selected[0].generationNode &&
        !isGenerationNode(selected[0])
      ) {
        if (unsupportedId.current !== selected[0].id) {
          unsupportedId.current = selected[0].id;
          editorRef.current.unsupported();
        }
        return;
      }
      unsupportedId.current = null;
      const selectedNode =
        selected.length === 1 && isGenerationNode(selected[0])
          ? selected[0]
          : null;
      if (!selectedNode || selectedNode.id === openNodeId)
        dismissedId.current = null;
      if (!active.current && selectedNode?.id === dismissedId.current) return;
      const current = active.current;
      if (!selectedNode && current) {
        end(false);
        return;
      }
      const node =
        selectedNode ||
        (current && current.board === board
          ? board.children.find((el) => el.id === current.id)
          : null);
      if (!isGenerationNode(node)) {
        if (current) end();
        return;
      }
      const nextRect = board.getRectangle(node);
      setRect((previous) =>
        JSON.stringify(previous) === JSON.stringify(nextRect)
          ? previous
          : nextRect
      );
      setMissingReferences(
        node.generationNode.references
          .flatMap((ref, index) =>
            ref.sourceElementId &&
            !board.children.some(
              (el) => el.id === ref.sourceElementId && el.type === 'image'
            )
              ? [`参考图 ${index + 1}`]
              : []
          )
          .join('、')
      );
      const changed =
        !current ||
        current.id !== node.id ||
        current.boardId !== latestBoardId.current ||
        JSON.stringify(current.data) !== JSON.stringify(node.generationNode);
      if (!changed) return;
      const data = structuredClone(node.generationNode);
      active.current = {
        id: node.id,
        board,
        boardId: latestBoardId.current,
        data,
      };
      loading.current = data;
      setActiveId(node.id);
      editorRef.current.load(
        {
          ...data,
          references: snapshotGenerationReferences(data, board.children),
        },
        !current
      );
    };
    window.addEventListener(GENERATION_NODE_CHANGE, handle);
    const frame = requestAnimationFrame(() => {
      if (boardRef.current)
        handle(
          new CustomEvent(GENERATION_NODE_CHANGE, {
            detail: { board: boardRef.current },
          })
        );
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(GENERATION_NODE_CHANGE, handle);
    };
  }, [boardRef]);

  // Bind an autosave effect to the canvas revision used by this render. An undo
  // can arrive before React commits its loaded editor state; that older render
  // must not write back and clear the redo stack.
  const renderedSession = active.current;
  useEffect(() => {
    const session = active.current;
    if (
      !session ||
      session !== renderedSession ||
      session.id !== activeId ||
      session.boardId !== boardId ||
      session.board !== boardRef.current
    )
      return;
    const node = session.board.children.find((el) => el.id === session.id);
    if (!isGenerationNode(node)) return;
    // An external canvas edit wins over an effect from the previous render.
    if (JSON.stringify(node.generationNode) !== JSON.stringify(session.data))
      return;
    const data = editorRef.current.read();
    const serialized = JSON.stringify(data);
    if (loading.current) {
      const loaded = loading.current;
      const referenceIdentity = (draft: GenerationNodeData) =>
        JSON.stringify(
          draft.references.map((ref) => [ref.referenceId, ref.role])
        );
      if (
        data.prompt !== loaded.prompt ||
        data.generationType !== loaded.generationType ||
        data.count !== loaded.count ||
        referenceIdentity(data) !== referenceIdentity(loaded) ||
        (loaded.model && data.model !== loaded.model) ||
        (loaded.modelRef &&
          JSON.stringify(data.modelRef) !== JSON.stringify(loaded.modelRef)) ||
        JSON.stringify(data.params) !== JSON.stringify(loaded.params)
      )
        return;
      loading.current = null;
      lastEditorValue.current = serialized;
      return;
    }
    if (serialized === lastEditorValue.current) return;
    lastEditorValue.current = serialized;
    if (JSON.stringify(data) === JSON.stringify(session.data)) return;
    session.data = structuredClone(data);
    writing.current = true;
    try {
      updateGenerationNode(session.board, session.id, data);
    } finally {
      writing.current = false;
    }
  }, [value, activeId, boardId, boardRef]);

  const setRole = (
    referenceId: string,
    role: GenerationNodeReference['role']
  ) => {
    const session = active.current;
    if (!session) return;
    updateGenerationNode(session.board, session.id, {
      ...session.data,
      references: session.data.references.map((ref) =>
        ref.referenceId === referenceId ? { ...ref, role } : ref
      ),
    });
  };
  return { activeId, activeRef: active, rect, end, setRole, missingReferences };
}
