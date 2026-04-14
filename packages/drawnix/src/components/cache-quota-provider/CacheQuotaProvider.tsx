/**
 * Cache Quota Provider
 *
 * Global provider that monitors cache quota and shows dialog when storage is full
 * Prompts user to open media library for manual cleanup
 */

import React, { useState, useCallback } from 'react';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { useCacheQuotaMonitor } from '../../hooks/useUnifiedCache';

export interface CacheQuotaProviderProps {
  children: React.ReactNode;
  /** Callback to open media library */
  onOpenMediaLibrary?: () => void;
}

/**
 * CacheQuotaProvider component
 * Monitors cache quota and shows dialog when storage is full
 */
export const CacheQuotaProvider: React.FC<CacheQuotaProviderProps> = ({
  children,
  onOpenMediaLibrary,
}) => {
  const [dialogVisible, setDialogVisible] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const handleQuotaExceeded = useCallback(() => {
    // Only show dialog if not already visible
    if (!dialogVisible) {
      setDialogVisible(true);
      void confirm({
        title: '缓存空间已满',
        description: '图片缓存空间已满，无法继续缓存新图片。是否打开素材库清理缓存？',
        confirmText: '打开素材库',
        cancelText: '稍后处理',
        confirmTheme: 'warning',
      }).then((confirmed) => {
        setDialogVisible(false);
        if (confirmed) {
          onOpenMediaLibrary?.();
        }
      });
    }
  }, [confirm, dialogVisible, onOpenMediaLibrary]);

  // Monitor quota
  useCacheQuotaMonitor(handleQuotaExceeded);

  return (
    <>
      {children}
      {confirmDialog}
    </>
  );
};
