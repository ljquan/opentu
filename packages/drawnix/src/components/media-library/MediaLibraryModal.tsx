/**
 * Media Library Modal
 * 素材库弹窗容器组件 - 使用 WinBox 窗口
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { MessagePlugin, Drawer } from 'tdesign-react';
import { MediaLibraryIcon } from '../icons';
import { useAssets } from '../../contexts/AssetContext';
import { MediaLibraryGrid } from './MediaLibraryGrid';
import { MediaLibraryInspector } from './MediaLibraryInspector';
import { WinBoxWindow } from '../winbox/WinBoxWindow';
import type {
  MediaLibraryModalProps,
  Asset,
} from '../../types/asset.types';
import { AssetType, AssetSource, SelectionMode } from '../../types/asset.types';
import { downloadFile, normalizeImageDataUrl } from '@aitu/utils';
import { useDrawnix } from '../../hooks/use-drawnix';
import { removeElementsByAssetId, removeElementsByAssetUrl, isCacheUrl } from '../../utils/asset-cleanup';
import { isZipFile, extractMediaFromZip } from '../../utils/zip-utils';
import './MediaLibraryModal.scss';

export function MediaLibraryModal({
  isOpen,
  onClose,
  mode = SelectionMode.BROWSE,
  filterType,
  onSelect,
  selectButtonText,
}: MediaLibraryModalProps) {
  const {
    assets,
    loading,
    loadAssets,
    addAsset,
    filters,
    setFilters,
    selectedAssetId,
    setSelectedAssetId,
    storageStatus,
    checkStorageQuota,
    renameAsset,
    removeAsset,
  } = useAssets();

  const { board } = useDrawnix();

  const [localSelectedAssetId, setLocalSelectedAssetId] = useState<string | null>(
    null,
  );
  const [showMobileInspector, setShowMobileInspector] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载素材和检查配额
  useEffect(() => {
    if (isOpen) {
      loadAssets();
      checkStorageQuota();
    }
  }, [isOpen, loadAssets, checkStorageQuota]);

  // 应用filterType（如果提供）
  useEffect(() => {
    if (isOpen && filterType) {
      setFilters({ activeType: filterType });
    }
  }, [isOpen, filterType, setFilters]);

  // 同步选中状态
  useEffect(() => {
    if (isOpen) {
      setLocalSelectedAssetId(selectedAssetId);
    }
  }, [isOpen, selectedAssetId]);

  // 检测移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 处理资产选择 - 移动端单击只选中，不弹出详情
  const handleSelectAsset = useCallback(
    (id: string) => {
      setLocalSelectedAssetId(id);
      setSelectedAssetId(id);
      // 移动端不再自动弹出详情抽屉，用户可以通过双击预览或点击详情按钮
    },
    [setSelectedAssetId],
  );

  // 关闭移动端检查器
  const handleCloseMobileInspector = useCallback(() => {
    setShowMobileInspector(false);
  }, []);

  // 处理双击插入
  const handleDoubleClick = useCallback(
    (asset: Asset) => {
      if (onSelect) {
        onSelect(asset);
        onClose();
      }
    },
    [onSelect, onClose],
  );

  // 处理"使用"按钮点击
  const handleUseAsset = useCallback(
    (asset: Asset) => {
      if (onSelect) {
        onSelect(asset);
        onClose();
      }
    },
    [onSelect, onClose],
  );

  // 处理文件上传
  const handleFileUpload = useCallback(
    async (files: FileList) => {
      if (!files || files.length === 0) {
        return;
      }

      // 分离 ZIP 文件和普通媒体文件
      const zipFiles: File[] = [];
      const mediaFiles: File[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (isZipFile(file)) {
          zipFiles.push(file);
        } else {
          mediaFiles.push(file);
        }
      }

      // 处理普通媒体文件
      const validFiles: File[] = [];
      for (const file of mediaFiles) {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');

        if (!isImage && !isVideo) {
          console.warn(`[MediaLibrary] Invalid file type: ${file.type}`);
          MessagePlugin.warning(`文件 "${file.name}" 不是有效的图片或视频格式`);
          continue;
        }

        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
          console.warn(`[MediaLibrary] File too large: ${file.size} bytes`);
          MessagePlugin.warning(`文件 "${file.name}" 超过 100MB 限制`);
          continue;
        }

        validFiles.push(file);
      }

      // 处理 ZIP 文件
      let zipExtractedCount = 0;
      for (const zipFile of zipFiles) {
        try {
          MessagePlugin.info(`正在解压 "${zipFile.name}"...`);
          const result = await extractMediaFromZip(zipFile);

          // 显示解压错误
          if (result.errors.length > 0) {
            result.errors.forEach((err) => MessagePlugin.warning(err));
          }

          // 上传解压出的文件
          for (const extracted of result.files) {
            const type = extracted.type === 'image' ? AssetType.IMAGE : AssetType.VIDEO;
            await addAsset(extracted.blob, type, AssetSource.LOCAL, extracted.name);
            zipExtractedCount++;
          }

          if (result.skippedCount > 0) {
            MessagePlugin.info(`"${zipFile.name}" 中跳过了 ${result.skippedCount} 个不支持的文件`);
          }
        } catch (error) {
          console.error('[MediaLibrary] ZIP extraction error:', error);
          MessagePlugin.error(`解压 "${zipFile.name}" 失败`);
        }
      }

      // 上传普通媒体文件
      try {
        for (const file of validFiles) {
          const isImage = file.type.startsWith('image/');
          const type = isImage ? AssetType.IMAGE : AssetType.VIDEO;
          await addAsset(file, type, AssetSource.LOCAL);
        }

        const totalCount = validFiles.length + zipExtractedCount;
        if (totalCount > 0) {
          MessagePlugin.success(`成功上传 ${totalCount} 个文件`);
        }

        await loadAssets();
      } catch (error) {
        console.error('[MediaLibrary] File upload error:', error);
      }
    },
    [addAsset, loadAssets],
  );

  // 打开文件选择器
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // 文件输入变化
  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files) {
        handleFileUpload(files);
      }
      // 清空input值，允许重复上传同一文件
      event.target.value = '';
    },
    [handleFileUpload],
  );

  // 获取当前选中的资产
  const selectedAsset =
    assets.find((a) => a.id === localSelectedAssetId) || null;

  // 显示选择按钮的条件：SELECT模式且有onSelect回调
  const showSelectButton = mode === 'SELECT' && !!onSelect;

  // 处理删除素材（同时删除画布上使用该素材的元素）
  const handleRemoveAsset = useCallback(async (assetId: string) => {
    // 查找素材信息
    const asset = assets.find(a => a.id === assetId);

    // 删除画布上使用该素材的元素
    if (board && asset) {
      // 缓存类型素材使用 URL 匹配，其他类型使用 ID 匹配
      const isCacheAsset = isCacheUrl(asset.url);

      if (isCacheAsset) {
        removeElementsByAssetUrl(board, asset.url);
      } else {
        removeElementsByAssetId(board, assetId);
      }
    }

    // 然后删除素材本身
    await removeAsset(assetId);
  }, [board, removeAsset, assets]);

  return (
    <>
      <WinBoxWindow
        visible={isOpen}
        title="素材库"
        onClose={onClose}
        width="85%"
        height="85%"
        minWidth={800}
        minHeight={500}
        x="center"
        y="center"
        maximizable={true}
        minimizable={false}
        resizable={true}
        movable={true}
        modal={false}
        className="winbox-media-library"
        data-testid="media-library-modal"
        headerContent={
          <div className="media-library-header-content">
            <MediaLibraryIcon size={18} />
          </div>
        }
      >
        {/* 隐藏的文件输入 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.zip,application/zip,application/x-zip-compressed"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />

        <div className="media-library-layout">
          {/* 主网格区域 */}
          <div className="media-library-layout__main">
            <MediaLibraryGrid
              filterType={filterType}
              selectedAssetId={localSelectedAssetId}
              onSelectAsset={handleSelectAsset}
              onDoubleClick={handleDoubleClick}
              onFileUpload={handleFileUpload}
              onUploadClick={handleUploadClick}
              storageStatus={storageStatus}
            />
          </div>

          {/* 右侧详情面板 - 仅桌面端显示 */}
          {!isMobile && (
            <div className="media-library-layout__inspector">
              <MediaLibraryInspector
                asset={selectedAsset}
                onRename={renameAsset}
                onDelete={handleRemoveAsset}
                onDownload={(asset) => {
                  const downloadUrl =
                    asset.type === AssetType.IMAGE
                      ? normalizeImageDataUrl(asset.url)
                      : asset.url;
                  downloadFile(downloadUrl, asset.name);
                }}
                onSelect={showSelectButton ? handleUseAsset : undefined}
                showSelectButton={showSelectButton}
                selectButtonText={selectButtonText}
              />
            </div>
          )}
        </div>
      </WinBoxWindow>

      {/* 移动端详情抽屉 */}
      {isMobile && (
        <Drawer
          visible={showMobileInspector}
          onClose={handleCloseMobileInspector}
          header="素材详情"
          placement="bottom"
          size="70vh"
          destroyOnClose
          className="media-library-mobile-drawer"
        >
          <MediaLibraryInspector
            asset={selectedAsset}
            onRename={renameAsset}
            onDelete={handleRemoveAsset}
            onDownload={(asset) => {
              const downloadUrl =
                asset.type === AssetType.IMAGE
                  ? normalizeImageDataUrl(asset.url)
                  : asset.url;
              downloadFile(downloadUrl, asset.name);
            }}
            onSelect={showSelectButton ? handleUseAsset : undefined}
            showSelectButton={showSelectButton}
            selectButtonText={selectButtonText}
          />
        </Drawer>
      )}
    </>
  );
}
