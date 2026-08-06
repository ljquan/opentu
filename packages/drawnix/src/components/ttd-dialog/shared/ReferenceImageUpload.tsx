/**
 * ReferenceImageUpload Component
 *
 * A unified reference image upload component for AI image/video generation dialogs.
 * Supports:
 * - Local file upload
 * - Media library selection
 * - Clipboard paste (Ctrl+V / Cmd+V)
 * - Drag and drop
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Button, MessagePlugin } from 'tdesign-react';
import { X } from 'lucide-react';
import {
  ImageUploadIcon,
  MediaLibraryIcon,
} from '../../icons';
import { MediaLibraryModal } from '../../media-library/MediaLibraryModal';
import type { Asset } from '../../../types/asset.types';
import { SelectionMode, AssetType, AssetSource } from '../../../types/asset.types';
import { useAssets } from '../../../contexts/AssetContext';
import { unifiedCacheService } from '../../../services/unified-cache-service';
import './ReferenceImageUpload.scss';

const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;
const COMPRESSION_THRESHOLD_BYTES = 10 * 1024 * 1024;

export interface ReferenceImage {
  url: string;
  name: string;
  file?: File;
  maskImage?: string;
  slot?: number;
}

interface ReferenceImageUploadProps {
  /** Current images */
  images: ReferenceImage[];
  /** Callback when images change */
  onImagesChange: (images: ReferenceImage[]) => void;
  /** Language for i18n */
  language?: 'zh' | 'en';
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Whether to allow multiple images */
  multiple?: boolean;
  /** Maximum number of images (only applies when multiple is true) */
  maxCount?: number;
  /** Label for the upload area */
  label?: string;
  /** Optional slot labels for multi-slot mode (e.g., ['首帧', '尾帧']) */
  slotLabels?: string[];
  /** Error callback */
  onError?: (error: string | null) => void;
  /** Additional focus scope allowed to paste images into this uploader */
  pasteScopeRef?: React.RefObject<HTMLElement>;
}

