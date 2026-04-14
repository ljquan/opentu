/**
 * FramePanel Component
 *
 * 在项目抽屉中展示当前画布的 Frame 列表
 * 支持点击聚焦到对应 Frame 视图
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { Input, Button, MessagePlugin, Tooltip, Loading } from 'tdesign-react';
import { SearchIcon, EditIcon, DeleteIcon, ViewListIcon, AddIcon, PlayCircleIcon, ImageIcon, LayersIcon, FileCopyIcon } from 'tdesign-icons-react';
import {
  PlaitBoard,
  PlaitElement,
  Path,
  BoardTransforms,
  RectangleClient,
  Transforms,
  clearSelectedElement,
  addSelectedElement,
} from '@plait/core';
import { PlaitFrame, isFrameElement } from '../../types/frame.types';
import { FrameTransforms } from '../../plugins/with-frame';
import { useDrawnix } from '../../hooks/use-drawnix';
import { useDragSort } from '../../hooks/use-drag-sort';
import { AddFrameDialog } from './AddFrameDialog';
import { FrameSlideshow } from './FrameSlideshow';
import { generateImage } from '../../mcp/tools/image-generation';
import {
  insertMediaIntoFrame,
  insertPPTImagePlaceholder,
  removePPTImagePlaceholder,
  setFramePPTImageStatus,
  setPPTImagePlaceholderStatus,
} from '../../utils/frame-insertion-utils';
import { getImageRegion, type PPTFrameMeta } from '../../services/ppt';
import { duplicateFrame, focusFrame } from '../../utils/frame-duplicate';
import { useI18n } from '../../i18n';
import { DownloadIcon } from '../icons';
import { exportAllPPTFrames, exportFramesToPPT } from '../../services/ppt/ppt-export-service';
import {
  ContextMenu,
  useContextMenuState,
  type ContextMenuEntry,
} from '../shared';
import { useConfirmDialog } from '../dialog/ConfirmDialog';

interface FrameInfo {
  frame: PlaitFrame;
  path: Path;
  listKey: string;
  isRoot: boolean;
  childCount: number;
  width: number;
  height: number;
  /** PPT 元数据（如果有） */
  pptMeta?: PPTFrameMeta;
}

