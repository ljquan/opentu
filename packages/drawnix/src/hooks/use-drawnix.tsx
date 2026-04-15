/**
 * A React context for sharing the board object, in a way that re-renders the
 * context whenever changes occur.
 */
import { PlaitBoard, PlaitPointerType } from '@plait/core';
import { createContext, useContext } from 'react';
import { MindPointerType } from '@plait/mind';
import { DrawPointerType } from '@plait/draw';
import { FreehandShape } from '../plugins/freehand/type';
import { PenShape } from '../plugins/pen/type';
import { LassoPointerType } from '../plugins/with-lasso-selection';
import { Editor } from 'slate';
import { LinkElement } from '@plait/common';

export enum DialogType {
  mermaidToDrawnix = 'mermaidToDrawnix',
  markdownToDrawnix = 'markdownToDrawnix',
  aiImageGeneration = 'aiImageGeneration',
  aiVideoGeneration = 'aiVideoGeneration',
}

export type DrawnixPointerType =
  | PlaitPointerType
  | MindPointerType
  | DrawPointerType
  | FreehandShape
  | PenShape
  | typeof import('../plugins/with-frame').FramePointerType
  | typeof LassoPointerType;

export interface DrawnixBoard extends PlaitBoard {
  appState: DrawnixState;
}

export type LinkState = {
  targetDom: HTMLElement;
  editor: Editor;
  targetElement: LinkElement;
  isEditing: boolean;
  isHovering: boolean;
  isHoveringOrigin: boolean;
};

export type DialogInitialData = {
  prompt?: string;
  width?: number;
  height?: number;
  duration?: number;
  resultUrl?: string;  // 已生成的结果URL,用于显示预览
  [key: string]: any;
};

export type DialogInitialDataByType = Partial<
  Record<DialogType, DialogInitialData | null>
>;

export type DrawnixState = {
  pointer: DrawnixPointerType;
  isMobile: boolean;
  isPencilMode: boolean;
  /** @deprecated 使用 openDialogTypes 代替，保留用于向后兼容 */
  openDialogType?: DialogType | null;
  /** 当前打开的弹窗类型集合，支持同时打开多个弹窗 */
  openDialogTypes: Set<DialogType>;
  /** @deprecated 使用 dialogInitialDataByType 代替，保留用于向后兼容 */
  dialogInitialData?: DialogInitialData | null;
  /** 按弹窗类型保存各自的初始化数据，避免多弹窗互相覆盖 */
  dialogInitialDataByType?: DialogInitialDataByType;
  openCleanConfirm: boolean;
  openSettings: boolean;
  openCommandPalette?: boolean;
  openCanvasSearch?: boolean;
  linkState?: LinkState | null;
  lastSelectedElementIds?: string[]; // 最近选中的元素IDs,用于AI生成插入位置计算
};

export const DrawnixContext = createContext<{
  appState: DrawnixState;
  setAppState: (appState: DrawnixState | ((prev: DrawnixState) => DrawnixState)) => void;
  board: DrawnixBoard | null;
} | null>(null);

export const useDrawnix = (): {
  appState: DrawnixState;
  setAppState: (appState: DrawnixState | ((prev: DrawnixState) => DrawnixState)) => void;
  board: DrawnixBoard | null;
  openDialog: (dialogType: DialogType, initialData?: DialogInitialData) => void;
  closeDialog: (dialogType: DialogType) => void;
} => {
  const context = useContext(DrawnixContext);

  if (!context) {
    throw new Error(
      `The \`useDrawnix\` hook must be used inside the <Drawnix> component's context.`
    );
  }

  const openDialog = (dialogType: DialogType, initialData?: DialogInitialData) => {
    // 使用函数式更新，确保始终使用最新的状态
    context.setAppState((prevState) => {
      const newOpenDialogTypes = new Set(prevState.openDialogTypes);
      newOpenDialogTypes.add(dialogType);
      const nextDialogInitialDataByType: DialogInitialDataByType = {
        ...(prevState.dialogInitialDataByType || {}),
        [dialogType]: initialData || null,
      };
      return {
        ...prevState,
        openDialogTypes: newOpenDialogTypes,
        dialogInitialData: initialData || null,
        dialogInitialDataByType: nextDialogInitialDataByType,
      };
    });
  };

  const closeDialog = (dialogType: DialogType) => {
    // 使用函数式更新，确保始终使用最新的状态
    context.setAppState((prevState) => {
      const newOpenDialogTypes = new Set(prevState.openDialogTypes);
      newOpenDialogTypes.delete(dialogType);
      const nextDialogInitialDataByType = {
        ...(prevState.dialogInitialDataByType || {}),
        [dialogType]: null,
      };
      return {
        ...prevState,
        openDialogTypes: newOpenDialogTypes,
        dialogInitialDataByType: nextDialogInitialDataByType,
      };
    });
  };

  return { ...context, openDialog, closeDialog };
};

export const useSetPointer = () => {
  const { appState, setAppState } = useDrawnix();
  return (pointer: DrawnixPointerType) => {
    setAppState({ ...appState, pointer });
  };
};