export const ReferenceImageUpload: React.FC<ReferenceImageUploadProps> = ({
  images,
  onImagesChange,
  language = 'zh',
  disabled = false,
  multiple = true,
  maxCount = 10,
  label,
  slotLabels,
  onError,
  pasteScopeRef,
}) => {
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [currentSlot, setCurrentSlot] = useState<number>(0);
  const [hoveredImage, setHoveredImage] = useState<{ url: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addAsset } = useAssets();

  const i18n = {
    zh: {
      local: '本地',
      library: '素材库',
      dragHint: '拖拽图片到此处',
      pasteHint: '或 Ctrl+V 粘贴',
      invalidFile: '请上传图片文件',
      fileTooLarge: '图片大小不能超过 25MB',
      someFilesInvalid: '部分文件格式不支持或超过25MB限制',
      loadFailed: '加载图片失败',
      maxCountReached: '最多上传 {count} 张图片',
    },
    en: {
      local: 'Local',
      library: 'Library',
      dragHint: 'Drop images here',
      pasteHint: 'or Ctrl+V to paste',
      invalidFile: 'Please upload image files',
      fileTooLarge: 'Image size cannot exceed 25MB',
      someFilesInvalid: 'Some files are not supported or exceed 25MB limit',
      loadFailed: 'Failed to load image',
      maxCountReached: 'Maximum {count} images allowed',
    },
  };

  const t = i18n[language];

  const normalizeSlotImages = useCallback(
    (nextImages: ReferenceImage[]) => {
      if (!slotLabels) return nextImages;

      return nextImages
        .filter((image) => image?.url || image?.file)
        .map((image, index) => ({
          ...image,
          slot: image.slot ?? index,
        }))
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    },
    [slotLabels]
  );

  const slotImageEntries = slotLabels
    ? slotLabels.map((_, index) => ({
        slot: index,
        image: normalizeSlotImages(images).find((item) => (item.slot ?? -1) === index),
      }))
    : [];

  const assetToReferenceImage = useCallback(async (asset: Asset): Promise<ReferenceImage> => {
    if (asset.type !== AssetType.IMAGE) {
      throw new Error(`Asset is not an image: ${asset.name}`);
    }

    if (asset.size && asset.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Asset exceeds 25MB limit: ${asset.name}`);
    }

    let blob = await unifiedCacheService.getCachedBlob(asset.url);

    if (!blob || blob.size === 0) {
      const canUseRemoteUrl =
        /^https?:\/\//i.test(asset.url) &&
        asset.source === AssetSource.AI_GENERATED &&
        asset.type === AssetType.IMAGE &&
        (!asset.mimeType || asset.mimeType.startsWith('image/'));

      if (canUseRemoteUrl) {
        return {
          url: asset.url,
          name: asset.name,
        };
      }

      throw new Error(`Asset content is unavailable: ${asset.name}`);
    }

    const blobMimeType = blob.type.toLowerCase();
    const assetMimeType = asset.mimeType?.toLowerCase();
    const mimeType =
      !blobMimeType || blobMimeType === 'application/octet-stream'
        ? assetMimeType || blobMimeType
        : blobMimeType;
    if (mimeType && !mimeType.startsWith('image/')) {
      throw new Error(`Asset is not an image: ${asset.name}`);
    }
    if (mimeType && blob.type !== mimeType) {
      blob = blob.slice(0, blob.size, mimeType);
    }

    if (blob.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Asset exceeds 25MB limit: ${asset.name}`);
    }

    if (blob.size > COMPRESSION_THRESHOLD_BYTES) {
      const { compressImageBlob, getCompressionStrategy } = await import('@aitu/utils');
      const strategy = getCompressionStrategy(blob.size / (1024 * 1024));
      blob = await compressImageBlob(blob, strategy.targetSizeMB);
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    return {
      url: dataUrl,
      name: asset.name,
    };
  }, []);

  const applySlotImages = useCallback(
    (newImages: ReferenceImage[], startSlot = currentSlot) => {
      if (!slotLabels) return;

      const targetSlots = slotLabels
        .map((_, index) => index)
        .filter((slot) => slot >= startSlot)
        .slice(0, newImages.length);

      if (targetSlots.length === 0) return;

      const updatedImages = normalizeSlotImages(images).filter(
        (image) => !targetSlots.includes(image.slot ?? -1)
      );
      targetSlots.forEach((slot, index) => {
        updatedImages.push({
          ...newImages[index],
          slot,
        });
      });

      onImagesChange(normalizeSlotImages(updatedImages));

      if (newImages.length > targetSlots.length) {
        MessagePlugin.warning(
          t.maxCountReached.replace('{count}', String(targetSlots.length))
        );
      }
    },
    [currentSlot, images, normalizeSlotImages, onImagesChange, slotLabels, t]
  );

  // Validate file
  const validateFile = useCallback((file: File): boolean => {
    if (!file.type.startsWith('image/')) {
      MessagePlugin.error(t.invalidFile);
      return false;
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      MessagePlugin.error(t.fileTooLarge);
      return false;
    }
    return true;
  }, [t]);

  // Convert file to base64 and create ReferenceImage
  const fileToReferenceImage = useCallback((file: File | Blob, originalName: string): Promise<ReferenceImage> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          url: reader.result as string,
          name: originalName,
          file: file instanceof File ? file : (file as any),
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle file upload
  const handleFiles = useCallback(async (files: FileList | File[], targetSlot?: number) => {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(validateFile);

    if (validFiles.length === 0) return;

    // Check max count
    if (slotLabels) {
      const startSlot = targetSlot ?? currentSlot;
      const availableSlots = slotLabels.length - startSlot;
      if (availableSlots <= 0) {
        MessagePlugin.warning(t.maxCountReached.replace('{count}', '0'));
        return;
      }
      if (validFiles.length > availableSlots) {
        MessagePlugin.warning(t.maxCountReached.replace('{count}', String(availableSlots)));
        validFiles.splice(availableSlots);
      }
    } else if (multiple && images.length + validFiles.length > maxCount) {
      MessagePlugin.warning(t.maxCountReached.replace('{count}', String(maxCount)));
      validFiles.splice(maxCount - images.length);
    }

    // Process files with compression if needed
    const processedFiles: Array<{ blob: Blob; name: string }> = [];

    for (const file of validFiles) {
      try {
        let fileToAdd: Blob = file;

        // Compress if file is 10-25MB
        if (file.size > COMPRESSION_THRESHOLD_BYTES) {
          const { compressImageBlob, getCompressionStrategy } = await import('@aitu/utils');
          const strategy = getCompressionStrategy(file.size / (1024 * 1024));
          const msgId = MessagePlugin.loading({
            content: language === 'zh'
              ? `正在压缩图片 (${(file.size / 1024 / 1024).toFixed(1)}MB)...`
              : `Compressing image (${(file.size / 1024 / 1024).toFixed(1)}MB)...`,
            duration: 0,
            placement: 'top',
          });

          try {
            fileToAdd = await compressImageBlob(file, strategy.targetSizeMB);
            MessagePlugin.close(msgId);
            MessagePlugin.success({
              content: language === 'zh'
                ? `压缩完成: ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(fileToAdd.size / 1024 / 1024).toFixed(1)}MB`
                : `Compressed: ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(fileToAdd.size / 1024 / 1024).toFixed(1)}MB`,
              duration: 2,
            });
          } catch (compressionErr) {
            MessagePlugin.close(msgId);
            console.error('[ReferenceImageUpload] Compression failed:', compressionErr);
            onError?.(language === 'zh' ? '图片压缩失败' : 'Image compression failed');
            continue;
          }
        }

        processedFiles.push({ blob: fileToAdd, name: file.name });
      } catch (err) {
        console.error('[ReferenceImageUpload] Error processing file:', err);
        onError?.(t.loadFailed);
        continue;
      }
    }

    if (processedFiles.length === 0) return;

    // Add to asset library (async, don't block UI)
    processedFiles.forEach(({ blob, name }) => {
      addAsset(blob as File, AssetType.IMAGE, AssetSource.LOCAL, name).catch((err) => {
        console.warn('[ReferenceImageUpload] Failed to add asset to library:', err);
      });
    });

    try {
      const newImages = await Promise.all(
        processedFiles.map(({ blob, name }) => fileToReferenceImage(blob, name))
      );

      if (slotLabels && targetSlot !== undefined) {
        applySlotImages(newImages, targetSlot);
      } else if (multiple) {
        onImagesChange([...images, ...newImages]);
      } else {
        onImagesChange(newImages.slice(0, 1));
      }

      onError?.(null);
    } catch (error) {
      console.error('[ReferenceImageUpload] Failed to process files:', error);
      onError?.(t.loadFailed);
    }
  }, [applySlotImages, addAsset, currentSlot, fileToReferenceImage, images, language, maxCount, multiple, onError, onImagesChange, slotLabels, t, validateFile]);

  // Handle file input change
  const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      handleFiles(files, slotLabels ? currentSlot : undefined);
    }
    event.target.value = '';
  }, [handleFiles, slotLabels, currentSlot]);

  // Handle media library selection (single)
  const handleMediaLibrarySelect = useCallback(async (asset: Asset) => {
    try {
      const newImage = await assetToReferenceImage(asset);

      if (slotLabels) {
        applySlotImages([newImage]);
      } else if (multiple) {
        if (images.length >= maxCount) {
          MessagePlugin.warning(t.maxCountReached.replace('{count}', String(maxCount)));
          return;
        }
        onImagesChange([...images, newImage]);
      } else {
        onImagesChange([newImage]);
      }

      setShowMediaLibrary(false);
      onError?.(null);
    } catch (error) {
      console.error('[ReferenceImageUpload] Failed to convert asset to base64:', error);
      onError?.(t.loadFailed);
      setShowMediaLibrary(false);
    }
  }, [applySlotImages, assetToReferenceImage, images, multiple, maxCount, slotLabels, onImagesChange, onError, t]);

  // Handle media library batch selection
  const handleMediaLibrarySelectMultiple = useCallback(async (assets: Asset[]) => {
    if (assets.length === 0) return;

    let selectedAssets = assets;

    if (slotLabels) {
      const availableSlots = slotLabels.length - currentSlot;
      if (availableSlots <= 0) {
        setShowMediaLibrary(false);
        return;
      }
      selectedAssets = assets.slice(0, availableSlots);
      if (assets.length > availableSlots) {
        MessagePlugin.warning(t.maxCountReached.replace('{count}', String(availableSlots)));
      }
    } else if (multiple && images.length + assets.length > maxCount) {
      MessagePlugin.warning(t.maxCountReached.replace('{count}', String(maxCount)));
      const available = maxCount - images.length;
      if (available <= 0) {
        setShowMediaLibrary(false);
        return;
      }
      selectedAssets = assets.slice(0, available);
    } else if (!multiple) {
      selectedAssets = assets.slice(0, 1);
    }

    try {
      const newImages: ReferenceImage[] = [];

      for (const asset of selectedAssets) {
        try {
          newImages.push(await assetToReferenceImage(asset));
        } catch (err) {
          console.error('[ReferenceImageUpload] Failed to convert asset:', asset.name, err);
        }
      }

      if (newImages.length > 0) {
        if (slotLabels) {
          applySlotImages(newImages);
        } else if (multiple) {
          onImagesChange([...images, ...newImages]);
        } else {
          onImagesChange(newImages.slice(0, 1));
        }
      }

      setShowMediaLibrary(false);
      onError?.(
        newImages.length === selectedAssets.length ? null : t.loadFailed
      );
    } catch (error) {
      console.error('[ReferenceImageUpload] Batch selection failed:', error);
      onError?.(t.loadFailed);
      setShowMediaLibrary(false);
    }
  }, [applySlotImages, assetToReferenceImage, currentSlot, images, multiple, maxCount, slotLabels, onImagesChange, onError, t]);

  // Handle drag events
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the container
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const { clientX, clientY } = e;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        setIsDragging(false);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetSlot?: number) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files, targetSlot);
    }
  }, [currentSlot, disabled, handleFiles, slotLabels]);

  // Handle paste events
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (disabled) return;

      // Check if the container or its children are focused
      const activeElement = document.activeElement;
      const container = containerRef.current;
      if (!container) return;

      // Allow callers to include a sibling input without handling unrelated fields.
      const isContainerFocused =
        container.contains(activeElement) ||
        pasteScopeRef?.current?.contains(activeElement) ||
        activeElement === document.body ||
        activeElement?.tagName === 'BODY';

      if (!isContainerFocused) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFiles(imageFiles, slotLabels ? currentSlot : undefined);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [disabled, handleFiles, pasteScopeRef]);

  // Remove image
  const handleRemove = useCallback((index: number, slot?: number) => {
    const newImages = slotLabels
      ? images.filter((image, i) => (image.slot ?? i) !== (slot ?? index))
      : images.filter((_, i) => i !== index);
    setHoveredImage(null);
    onImagesChange(newImages);
  }, [images, onImagesChange, slotLabels]);

  // Open file dialog
  const openFileDialog = useCallback((slot?: number) => {
    if (slot !== undefined) {
      setCurrentSlot(slot);
    }
    fileInputRef.current?.click();
  }, []);

  // Open media library
  const openMediaLibrary = useCallback((slot?: number) => {
    if (slot !== undefined) {
      setCurrentSlot(slot);
    }
    setShowMediaLibrary(true);
  }, []);

  // Handle image hover for preview
  const handleImageMouseEnter = useCallback((url: string, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const topY = rect.top - 10;
    setHoveredImage({ url, x: centerX, y: topY });
  }, []);

  const handleImageMouseLeave = useCallback(() => {
    setHoveredImage(null);
  }, []);

  // Render upload placeholder
  const renderUploadPlaceholder = (slot?: number) => (
    <div
      className={`reference-image-upload__placeholder ${isDragging ? 'reference-image-upload__placeholder--dragging' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(e) => handleDrop(e, slot)}
    >
      <div className="reference-image-upload__buttons">
        <Button
          variant="outline"
          icon={<ImageUploadIcon size={16} />}
          onClick={() => openFileDialog(slot)}
          disabled={disabled}
          data-track="reference_image_upload_local"
          className="reference-image-upload__btn"
        >
          {t.local}
        </Button>
        <Button
          variant="outline"
          icon={<MediaLibraryIcon size={16} />}
          onClick={() => openMediaLibrary(slot)}
          disabled={disabled}
          data-track="reference_image_upload_library"
          className="reference-image-upload__btn"
        >
          {t.library}
        </Button>
      </div>
    </div>
  );

  // Render image preview
  const renderImagePreview = (image: ReferenceImage, index: number) => (
    <div
      key={index}
      className="reference-image-upload__preview"
      onMouseEnter={(e) => handleImageMouseEnter(image.url, e)}
      onMouseLeave={handleImageMouseLeave}
    >
      <img
        src={image.url}
        alt={image.name}
        className="reference-image-upload__image"
      />
      <button
        type="button"
        className="reference-image-upload__remove"
        onClick={() => handleRemove(index, image.slot)}
        disabled={disabled}
        data-track="reference_image_upload_remove"
      >
        <X size={14} />
      </button>
      {slotLabels && slotLabels[image.slot ?? index] && (
        <div className="reference-image-upload__slot-label">
          {slotLabels[image.slot ?? index]}
        </div>
      )}
    </div>
  );

  // Render slot mode (for video generation with specific slots like 首帧/尾帧)
  const renderSlotMode = () => {
    if (!slotLabels) return null;

    return (
      <div className="reference-image-upload__slots">
        {slotImageEntries.map(({ slot, image }, index) => {
          const slotLabel = slotLabels[index];
          return (
            <div key={slot} className="reference-image-upload__slot">
              <div className="reference-image-upload__slot-title">{slotLabel}</div>
              {image ? (
                renderImagePreview(image, slot)
              ) : (
                <div
                  className={`reference-image-upload__slot-placeholder ${isDragging ? 'reference-image-upload__slot-placeholder--dragging' : ''}`}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, slot)}
                >
                  <div className="reference-image-upload__slot-buttons">
                    <Button
                      variant="outline"
                      icon={<ImageUploadIcon size={16} />}
                      onClick={() => openFileDialog(slot)}
                      disabled={disabled}
                      data-track="reference_image_upload_slot_local"
                      className="reference-image-upload__slot-btn"
                    >
                      {t.local}
                    </Button>
                    <Button
                      variant="outline"
                      icon={<MediaLibraryIcon size={16} />}
                      onClick={() => openMediaLibrary(slot)}
                      disabled={disabled}
                      data-track="reference_image_upload_slot_library"
                      className="reference-image-upload__slot-btn"
                    >
                      {t.library}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Render grid mode (for multiple images without specific slots)
  const renderGridMode = () => {
    const showAddMore = multiple && images.length < maxCount;

    return (
      <div className="reference-image-upload__grid">
        {images.map((image, index) => renderImagePreview(image, index))}
        {showAddMore && renderUploadPlaceholder()}
        {images.length === 0 && !showAddMore && renderUploadPlaceholder()}
      </div>
    );
  };

  // Render single mode
  const renderSingleMode = () => {
    if (images.length > 0) {
      return (
        <div className="reference-image-upload__single">
          {renderImagePreview(images[0], 0)}
          <div className="reference-image-upload__replace">
            {renderUploadPlaceholder()}
          </div>
        </div>
      );
    }
    return renderUploadPlaceholder();
  };

  return (
    <>
      {/* Hover preview - large image (rendered to body via portal) */}
      {hoveredImage && ReactDOM.createPortal(
        <div
          className="reference-image-upload__hover-preview"
          style={{
            left: `${hoveredImage.x}px`,
            top: `${hoveredImage.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <img src={hoveredImage.url} alt="Preview" />
        </div>,
        document.body
      )}

      <div
        ref={containerRef}
        className={`reference-image-upload ${disabled ? 'reference-image-upload--disabled' : ''}`}
        tabIndex={0}
      >
        {label && (
          <div className="reference-image-upload__label">{label}</div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={multiple && !slotLabels}
          onChange={handleFileInputChange}
          className="reference-image-upload__input"
          disabled={disabled}
        />

        {slotLabels ? renderSlotMode() : (multiple ? renderGridMode() : renderSingleMode())}

        {showMediaLibrary && (
          <MediaLibraryModal
            isOpen={showMediaLibrary}
            onClose={() => setShowMediaLibrary(false)}
            mode={SelectionMode.SELECT}
            filterType={AssetType.IMAGE}
            onSelect={handleMediaLibrarySelect}
            onSelectMultiple={multiple ? handleMediaLibrarySelectMultiple : undefined}
            batchSelectButtonText={multiple ? '批量插入对话框' : undefined}
          />
        )}
      </div>
    </>
  );
};

export default ReferenceImageUpload;
