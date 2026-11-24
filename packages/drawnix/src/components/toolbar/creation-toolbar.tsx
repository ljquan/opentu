import React, {
  Suspense,
  lazy,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import classNames from 'classnames';
import { Z_INDEX } from '../../constants/z-index';
import { Island } from '../island';
import Stack from '../stack';
import { ToolButton } from '../tool-button';
import {
  HandIcon,
  MindIcon,
  SelectionIcon,
  LassoIcon,
  ShapeIcon,
  TextIcon,
  StraightArrowLineIcon,
  FeltTipPenIcon,
  MediaLibraryIcon,
  AIImageIcon,
  AIVideoIcon,
  ThemeIcon,
  MermaidLogoIcon,
  MarkdownLogoIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ImageUploadIcon,
} from '../icons';
import { useBoard } from '@plait-board/react-board';
import {
  ATTACHED_ELEMENT_CLASS_NAME,
  BoardTransforms,
  PlaitBoard,
  PlaitPointerType,
} from '@plait/core';
import { MindPointerType } from '@plait/mind';
import { BoardCreationMode, setCreationMode } from '@plait/common';
import {
  ArrowLineShape,
  BasicShapes,
  DrawPointerType,
  FlowchartSymbols,
} from '@plait/draw';
import { FreehandPanel, FREEHANDS } from './freehand-panel/freehand-panel';
import { ShapePicker } from '../shape-picker';
import { ArrowPicker } from '../arrow-picker';
import { MessagePlugin } from 'tdesign-react';
import { SelectionMode, Asset, AssetType } from '../../types/asset.types';
import { insertImageFromUrl } from '../../data/image';
import { insertVideoFromUrl } from '../../data/video';
import { insertAudioFromUrl } from '../../data/audio';
import { getCanvasBoardBinding } from '../../services/canvas-operations/canvas-board-ref';
import { logCanvasInsertionDebug } from '../../utils/canvas-insertion-layout';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';
import { FreehandShape } from '../../plugins/freehand/type';
import { PenShape } from '../../plugins/pen/type';
import { LassoPointerType } from '../../plugins/with-lasso-selection';
import { finishPenOnToolSwitch } from '../../plugins/pen/with-pen-create';
import { fitFrame } from '../../utils/fit-frame';
import {
  DrawnixPointerType,
  DialogType,
  useDrawnix,
  useSetPointer,
} from '../../hooks/use-drawnix';
import { addImage } from '../../utils/image';
import { useI18n, Translations } from '../../i18n';
import { ToolbarSectionProps } from './toolbar.types';
import { useToolbarConfig } from '../../hooks/use-toolbar-config';
import { useDragSort } from '../../hooks/use-drag-sort';
import { ToolbarContextMenu } from './toolbar-context-menu';
import Menu from '../menu/menu';
import MenuItem from '../menu/menu-item';
import {
  THEME_OPTIONS,
  CheckIcon,
  isBasicPointer,
  EmptyIcon,
} from './toolbar-shared';
import { MoreToolsButton } from './more-tools-button';
import { HoverTip } from '../shared/hover';

const MediaLibraryModal = lazy(() =>
  import('../media-library/MediaLibraryModal').then((module) => ({
    default: module.MediaLibraryModal,
  }))
);
const MinimizedToolsBar = lazy(() =>
  import('./minimized-tools-bar').then((module) => ({
    default: module.MinimizedToolsBar,
  }))
);

export enum PopupKey {
  'shape' = 'shape',
  'arrow' = 'arrow',
  'freehand' = 'freehand',
  'theme' = 'theme',
}

type AppToolButtonProps = {
  titleKey?: string;
  name?: string;
  icon: React.ReactNode;
  pointer?: DrawnixPointerType;
  key?:
    | PopupKey
    | 'image'
    | 'media-library'
    | 'ai-image'
    | 'ai-video'
    | 'extra-tools'
    | 'mermaid-to-drawnix'
    | 'markdown-to-drawnix';
  /** 用于可见性检查的 key，对应 TOOLBAR_GROUPS 中的 buttonKeys */
  visibilityKey?: string;
};

export const BUTTONS: AppToolButtonProps[] = [
  {
    icon: <HandIcon />,
    pointer: PlaitPointerType.hand,
    titleKey: 'toolbar.hand',
    visibilityKey: 'hand',
  },
  {
    icon: <SelectionIcon />,
    pointer: PlaitPointerType.selection,
    titleKey: 'toolbar.selection',
    visibilityKey: 'selection',
  },
  {
    icon: <LassoIcon />,
    pointer: LassoPointerType,
    titleKey: 'toolbar.lasso',
    visibilityKey: 'lasso',
  },
  {
    icon: <MindIcon />,
    pointer: MindPointerType.mind,
    titleKey: 'toolbar.mind',
    visibilityKey: 'mind',
  },
  {
    icon: <TextIcon />,
    pointer: BasicShapes.text,
    titleKey: 'toolbar.text',
    visibilityKey: 'text',
  },
  {
    icon: <ImageUploadIcon size={24} />,
    titleKey: 'toolbar.image',
    key: 'image',
    visibilityKey: 'image',
  },
  {
    icon: <MediaLibraryIcon size={24} />,
    titleKey: 'toolbar.mediaLibrary',
    key: 'media-library',
    visibilityKey: 'media-library',
  },
  {
    icon: <AIImageIcon />,
    titleKey: 'toolbar.aiImage',
    key: 'ai-image',
    visibilityKey: 'ai-image',
  },
  {
    icon: <AIVideoIcon />,
    titleKey: 'toolbar.aiVideo',
    key: 'ai-video',
    visibilityKey: 'ai-video',
  },
  {
    icon: <MindIcon />,
    pointer: MindPointerType.mind,
    titleKey: 'toolbar.mind',
    visibilityKey: 'mind',
  },
  {
    icon: <FeltTipPenIcon />,
    pointer: FreehandShape.feltTipPen,
    titleKey: 'toolbar.pen',
    key: PopupKey.freehand,
    visibilityKey: 'freehand',
  },
  {
    icon: <StraightArrowLineIcon />,
    titleKey: 'toolbar.arrow',
    key: PopupKey.arrow,
    pointer: ArrowLineShape.straight,
    visibilityKey: 'arrow',
  },
  {
    icon: <ShapeIcon />,
    titleKey: 'toolbar.shape',
    key: PopupKey.shape,
    pointer: BasicShapes.rectangle,
    visibilityKey: 'shape',
  },
  {
    icon: <ThemeIcon />,
    titleKey: 'toolbar.theme',
    key: PopupKey.theme,
    visibilityKey: 'theme',
  },
  {
    icon: <MermaidLogoIcon />,
    titleKey: 'extraTools.mermaidToDrawnix',
    key: 'mermaid-to-drawnix',
    visibilityKey: 'mermaid-to-drawnix',
  },
  {
    icon: <MarkdownLogoIcon />,
    titleKey: 'extraTools.markdownToDrawnix',
    key: 'markdown-to-drawnix',
    visibilityKey: 'markdown-to-drawnix',
  },
];

// TODO provider by plait/draw
export const isArrowLinePointer = (board: PlaitBoard) => {
  return Object.keys(ArrowLineShape).includes(board.pointer);
};

export const isShapePointer = (board: PlaitBoard) => {
  return (
    Object.keys(BasicShapes).includes(board.pointer) ||
    Object.keys(FlowchartSymbols).includes(board.pointer)
  );
};

export const CreationToolbar: React.FC<ToolbarSectionProps> = ({
  embedded = false,
  iconMode = false,
  onOpenMediaLibrary,
  minimizedToolsBarEnabled = false,
  onEnableToolWindows,
}) => {
  const board = useBoard();
  const { appState, openDialog } = useDrawnix();
  const { t } = useI18n();
  const setPointer = useSetPointer();
  const container = PlaitBoard.getBoardContainer(board);
  const {
    visibleButtons,
    loading: configLoading,
    reorderButton,
  } = useToolbarConfig();

  // 拖拽排序
  const { getDragProps } = useDragSort({
    items: visibleButtons,
    getId: (item) => item.id,
    onReorder: (fromIndex, toIndex) => {
      reorderButton(fromIndex, toIndex, true);
    },
    enabled: embedded, // 只在嵌入模式下启用拖拽
  });

  // 统一的 Popover 状态管理
  const [openPopovers, setOpenPopovers] = useState<Record<PopupKey, boolean>>({
    [PopupKey.freehand]: false,
    [PopupKey.arrow]: false,
    [PopupKey.shape]: false,
    [PopupKey.theme]: false,
  });

  // 追踪是否是 hover 触发的
  const [hoverPopover, setHoverPopover] = useState<PopupKey | null>(null);
  const hoverTimeoutRef = useRef<Record<PopupKey, NodeJS.Timeout | null>>({
    [PopupKey.freehand]: null,
    [PopupKey.arrow]: null,
    [PopupKey.shape]: null,
    [PopupKey.theme]: null,
  });

  const [lastFreehandButton, setLastFreehandButton] =
    useState<AppToolButtonProps>(
      BUTTONS.find((button) => button.key === PopupKey.freehand)!
    );

  // 素材库状态
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);

  // 插入素材到画板
  const handleInsertAsset = useCallback(
    async (asset: Asset) => {
      try {
        if (asset.type === AssetType.IMAGE) {
          await insertImageFromUrl(board, asset.url);
        } else if (asset.type === AssetType.VIDEO) {
          await insertVideoFromUrl(board, asset.url);
        } else if (asset.type === AssetType.AUDIO) {
          await insertAudioFromUrl(board, asset.url, {
            title: asset.name,
            duration: asset.duration,
            previewImageUrl: asset.thumbnail,
            prompt: asset.prompt,
            mv: asset.modelName,
            clipId: asset.clipId,
            providerTaskId: asset.providerTaskId,
          });
        }
        MessagePlugin.success('素材已插入到画板');
      } catch (error) {
        console.error('Failed to insert asset:', error);
        MessagePlugin.error('插入素材失败');
      }
    },
    [board]
  );

  const handleInsertMultipleAssets = useCallback(
    async (assets: Asset[]) => {
      if (assets.length === 0) return;

      logCanvasInsertionDebug('[CanvasInsertion][Toolbar] batch assets begin', {
        source: 'creation-toolbar',
        strategy: 'shared-batch-layout',
        assetsCount: assets.length,
        assetTypes: assets.map((asset) => asset.type),
        zoom: (board as any)?.viewport?.zoom || 1,
      });

      const binding = getCanvasBoardBinding();
      try {
        const { executeCanvasInsertion } = await import(
          '../../services/canvas-operations/canvas-insertion'
        );
        const boardGuard = () => getCanvasBoardBinding() === binding;
        if (!boardGuard()) return;
        const insertionResult = await executeCanvasInsertion({
          board,
          boardGuard,
          items: assets.map((asset) => {
            if (asset.type === AssetType.IMAGE) {
              return { type: 'image' as const, content: asset.url };
            }

            if (asset.type === AssetType.VIDEO) {
              return { type: 'video' as const, content: asset.url };
            }

            return {
              type: 'audio' as const,
              content: asset.url,
              metadata: {
                title: asset.name,
                duration: asset.duration,
                previewImageUrl: asset.thumbnail,
                prompt: asset.prompt,
                mv: asset.modelName,
                clipId: asset.clipId,
                providerTaskId: asset.providerTaskId,
              },
            };
          }),
        });

        if (insertionResult.success) {
          const insertedCount =
            (insertionResult.data as { insertedCount?: number } | undefined)
              ?.insertedCount ?? assets.length;
          MessagePlugin.success(`已成功插入 ${insertedCount} 个素材到画板`);
        } else {
          MessagePlugin.error(insertionResult.error || '插入素材失败');
        }
      } catch (error) {
        console.error('Failed to load canvas insertion:', error);
        MessagePlugin.error('插入素材失败，请重试');
      }
    },
    [board]
  );

  // 打开素材库
  const handleOpenMediaLibrary = useCallback(() => {
    if (onOpenMediaLibrary) {
      onOpenMediaLibrary({
        mode: SelectionMode.SELECT,
        onSelect: handleInsertAsset,
        onSelectMultiple: handleInsertMultipleAssets,
        selectButtonText: '插入',
        batchSelectButtonText: '批量插入画布',
      });
      return;
    }
    setMediaLibraryOpen(true);
  }, [handleInsertAsset, handleInsertMultipleAssets, onOpenMediaLibrary]);

  // 关闭素材库
  const handleCloseMediaLibrary = useCallback(() => {
    setMediaLibraryOpen(false);
  }, []);

  // 统一重置所有 Popover
  const resetAllPopovers = () => {
    setOpenPopovers({
      [PopupKey.freehand]: false,
      [PopupKey.arrow]: false,
      [PopupKey.shape]: false,
      [PopupKey.theme]: false,
    });
    setHoverPopover(null);
    // 清除所有定时器
    Object.values(hoverTimeoutRef.current).forEach((timeout) => {
      if (timeout) clearTimeout(timeout);
    });
  };

  // 统一激活指定 Popover (点击触发)
  const showPopover = (key: PopupKey) => {
    // 清除 hover 状态
    setHoverPopover(null);
    Object.values(hoverTimeoutRef.current).forEach((timeout) => {
      if (timeout) clearTimeout(timeout);
    });

    setOpenPopovers({
      [PopupKey.freehand]: false,
      [PopupKey.arrow]: false,
      [PopupKey.shape]: false,
      [PopupKey.theme]: false,
      [key]: true,
    });
  };

  // Hover 进入时显示 Popover
  const handleMouseEnter = (key: PopupKey) => {
    // 清除之前的定时器
    if (hoverTimeoutRef.current[key]) {
      clearTimeout(hoverTimeoutRef.current[key]!);
    }

    // 清除其他所有 Popover 的定时器
    Object.entries(hoverTimeoutRef.current).forEach(([popupKey, timeout]) => {
      if (popupKey !== key && timeout) {
        clearTimeout(timeout);
        hoverTimeoutRef.current[popupKey as PopupKey] = null;
      }
    });

    // 如果当前有其他 hover 触发的 Popover 正在显示，立即切换
    if (hoverPopover && hoverPopover !== key) {
      setOpenPopovers((prev) => ({
        ...prev,
        [hoverPopover]: false,
        [key]: true,
      }));
      setHoverPopover(key);
    }
    // 如果没有被点击打开，则通过 hover 打开
    else if (!openPopovers[key]) {
      hoverTimeoutRef.current[key] = setTimeout(() => {
        setOpenPopovers((prev) => ({
          ...prev,
          [key]: true,
        }));
        setHoverPopover(key);
      }, 300); // 300ms 延迟，避免误触
    }
  };

  // Hover 离开时隐藏 Popover
  const handleMouseLeave = (key: PopupKey) => {
    // 清除进入的定时器
    if (hoverTimeoutRef.current[key]) {
      clearTimeout(hoverTimeoutRef.current[key]!);
      hoverTimeoutRef.current[key] = null;
    }

    // 只有当是 hover 触发的才自动关闭
    if (hoverPopover === key) {
      hoverTimeoutRef.current[key] = setTimeout(() => {
        setOpenPopovers((prev) => ({
          ...prev,
          [key]: false,
        }));
        setHoverPopover(null);
      }, 200); // 200ms 延迟，允许鼠标移动到 Popover 或其他按钮
    }
  };

  // Popover 内容区域的 hover 事件
  const handlePopoverMouseEnter = (key: PopupKey) => {
    // 清除离开的定时器
    if (hoverTimeoutRef.current[key]) {
      clearTimeout(hoverTimeoutRef.current[key]!);
      hoverTimeoutRef.current[key] = null;
    }
  };

  const handlePopoverMouseLeave = (key: PopupKey) => {
    // 只有当是 hover 触发的才自动关闭
    if (hoverPopover === key) {
      setOpenPopovers((prev) => ({
        ...prev,
        [key]: false,
      }));
      setHoverPopover(null);
    }
  };

  const onPointerDown = (pointer: DrawnixPointerType) => {
    // 切换工具前，结束钢笔绘制
    finishPenOnToolSwitch(board);
    if (pointer === BasicShapes.text) {
      // 文本工具：清除创建模式，改为双击画布创建
      setCreationMode(board, null as any);
      BoardTransforms.updatePointerType(board, pointer);
      setPointer(pointer);
    } else {
      setCreationMode(board, BoardCreationMode.dnd);
      BoardTransforms.updatePointerType(board, pointer);
      setPointer(pointer);
    }
  };

  const onPointerUp = (pointer?: DrawnixPointerType) => {
    if (pointer === BasicShapes.text) return;
    setCreationMode(board, BoardCreationMode.drawing);
  };

  const hasOpenPopover = () => {
    return Object.values(openPopovers).some((isOpen) => isOpen);
  };

  const isChecked = (button: AppToolButtonProps) => {
    return PlaitBoard.isPointer(board, button.pointer) && !hasOpenPopover();
  };

  const checkCurrentPointerIsFreehand = (board: PlaitBoard) => {
    return PlaitBoard.isInPointer(board, [
      FreehandShape.feltTipPen,
      FreehandShape.mask,
      FreehandShape.eraser,
      FreehandShape.laserPointer,
      PenShape.pen,
    ]);
  };

  // 统一的按钮点击处理
  const handleButtonClick = (button: AppToolButtonProps) => {
    resetAllPopovers();

    // 切换工具前，结束钢笔绘制
    finishPenOnToolSwitch(board);

    if (button.pointer && !isBasicPointer(button.pointer)) {
      onPointerUp(button.pointer);
    } else if (button.pointer && isBasicPointer(button.pointer)) {
      BoardTransforms.updatePointerType(board, button.pointer);
      setPointer(button.pointer);
    }

    // 特殊按钮处理
    if (button.key === 'image') {
      addImage(board);
    } else if (button.key === 'media-library') {
      handleOpenMediaLibrary();
    } else if (button.key === 'ai-image') {
      openDialog(DialogType.aiImageGeneration);
    } else if (button.key === 'ai-video') {
      openDialog(DialogType.aiVideoGeneration);
    } else if (button.key === 'mermaid-to-drawnix') {
      openDialog(DialogType.mermaidToDrawnix);
    } else if (button.key === 'markdown-to-drawnix') {
      openDialog(DialogType.markdownToDrawnix);
    }
  };

  // 渲染带 Popover 的按钮
  const renderPopoverButton = (
    button: AppToolButtonProps,
    index: number,
    popupKey: PopupKey
  ) => {
    // 根据不同的 popupKey 获取对应的内容和选中状态
    const getPopoverContent = () => {
      switch (popupKey) {
        case PopupKey.freehand:
          return (
            <FreehandPanel
              onPointerUp={(pointer: DrawnixPointerType) => {
                resetAllPopovers();
                setPointer(pointer);
                setLastFreehandButton(
                  FREEHANDS.find((btn) => btn.pointer === pointer)!
                );
              }}
            />
          );
        case PopupKey.shape:
          return (
            <ShapePicker
              onPointerUp={(pointer: DrawPointerType) => {
                resetAllPopovers();
                setPointer(pointer);
              }}
            />
          );
        case PopupKey.arrow:
          return (
            <ArrowPicker
              onPointerUp={(pointer: DrawPointerType) => {
                resetAllPopovers();
                setPointer(pointer);
              }}
            />
          );
        case PopupKey.theme:
          return (
            <Menu>
              {THEME_OPTIONS.map((option) => {
                const isSelected = board.theme.themeColorMode === option.value;
                return (
                  <MenuItem
                    key={option.value}
                    icon={isSelected ? CheckIcon : EmptyIcon}
                    data-track={`toolbar_click_theme_${option.value}`}
                    onSelect={() => {
                      BoardTransforms.updateThemeColor(board, option.value);
                      resetAllPopovers();
                    }}
                    aria-label={t(option.labelKey)}
                    selected={isSelected}
                  >
                    {t(option.labelKey)}
                  </MenuItem>
                );
              })}
            </Menu>
          );
      }
    };

    const getIsSelected = () => {
      const isPopoverOpen = openPopovers[popupKey];
      const hasOtherPopoverOpen = Object.entries(openPopovers).some(
        ([key, isOpen]) => key !== popupKey && isOpen
      );

      switch (popupKey) {
        case PopupKey.freehand:
          return (
            isPopoverOpen ||
            (checkCurrentPointerIsFreehand(board) && !hasOtherPopoverOpen)
          );
        case PopupKey.shape:
          return (
            isPopoverOpen ||
            (isShapePointer(board) &&
              !PlaitBoard.isPointer(board, BasicShapes.text))
          );
        case PopupKey.arrow:
          return isPopoverOpen || isArrowLinePointer(board);
        default:
          return isPopoverOpen;
      }
    };

    const displayIcon =
      popupKey === PopupKey.freehand ? lastFreehandButton.icon : button.icon;
    const displayTitle =
      popupKey === PopupKey.freehand
        ? lastFreehandButton.titleKey
          ? t(lastFreehandButton.titleKey as keyof Translations)
          : 'Freehand'
        : button.titleKey
        ? t(button.titleKey as keyof Translations)
        : '';

    return (
      <Popover
        key={index}
        open={openPopovers[popupKey]}
        sideOffset={12}
        onOpenChange={(open) => {
          if (!open) {
            resetAllPopovers();
          }
        }}
        placement={embedded ? 'right-start' : 'bottom'}
      >
        <PopoverTrigger asChild>
          <div
            onMouseEnter={() => handleMouseEnter(popupKey)}
            onMouseLeave={() => handleMouseLeave(popupKey)}
          >
            <ToolButton
              type="icon"
              visible={true}
              selected={getIsSelected()}
              icon={displayIcon}
              tooltip={displayTitle}
              aria-label={displayTitle}
              data-track={`toolbar_click_${popupKey}`}
              onPointerDown={() => {
                showPopover(popupKey);
                if (
                  popupKey === PopupKey.freehand &&
                  lastFreehandButton.pointer
                ) {
                  onPointerDown(lastFreehandButton.pointer);
                }
              }}
              onPointerUp={() => {
                if (popupKey === PopupKey.freehand) {
                  onPointerUp();
                }
              }}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          container={container}
          style={{ zIndex: Z_INDEX.POPOVER }}
          onMouseEnter={() => handlePopoverMouseEnter(popupKey)}
          onMouseLeave={() => handlePopoverMouseLeave(popupKey)}
        >
          {getPopoverContent()}
        </PopoverContent>
      </Popover>
    );
  };

  // 渲染普通按钮
  const renderNormalButton = (button: AppToolButtonProps, index: number) => {
    return (
      <ToolButton
        key={index}
        type="radio"
        icon={button.icon}
        checked={isChecked(button)}
        tooltip={
          button.titleKey ? t(button.titleKey as keyof Translations) : ''
        }
        tooltipPlacement={embedded ? 'right' : 'bottom'}
        aria-label={
          button.titleKey ? t(button.titleKey as keyof Translations) : ''
        }
        data-track={`toolbar_click_${button.pointer || button.key}`}
        onPointerDown={() => {
          if (button.pointer && !isBasicPointer(button.pointer)) {
            onPointerDown(button.pointer);
          }
        }}
        onPointerUp={() => {
          handleButtonClick(button);
        }}
      />
    );
  };

  // 创建按钮 ID 到按钮配置的映射
  const buttonMap = useMemo(() => {
    const map = new Map<string, AppToolButtonProps>();
    BUTTONS.forEach((button) => {
      if (button.visibilityKey) {
        map.set(button.visibilityKey, button);
      }
    });
    return map;
  }, []);

  // zoom 菜单状态
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);

  // 渲染 zoom 工具栏（embedded模式纵向，普通模式横向）
  const renderZoomToolbar = useCallback(
    (index: number) => {
      const StackComponent = embedded ? Stack.Col : Stack.Row;

      return (
        <div
          key={`zoom-${index}`}
          className={classNames('creation-toolbar__zoom-inline', {
            'creation-toolbar__zoom-inline--vertical': embedded,
          })}
        >
          <StackComponent gap={0}>
            <ToolButton
              type="button"
              icon={<ZoomOutIcon />}
              visible={true}
              tooltip={t('zoom.out')}
              tooltipPlacement={embedded ? 'right' : 'bottom'}
              aria-label={t('zoom.out')}
              data-track="toolbar_click_zoom_out"
              onPointerUp={() => {
                BoardTransforms.updateZoom(board, board.viewport.zoom - 0.1);
              }}
              className="zoom-out-button"
            />
            <Popover
              sideOffset={12}
              open={zoomMenuOpen}
              onOpenChange={(open) => {
                setZoomMenuOpen(open);
              }}
              placement={embedded ? 'right-start' : 'bottom'}
            >
              <HoverTip content={t('zoom.fit')} showArrow={false}>
                <PopoverTrigger asChild>
                  <div
                    aria-label={t('zoom.fit')}
                    data-track="toolbar_click_zoom_menu"
                    className={classNames('zoom-menu-trigger', {
                      active: zoomMenuOpen,
                    })}
                    onPointerUp={() => {
                      setZoomMenuOpen(!zoomMenuOpen);
                    }}
                  >
                    {Number(((board?.viewport?.zoom || 1) * 100).toFixed(0))}%
                  </div>
                </PopoverTrigger>
              </HoverTip>
              <PopoverContent
                container={container}
                style={{ zIndex: Z_INDEX.POPOVER }}
              >
                <Menu
                  onSelect={() => {
                    setZoomMenuOpen(false);
                  }}
                >
                  <MenuItem
                    data-track="toolbar_click_zoom_fit"
                    onSelect={() => {
                      BoardTransforms.fitViewport(board);
                    }}
                    aria-label={t('zoom.fit')}
                    shortcut={`Cmd+Shift+=`}
                  >
                    {t('zoom.fit')}
                  </MenuItem>
                  <MenuItem
                    data-track="toolbar_click_zoom_fit_frame"
                    onSelect={() => {
                      fitFrame(board);
                    }}
                    aria-label={t('zoom.fitFrame')}
                  >
                    {t('zoom.fitFrame')}
                  </MenuItem>
                  <MenuItem
                    data-track="toolbar_click_zoom_100"
                    onSelect={() => {
                      BoardTransforms.updateZoom(board, 1);
                    }}
                    aria-label={t('zoom.100')}
                    shortcut={`Cmd+0`}
                  >
                    {t('zoom.100')}
                  </MenuItem>
                </Menu>
              </PopoverContent>
            </Popover>
            <ToolButton
              type="button"
              icon={<ZoomInIcon />}
              visible={true}
              tooltip={t('zoom.in')}
              tooltipPlacement={embedded ? 'right' : 'bottom'}
              aria-label={t('zoom.in')}
              data-track="toolbar_click_zoom_in"
              onPointerUp={() => {
                BoardTransforms.updateZoom(board, board.viewport.zoom + 0.1);
              }}
              className="zoom-in-button"
            />
          </StackComponent>
        </div>
      );
    },
    [board, container, embedded, t, zoomMenuOpen]
  );

  // 根据按钮 ID 渲染按钮（不带拖拽包装）
  const renderButtonById = useCallback(
    (buttonId: string, index: number) => {
      // zoom 使用特殊渲染
      if (buttonId === 'zoom') {
        return renderZoomToolbar(index);
      }

      const button = buttonMap.get(buttonId);
      if (!button) return null;

      // 移动端隐藏手型工具
      if (appState.isMobile && button.pointer === PlaitPointerType.hand) {
        return null;
      }

      // 带 Popover 的按钮
      if (
        button.key &&
        Object.values(PopupKey).includes(button.key as PopupKey)
      ) {
        return renderPopoverButton(button, index, button.key as PopupKey);
      }

      // 普通按钮
      return renderNormalButton(button, index);
    },
    [
      buttonMap,
      appState.isMobile,
      renderPopoverButton,
      renderNormalButton,
      renderZoomToolbar,
    ]
  );

  // 渲染带拖拽和右键菜单功能的按钮
  const renderDraggableButton = useCallback(
    (buttonId: string, index: number, isVisible = true, visibleIndex = -1) => {
      const buttonElement = renderButtonById(buttonId, index);
      if (!buttonElement) return null;

      const dragProps = getDragProps(buttonId, index);

      return (
        <ToolbarContextMenu
          key={`ctx-${buttonId}-${index}`}
          buttonId={buttonId}
          isVisible={isVisible}
          visibleIndex={visibleIndex}
        >
          <div
            className={classNames('toolbar-button-wrapper', {
              'toolbar-button-wrapper--dragging': dragProps['data-dragging'],
              'toolbar-button-wrapper--drag-over': dragProps['data-drag-over'],
              'toolbar-button-wrapper--drag-before':
                dragProps['data-drag-position'] === 'before',
              'toolbar-button-wrapper--drag-after':
                dragProps['data-drag-position'] === 'after',
            })}
            data-button-id={buttonId}
            {...dragProps}
          >
            {buttonElement}
          </div>
        </ToolbarContextMenu>
      );
    },
    [renderButtonById, getDragProps]
  );

  const content = (
    <Stack.Row gap={1}>
      {/* 渲染可见按钮（按配置顺序） */}
      {!configLoading &&
        visibleButtons.map((buttonConfig, index) =>
          embedded
            ? renderDraggableButton(buttonConfig.id, index, true, index)
            : renderButtonById(buttonConfig.id, index)
        )}
      <MoreToolsButton embedded={embedded} />
      {/* 最小化工具栏 - 显示最小化和常驻的工具图标 */}
      {embedded && minimizedToolsBarEnabled && (
        <Suspense fallback={null}>
          <MinimizedToolsBar ensureToolWindowsEnabled={onEnableToolWindows} />
        </Suspense>
      )}
    </Stack.Row>
  );

  // 素材库弹窗
  const mediaLibraryModal = mediaLibraryOpen ? (
    <Suspense fallback={null}>
      <MediaLibraryModal
        isOpen={mediaLibraryOpen}
        onClose={handleCloseMediaLibrary}
        mode={SelectionMode.SELECT}
        onSelect={handleInsertAsset}
        onSelectMultiple={handleInsertMultipleAssets}
        selectButtonText="插入"
        batchSelectButtonText="批量插入画布"
      />
    </Suspense>
  ) : null;

  if (embedded) {
    return (
      <>
        <div
          className={classNames('draw-toolbar', {
            'draw-toolbar--embedded': embedded,
            'draw-toolbar--icon-only': iconMode,
          })}
        >
          {content}
        </div>
        {mediaLibraryModal}
      </>
    );
  }

  return (
    <>
      <Island
        padding={1}
        className={classNames('draw-toolbar', ATTACHED_ELEMENT_CLASS_NAME, {
          'draw-toolbar--embedded': embedded,
          'draw-toolbar--icon-only': iconMode,
        })}
      >
        {content}
      </Island>
      {mediaLibraryModal}
    </>
  );
};