export const FramePanel: React.FC = () => {
  const { board } = useDrawnix();
  const { language } = useI18n();
  const { confirm, confirmDialog } = useConfirmDialog({
    container: board ? PlaitBoard.getBoardContainer(board) : null,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [selectedFrameKey, setSelectedFrameKey] = useState<string | null>(null);
  const [addDialogVisible, setAddDialogVisible] = useState(false);
  const [slideshowVisible, setSlideshowVisible] = useState(false);
  const [generatingImageIds, setGeneratingImageIds] = useState<Set<string>>(new Set());
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const {
    contextMenu,
    open: openContextMenu,
    close: closeContextMenu,
  } = useContextMenuState<FrameInfo>();
  const [isExportingAllPPT, setIsExportingAllPPT] = useState(false);
  const [exportingFrameId, setExportingFrameId] = useState<string | null>(null);

  // 监听画布变化，强制刷新 Frame 列表
  // FramePanel 在 BoardContext（Wrapper）外部渲染，无法通过 BoardContext 的 v 版本号触发重渲染
  // 因此需要通过包装 board.afterChange 来检测 children 变化
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

  // 收集画布中的所有 Frame 及其信息（支持嵌套结构）
  const frames: FrameInfo[] = useMemo(() => {
    if (!board || !board.children) return [];

    const result: FrameInfo[] = [];
    const childCountMap = new Map<string, number>();

    const walk = (elements: PlaitElement[], parentPath: Path = []) => {
      elements.forEach((element, index) => {
        const path: Path = [...parentPath, index];
        const frameId = (element as PlaitElement & { frameId?: string }).frameId;
        if (frameId) {
          childCountMap.set(frameId, (childCountMap.get(frameId) ?? 0) + 1);
        }

        if (isFrameElement(element)) {
          const frame = element as PlaitFrame;
          const rect = RectangleClient.getRectangleByPoints(frame.points);
          const pptMeta = (frame as any).pptMeta as PPTFrameMeta | undefined;
          result.push({
            frame,
            path,
            listKey: `${frame.id}-${path.join('.')}`,
            isRoot: parentPath.length === 0,
            childCount: 0,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            pptMeta,
          });
        }

        if (element.children && element.children.length > 0) {
          walk(element.children as PlaitElement[], path);
        }
      });
    };

    walk(board.children as PlaitElement[]);

    result.forEach((info) => {
      info.childCount = childCountMap.get(info.frame.id) ?? 0;
    });

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, refreshKey]);

  // 过滤 Frame
  const filteredFrames = useMemo(() => {
    if (!searchQuery.trim()) return frames;
    const query = searchQuery.toLowerCase().trim();
    return frames.filter((f) =>
      f.frame.name.toLowerCase().includes(query)
    );
  }, [frames, searchQuery]);

  const rootFrames = useMemo(() => {
    return frames.filter((item) => item.isRoot);
  }, [frames]);

  const rootIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    rootFrames.forEach((item, index) => {
      map.set(item.listKey, index);
    });
    return map;
  }, [rootFrames]);

  // 点击 Frame：选中并聚焦视图
  const handleFrameClick = useCallback(
    (frameInfo: FrameInfo) => {
      if (!board) return;

      setSelectedFrameKey(frameInfo.listKey);

      // 选中该 Frame
      clearSelectedElement(board);
      addSelectedElement(board, frameInfo.frame);

      // 计算 Frame 矩形
      const rect = RectangleClient.getRectangleByPoints(frameInfo.frame.points);
      const padding = 80;

      // 获取画布容器尺寸
      const container = PlaitBoard.getBoardContainer(board);
      let viewportWidth = container.clientWidth;
      let viewportHeight = container.clientHeight;

      // 获取左侧抽屉宽度（如果存在）
      const drawer = document.querySelector('.project-drawer');
      const drawerWidth = drawer ? (drawer as HTMLElement).offsetWidth : 0;

      // 获取底部输入框高度（如果存在）
      const inputBar = document.querySelector('.ai-input-bar');
      const inputBarHeight = inputBar ? (inputBar as HTMLElement).offsetHeight : 0;

      // 计算实际可见区域尺寸
      const visibleWidth = viewportWidth - drawerWidth;
      const visibleHeight = viewportHeight - inputBarHeight;

      // 计算缩放比例，让 Frame 适应可见区域
      const scaleX = visibleWidth / (rect.width + padding * 2);
      const scaleY = visibleHeight / (rect.height + padding * 2);
      const zoom = Math.min(scaleX, scaleY, 2);

      // 计算 Frame 中心点
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;

      // 计算可见区域的中心点（考虑抽屉和输入框的偏移）
      const visibleCenterX = drawerWidth + visibleWidth / 2;
      const visibleCenterY = visibleHeight / 2;

      // 计算 origination：使 Frame 中心对齐可见区域中心
      const origination: [number, number] = [
        centerX - visibleCenterX / zoom,
        centerY - visibleCenterY / zoom,
      ];

      BoardTransforms.updateViewport(board, origination, zoom);
    },
    [board]
  );

  // 开始重命名
  const handleStartRename = useCallback(
    (frameInfo: FrameInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingKey(frameInfo.listKey);
      setEditingName(frameInfo.frame.name);
    },
    []
  );

  // 完成重命名
  const handleFinishRename = useCallback(
    (frameInfo: FrameInfo) => {
      if (!board) return;
      const newName = editingName.trim();
      if (newName && newName !== frameInfo.frame.name) {
        Transforms.setNode(board, { name: newName } as any, frameInfo.path);
      }
      setEditingKey(null);
      setEditingName('');
    },
    [board, editingName]
  );

  // 删除 Frame
  const handleDelete = useCallback(
    async (frameInfo: FrameInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!board) return;

      const confirmed = await confirm({
        title: '确认删除 Frame',
        description: `确定要删除 Frame「${frameInfo.frame.name || '未命名 Frame'}」吗？此操作不可撤销。`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
      });

      if (!confirmed) {
        return;
      }

      // 先解绑所有子元素
      const children = FrameTransforms.getFrameChildren(board, frameInfo.frame);
      for (const child of children) {
        FrameTransforms.unbindFromFrame(board, child);
      }

      // 删除 Frame
      Transforms.removeNode(board, frameInfo.path);
      MessagePlugin.success('已删除 Frame');
    },
    [board, confirm]
  );

  // 复制 Frame
  const handleDuplicate = useCallback(
    (frameInfo: FrameInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!board) return;

      const clonedFrame = duplicateFrame(board, frameInfo.frame, language as 'zh' | 'en');

      // 如果复制成功，自动聚焦到新 Frame
      if (clonedFrame) {
        focusFrame(board, clonedFrame);
      }
    },
    [board, language]
  );

  const reorderFrames = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!board) return;

      const framePositions: number[] = [];
      const orderedFrames: PlaitFrame[] = [];

      board.children.forEach((element, index) => {
        if (isFrameElement(element)) {
          framePositions.push(index);
          orderedFrames.push(element as PlaitFrame);
        }
      });

      if (framePositions.length <= 1) return;

      const nextFrames = [...orderedFrames];
      const [moved] = nextFrames.splice(fromIndex, 1);
      nextFrames.splice(toIndex, 0, moved);

      for (let i = framePositions.length - 1; i >= 0; i -= 1) {
        Transforms.removeNode(board, [framePositions[i]]);
      }

      for (let i = 0; i < framePositions.length; i += 1) {
        Transforms.insertNode(board, nextFrames[i], [framePositions[i]]);
      }
    },
    [board]
  );

  const { getDragProps } = useDragSort({
    items: rootFrames,
    getId: (item) => item.listKey,
    onReorder: reorderFrames,
    enabled: !searchQuery.trim() && rootFrames.length > 1,
  });

  const noop = useCallback(() => {}, []);
  const getFrameDragProps = useCallback(
    (info: FrameInfo) => {
      if (!info.isRoot) {
        return {
          draggable: false,
          onDragStart: noop,
          onDragEnd: noop,
          onDragOver: noop,
          onDragEnter: noop,
          onDragLeave: noop,
          onDrop: noop,
          'data-dragging': false,
          'data-drag-over': false,
          'data-drag-position': undefined,
        };
      }
      const index = rootIndexMap.get(info.listKey) ?? 0;
      return getDragProps(info.listKey, index);
    },
    [getDragProps, rootIndexMap, noop]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, frameInfo: FrameInfo) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedFrameKey(frameInfo.listKey);
      openContextMenu(e, frameInfo);
    },
    [openContextMenu]
  );

  const handleContextMenuAction = useCallback(
    (action: 'rename' | 'duplicate' | 'delete', frameInfo: FrameInfo) => {
      if (action === 'rename') {
        setEditingKey(frameInfo.listKey);
        setEditingName(frameInfo.frame.name);
      }
      if (action === 'duplicate') {
        handleDuplicate(frameInfo);
      }
      if (action === 'delete') {
        void handleDelete(frameInfo);
      }
      closeContextMenu();
    },
    [handleDelete, handleDuplicate, closeContextMenu]
  );

  const contextMenuItems = useMemo<ContextMenuEntry<FrameInfo>[]>(() => [
    {
      key: 'rename',
      label: '重命名',
      icon: <EditIcon />,
      onSelect: (frameInfo) => handleContextMenuAction('rename', frameInfo),
    },
    {
      key: 'duplicate',
      label: '复制',
      icon: <FileCopyIcon />,
      onSelect: (frameInfo) => handleContextMenuAction('duplicate', frameInfo),
    },
    { key: 'divider-1', type: 'divider' },
    {
      key: 'delete',
      label: '删除',
      icon: <DeleteIcon />,
      danger: true,
      onSelect: (frameInfo) => handleContextMenuAction('delete', frameInfo),
    },
  ], [handleContextMenuAction]);

  // 统计有配图提示词的 Frame 数量
  const framesWithImagePrompt = useMemo(() => {
    return frames.filter((f) => f.pptMeta?.imagePrompt).length;
  }, [frames]);

  // 统计 PPT Frame 数量（有 pptMeta 的 Frame）
  const pptFrames = useMemo(() => {
    return frames.filter((f) => f.pptMeta);
  }, [frames]);

  // 检查当前是否已有背景图
  const currentBackgroundUrl = useMemo(() => {
    const firstPptFrame = pptFrames.find((f) => f.frame.backgroundUrl);
    return firstPptFrame?.frame.backgroundUrl;
  }, [pptFrames]);

  // 处理背景图文件上传
  const handleBackgroundUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!board || pptFrames.length === 0) return;

      const file = e.target.files?.[0];
      if (!file) return;

      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        MessagePlugin.error('请选择图片文件');
        return;
      }

      // 转为 data URL 并设置给所有 PPT Frame
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;

        for (const frameInfo of pptFrames) {
          Transforms.setNode(board, { backgroundUrl: dataUrl } as any, frameInfo.path);
        }

        MessagePlugin.success(`已为 ${pptFrames.length} 个 PPT 页面设置背景图`);
      };
      reader.readAsDataURL(file);

      // 重置 input 以便重复选择同一文件
      e.target.value = '';
    },
    [board, pptFrames]
  );

  // 清除所有 PPT Frame 的背景图
  const handleClearBackground = useCallback(() => {
    if (!board || pptFrames.length === 0) return;

    for (const frameInfo of pptFrames) {
      Transforms.setNode(board, { backgroundUrl: undefined } as any, frameInfo.path);
    }

    MessagePlugin.success('已清除所有 PPT 页面的背景图');
  }, [board, pptFrames]);

  // 为单个 Frame 生成配图
  const handleGenerateImage = useCallback(
    async (frameInfo: FrameInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!board || !frameInfo.pptMeta?.imagePrompt) return;

      const frameId = frameInfo.frame.id;
      setGeneratingImageIds((prev) => new Set(prev).add(frameId));

      insertPPTImagePlaceholder(board, frameInfo.frame, frameInfo.pptMeta.imagePrompt);
      setPPTImagePlaceholderStatus(board, frameId, 'loading');
      setFramePPTImageStatus(board, frameId, 'loading');

      try {
        // 调用图片生成
        const result = await generateImage({
          prompt: frameInfo.pptMeta.imagePrompt,
          size: '16x9', // PPT 页面使用 16:9 比例
        });

        if (result.success && (result.data as any)?.url) {
          // 计算图片区域并插入
          const frameRect = RectangleClient.getRectangleByPoints(frameInfo.frame.points);
          const imgRegion = getImageRegion({
            x: frameRect.x,
            y: frameRect.y,
            width: frameRect.width,
            height: frameRect.height,
          });
          removePPTImagePlaceholder(board, frameId);
          await insertMediaIntoFrame(
            board,
            (result.data as any).url,
            'image',
            frameId,
            { width: frameInfo.width, height: frameInfo.height },
            { width: 800, height: 450 }, // 16:9 默认尺寸
            imgRegion
          );
          setFramePPTImageStatus(board, frameId, 'generated');
          MessagePlugin.success(`已为「${frameInfo.frame.name}」生成配图`);
        } else {
          setPPTImagePlaceholderStatus(board, frameId, 'placeholder');
          setFramePPTImageStatus(board, frameId, 'placeholder');
          MessagePlugin.error(result.error || '图片生成失败');
        }
      } catch (error: any) {
        console.error('[FramePanel] Generate image failed:', error);
        setPPTImagePlaceholderStatus(board, frameId, 'placeholder');
        setFramePPTImageStatus(board, frameId, 'placeholder');
        MessagePlugin.error(error.message || '图片生成失败');
      } finally {
        setGeneratingImageIds((prev) => {
          const next = new Set(prev);
          next.delete(frameId);
          return next;
        });
      }
    },
    [board]
  );

  // 为所有有配图提示词的 Frame 生成配图
  const handleGenerateAllImages = useCallback(async () => {
    if (!board || isGeneratingAll) return;

    const framesToGenerate = frames.filter((f) => f.pptMeta?.imagePrompt);
    if (framesToGenerate.length === 0) {
      MessagePlugin.info('没有需要配图的页面');
      return;
    }

    setIsGeneratingAll(true);
    let successCount = 0;
    let failCount = 0;

    try {
      // 必须串行：并行 insertMediaIntoFrame 会用 childrenCountBefore 定位新节点，竞态会导致 frameId 绑错页、导出时配图挤在同一页
      for (const frameInfo of framesToGenerate) {
        const frameId = frameInfo.frame.id;
        setGeneratingImageIds((prev) => new Set(prev).add(frameId));

        insertPPTImagePlaceholder(board, frameInfo.frame, frameInfo.pptMeta!.imagePrompt!);
        setPPTImagePlaceholderStatus(board, frameId, 'loading');
        setFramePPTImageStatus(board, frameId, 'loading');

        try {
          const result = await generateImage({
            prompt: frameInfo.pptMeta!.imagePrompt!,
            size: '16x9',
          });

          if (result.success && (result.data as any)?.url) {
            const frameRect = RectangleClient.getRectangleByPoints(frameInfo.frame.points);
            const imgRegion = getImageRegion({
              x: frameRect.x,
              y: frameRect.y,
              width: frameRect.width,
              height: frameRect.height,
            });
            removePPTImagePlaceholder(board, frameId);
            await insertMediaIntoFrame(
              board,
              (result.data as any).url,
              'image',
              frameId,
              { width: frameInfo.width, height: frameInfo.height },
              { width: 800, height: 450 },
              imgRegion
            );
            setFramePPTImageStatus(board, frameId, 'generated');
            successCount++;
          } else {
            setPPTImagePlaceholderStatus(board, frameId, 'placeholder');
            setFramePPTImageStatus(board, frameId, 'placeholder');
            failCount++;
          }
        } catch {
          setPPTImagePlaceholderStatus(board, frameId, 'placeholder');
          setFramePPTImageStatus(board, frameId, 'placeholder');
          failCount++;
        } finally {
          setGeneratingImageIds((prev) => {
            const next = new Set(prev);
            next.delete(frameId);
            return next;
          });
        }
      }

      if (successCount > 0 && failCount === 0) {
        MessagePlugin.success(`已为 ${successCount} 个页面生成配图`);
      } else if (successCount > 0 && failCount > 0) {
        MessagePlugin.warning(`成功 ${successCount} 个，失败 ${failCount} 个`);
      } else {
        MessagePlugin.error('所有配图生成失败');
      }
    } finally {
      setIsGeneratingAll(false);
    }
  }, [board, frames, isGeneratingAll]);

  // 导出所有 Frame 为一个 PPT 文件
  const handleExportAllPPT = useCallback(async () => {
    if (!board) return;
    if (frames.length === 0) {
      MessagePlugin.info('当前没有可导出的 Frame');
      return;
    }

    if (isExportingAllPPT) return;
    setIsExportingAllPPT(true);
    try {
      await exportAllPPTFrames(board, { fileName: 'aitu-ppt' });
      MessagePlugin.success(`已导出 ${frames.length} 页 PPT`);
    } catch (error) {
      console.error('[FramePanel] Export all PPT failed:', error);
      MessagePlugin.error('PPT 导出失败');
    } finally {
      setIsExportingAllPPT(false);
    }
  }, [board, isExportingAllPPT, frames]);

  // 导出单个 Frame 为 PPT 文件
  const handleExportSinglePPT = useCallback(
    async (frameInfo: FrameInfo, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!board) return;

      if (exportingFrameId) return;
      setExportingFrameId(frameInfo.frame.id);
      try {
        await exportFramesToPPT(board, [frameInfo.frame], {
          fileName: frameInfo.frame.name || 'slide',
        });
        MessagePlugin.success(`已导出「${frameInfo.frame.name}」为 PPT`);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[FramePanel] Export single PPT failed:', error);
        MessagePlugin.error('PPT 导出失败');
      } finally {
        setExportingFrameId(null);
      }
    },
    [board, exportingFrameId]
  );

  if (!board) {
    return (
      <div className="frame-panel__empty">
        <p>画布未初始化</p>
      </div>
    );
  }

  return (
    <div className="frame-panel">
      {/* 搜索 */}
      <div className="frame-panel__filter">
        <Input
          placeholder="搜索 Frame..."
          value={searchQuery}
          onChange={setSearchQuery}
          prefixIcon={<SearchIcon />}
          size="small"
        />
      </div>

      {/* 操作栏：icon + hover 文字 */}
      <div className="frame-panel__actions">
        <Tooltip content="添加 Frame" theme="light">
          <Button
            variant="outline"
            size="small"
            shape="square"
            icon={<AddIcon />}
            onClick={() => setAddDialogVisible(true)}
          />
        </Tooltip>
        <Tooltip content={frames.length === 0 ? '没有 Frame 可播放' : '幻灯片播放'} theme="light">
          <Button
            variant="outline"
            size="small"
            shape="square"
            icon={<PlayCircleIcon />}
            disabled={frames.length === 0}
            onClick={() => setSlideshowVisible(true)}
          />
        </Tooltip>
        {framesWithImagePrompt > 0 && (
          <Tooltip
            content={isGeneratingAll ? '正在生成...' : `全部配图 (${framesWithImagePrompt})`}
            theme="light"
          >
            <Button
              variant="outline"
              size="small"
              shape="square"
              icon={isGeneratingAll ? <Loading size="small" /> : <ImageIcon />}
              disabled={isGeneratingAll}
              onClick={handleGenerateAllImages}
            />
          </Tooltip>
        )}
        {frames.length > 0 && (
          <Tooltip
            content={isExportingAllPPT ? '正在导出 PPT...' : '导出所有 PPT 页面'}
            theme="light"
          >
            <Button
              variant="outline"
              size="small"
              shape="square"
              icon={
                isExportingAllPPT ? <Loading size="small" /> : <DownloadIcon size={16} />
              }
              disabled={isExportingAllPPT}
              onClick={handleExportAllPPT}
            />
          </Tooltip>
        )}
        {pptFrames.length > 0 && (
          <>
            <Tooltip
              content={currentBackgroundUrl ? '更换背景图' : '设置背景图'}
              theme="light"
            >
              <Button
                variant="outline"
                size="small"
                shape="square"
                icon={<LayersIcon />}
                onClick={() => bgFileInputRef.current?.click()}
              />
            </Tooltip>
            {currentBackgroundUrl && (
              <Tooltip content="清除背景图" theme="light">
                <Button
                  variant="outline"
                  size="small"
                  shape="square"
                  theme="danger"
                  icon={<DeleteIcon />}
                  onClick={handleClearBackground}
                />
              </Tooltip>
            )}
            <input
              ref={bgFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleBackgroundUpload}
            />
          </>
        )}
      </div>

      {/* Frame 列表 */}
      {filteredFrames.length === 0 ? (
        <div className="frame-panel__empty">
          <ViewListIcon style={{ fontSize: 32, color: 'var(--td-text-color-placeholder)' }} />
          <p>{frames.length === 0 ? '当前画布没有 Frame' : '未找到匹配的 Frame'}</p>
          {frames.length === 0 && (
            <p className="frame-panel__empty-hint">
              使用工具栏的 Frame 工具 (F) 创建
            </p>
          )}
        </div>
      ) : (
        <div className="frame-panel__list">
          {filteredFrames.map((info) => {
            const dragProps = getFrameDragProps(info);
            return (
              <div
                key={info.listKey}
                className={classNames('frame-panel__item', {
                  'frame-panel__item--active': selectedFrameKey === info.listKey,
                  'frame-panel__item--dragging': dragProps['data-dragging'],
                  'frame-panel__item--drag-over': dragProps['data-drag-over'],
                  'frame-panel__item--drag-before': dragProps['data-drag-position'] === 'before',
                  'frame-panel__item--drag-after': dragProps['data-drag-position'] === 'after',
                })}
                onClick={() => handleFrameClick(info)}
                onContextMenu={(e) => handleContextMenu(e, info)}
                {...dragProps}
              >
                <div className="frame-panel__item-icon">
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
                </div>

                <div className="frame-panel__item-content">
                  {editingKey === info.listKey ? (
                    <Input
                      value={editingName}
                      onChange={setEditingName}
                      size="small"
                      autofocus
                      onBlur={() => handleFinishRename(info)}
                      onEnter={() => handleFinishRename(info)}
                      onClick={(context: { e: React.MouseEvent }) => context.e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="frame-panel__item-name">
                        {info.frame.name}
                      </span>
                      <span className="frame-panel__item-meta">
                        {info.width} × {info.height}
                        {info.childCount > 0 && ` · ${info.childCount} 个元素`}
                      </span>
                    </>
                  )}
                </div>

                <div className="frame-panel__item-actions">
                  <Tooltip
                    content={exportingFrameId === info.frame.id ? '正在导出 PPT...' : '导出单页 PPT'}
                    theme="light"
                  >
                    <Button
                      variant="text"
                      size="small"
                      shape="square"
                      icon={
                        exportingFrameId === info.frame.id ? (
                          <Loading size="small" />
                        ) : (
                          <DownloadIcon size={16} />
                        )
                      }
                      onClick={(e) => handleExportSinglePPT(info, e as unknown as React.MouseEvent)}
                      disabled={exportingFrameId === info.frame.id}
                    />
                  </Tooltip>
                  {info.pptMeta?.imagePrompt && (
                    <Tooltip content={generatingImageIds.has(info.frame.id) ? '生成中...' : '生成配图'} theme="light">
                      <Button
                        variant="text"
                        size="small"
                        shape="square"
                        icon={generatingImageIds.has(info.frame.id) ? <Loading size="small" /> : <ImageIcon />}
                        onClick={(e) => handleGenerateImage(info, e as unknown as React.MouseEvent)}
                        disabled={generatingImageIds.has(info.frame.id)}
                      />
                    </Tooltip>
                  )}
                  <Button
                    variant="text"
                    size="small"
                    shape="square"
                    icon={<EditIcon />}
                    onClick={(e) => handleStartRename(info, e as unknown as React.MouseEvent)}
                    title="重命名"
                  />
                  <Button
                    variant="text"
                    size="small"
                    shape="square"
                    theme="danger"
                    icon={<DeleteIcon />}
                    onClick={(e) => void handleDelete(info, e as unknown as React.MouseEvent)}
                    title="删除"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ContextMenu
        state={contextMenu}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />

      {/* 添加 Frame 弹窗 */}
      <AddFrameDialog
        visible={addDialogVisible}
        board={board}
        onClose={() => setAddDialogVisible(false)}
      />

      {/* 幻灯片播放 */}
      <FrameSlideshow
        visible={slideshowVisible}
        board={board}
        onClose={() => setSlideshowVisible(false)}
      />
      {confirmDialog}
    </div>
  );
};
