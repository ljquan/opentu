/**
 * PerformancePanel Component
 *
 * 性能监控面板 - 当内存使用过高时显示警告
 * 竖条形式展示在右下角，支持拖拽、常驻/关闭、位置记忆
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Tooltip } from 'tdesign-react';
import { CloseIcon, MoveIcon, PinIcon, PinFilledIcon, RefreshIcon, AddIcon } from 'tdesign-icons-react';
import { memoryMonitorService, MemoryStats } from '../../services/memory-monitor-service';
import { Z_INDEX } from '../../constants/z-index';
import { useI18n } from '../../i18n';
import { PlaitElement } from '@plait/core';
import { safeReload } from '../../utils/active-tasks';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import './performance-panel.scss';

// 存储键 - 只保存位置和固定状态，dismissed 不持久化
const STORAGE_KEY = 'drawnix_performance_panel_settings';

// 默认位置（右下角）
const DEFAULT_POSITION = { x: -1, y: -1 }; // -1 表示使用默认位置

// 内存阈值
const MEMORY_AUTO_SHOW_THRESHOLD = 80; // 80% 自动显示面板
const MEMORY_WITH_IMAGE_THRESHOLD = 60; // 60% 配合图片数量
const WARNING_THRESHOLD = 80; // 80% 显示警告样式
const CRITICAL_THRESHOLD = 95; // 95% 显示严重警告
const IMAGE_COUNT_THRESHOLD = 100; // 图片元素阈值

// 持久化设置（保存到 localStorage）
interface PersistedSettings {
  position: { x: number; y: number };
  pinned: boolean;
}

// 运行时状态（不持久化，刷新页面后重置）
interface RuntimeState {
  dismissed: boolean;
}

interface PerformancePanelProps {
  /** 容器元素 */
  container?: HTMLElement | null;
  /** 创建新项目的回调 */
  onCreateProject?: () => Promise<void>;
  /** 画布元素 */
  elements?: PlaitElement[];
}

export const PerformancePanel: React.FC<PerformancePanelProps> = ({
  container,
  onCreateProject,
  elements = [],
}) => {
  const { language } = useI18n();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);

  // 计算图片元素数量
  const imageCount = useMemo(() => {
    if (!elements || elements.length === 0) return 0;
    return elements.filter((el) => el.type === 'image').length;
  }, [elements]);
  
  // 持久化设置（位置和固定状态）
  const [persistedSettings, setPersistedSettings] = useState<PersistedSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          position: parsed.position || DEFAULT_POSITION,
          pinned: parsed.pinned || false,
        };
      }
    } catch {
      // ignore
    }
    return {
      position: DEFAULT_POSITION,
      pinned: false,
    };
  });
  
  // 运行时状态（不持久化，刷新页面后重置）
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({
    dismissed: false,
  });
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 保存持久化设置到 localStorage
  const savePersistedSettings = useCallback((newSettings: Partial<PersistedSettings>) => {
    setPersistedSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  // 检查内存状态
  const checkMemory = useCallback(() => {
    const stats = memoryMonitorService.getMemoryStats();
    setMemoryStats(stats);
  }, []);

  // 启动内存监控
  useEffect(() => {
    checkMemory();
    checkIntervalRef.current = setInterval(checkMemory, 5000); // 每 5 秒检查一次

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [checkMemory]);

  // 计算是否应该显示面板
  const shouldShow = useMemo(() => {
    if (!memoryStats) return false;
    if (persistedSettings.pinned) return true;
    if (runtimeState.dismissed) return false;
    
    // 内存使用超过 80% 自动显示
    const isHighMemory = memoryStats.usagePercent >= MEMORY_AUTO_SHOW_THRESHOLD;
    // 图片超过 100 且内存超过 60% 时显示
    const isImageAndMemory = imageCount >= IMAGE_COUNT_THRESHOLD && memoryStats.usagePercent >= MEMORY_WITH_IMAGE_THRESHOLD;
    
    return isHighMemory || isImageAndMemory;
  }, [memoryStats, imageCount, persistedSettings.pinned, runtimeState.dismissed]);

  // 计算警告级别
  const warningLevel = useMemo(() => {
    if (!memoryStats) return 'normal';
    
    // 优先检查内存严重警告
    if (memoryStats.usagePercent >= CRITICAL_THRESHOLD) return 'critical';
    
    // 检查内存警告或图片数量警告
    if (memoryStats.usagePercent >= WARNING_THRESHOLD || imageCount >= IMAGE_COUNT_THRESHOLD) {
      return 'warning';
    }
    
    return 'normal';
  }, [memoryStats, imageCount]);

  // 计算面板位置
  const panelStyle = useMemo(() => {
    const style: React.CSSProperties = {
      zIndex: Z_INDEX.PERFORMANCE_PANEL,
    };

    if (persistedSettings.position.x >= 0 && persistedSettings.position.y >= 0) {
      style.left = persistedSettings.position.x;
      style.top = persistedSettings.position.y;
      style.right = 'auto';
      style.bottom = 'auto';
    }

    return style;
  }, [persistedSettings.position]);

  // 拖拽开始
  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (!panelRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = panelRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setIsDragging(true);

      // 捕获指针
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  // 拖拽移动
  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      e.preventDefault();

      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // 限制在窗口范围内
      const maxX = window.innerWidth - (panelRef.current?.offsetWidth || 60);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 200);

      savePersistedSettings({
        position: {
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        },
      });
    },
    [isDragging, dragOffset, savePersistedSettings]
  );

  // 拖拽结束
  const handleDragEnd = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [isDragging]
  );

  // 切换固定状态
  const handleTogglePin = useCallback(() => {
    savePersistedSettings({ pinned: !persistedSettings.pinned });
  }, [persistedSettings.pinned, savePersistedSettings]);

  // 关闭面板（只在当前会话有效，刷新页面后重置）
  const handleClose = useCallback(() => {
    setRuntimeState({ dismissed: true });
  }, []);

  // 刷新页面释放内存
  const handleRefresh = useCallback(() => {
    safeReload();
  }, []);

  const handleRefreshClick = useCallback(async () => {
    const confirmed = await confirm({
      title: language === 'zh' ? '刷新页面' : 'Refresh page',
      description: language === 'zh' ? '刷新页面可释放内存' : 'Refresh to free memory',
      confirmText: language === 'zh' ? '刷新' : 'Refresh',
      cancelText: language === 'zh' ? '取消' : 'Cancel',
    });

    if (confirmed) {
      handleRefresh();
    }
  }, [confirm, handleRefresh, language]);

  // 创建新项目
  const [isCreating, setIsCreating] = useState(false);
  const handleCreateProject = useCallback(async () => {
    if (isCreating || !onCreateProject) return;
    
    setIsCreating(true);
    try {
      await onCreateProject();
      // 创建成功后会自动刷新页面（在回调中处理）
    } catch (error) {
      console.error('[PerformancePanel] Failed to create project:', error);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, onCreateProject]);

  if (!shouldShow) {
    return null;
  }

  const tooltipContent = (
    <div className="performance-panel__tooltip">
      <div className="performance-panel__tooltip-title">
        {language === 'zh' ? '内存使用情况' : 'Memory Usage'}
      </div>
      <div className="performance-panel__tooltip-content">
        <div>
          {language === 'zh' ? '已使用' : 'Used'}: {memoryStats?.formatted.used}
        </div>
        <div>
          {language === 'zh' ? '限制' : 'Limit'}: {memoryStats?.formatted.limit}
        </div>
        {imageCount > 0 && (
          <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            {language === 'zh' ? '图片数量' : 'Image Count'}: {imageCount}
            {imageCount >= IMAGE_COUNT_THRESHOLD && (
              <span style={{ color: '#E67E22', marginLeft: '4px' }}>
                ({language === 'zh' ? '建议清理' : 'Recommend cleaning'})
              </span>
            )}
          </div>
        )}
      </div>
      <div className="performance-panel__tooltip-tip">
        {language === 'zh'
          ? '➕ 新建项目可释放当前画布内存\n🔄 刷新页面完全释放内存'
          : '➕ New project frees current canvas memory\n🔄 Refresh page fully releases memory'}
      </div>
    </div>
  );

  return (
    <div
      ref={panelRef}
      className={`performance-panel performance-panel--${warningLevel} ${isDragging ? 'performance-panel--dragging' : ''}`}
      style={panelStyle}
    >
      {/* 拖拽手柄 */}
      <div
        className="performance-panel__drag-handle"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        title={language === 'zh' ? '拖拽移动' : 'Drag to move'}
      >
        <MoveIcon />
      </div>

      {/* 内存百分比 */}
      <Tooltip content={tooltipContent} placement="left" theme="light">
        <div className="performance-panel__content">
          <div className="performance-panel__icon">
            {warningLevel === 'critical' ? '🔴' : '🟠'}
          </div>
          <div className="performance-panel__value">
            {memoryStats?.usagePercent.toFixed(0)}%
          </div>
        </div>
      </Tooltip>

      {/* 分隔线 */}
      <div className="performance-panel__divider" />

      {/* 新建项目按钮 */}
      {onCreateProject && (
        <button
          className="performance-panel__btn"
          onClick={handleCreateProject}
          disabled={isCreating}
          title={language === 'zh' ? '新建项目' : 'New project'}
        >
          <AddIcon />
        </button>
      )}

      {/* 刷新页面按钮 */}
      <button
        className="performance-panel__btn"
        title={language === 'zh' ? '刷新页面' : 'Refresh page'}
        onClick={() => {
          void handleRefreshClick();
        }}
      >
        <RefreshIcon />
      </button>

      {/* 分隔线 */}
      <div className="performance-panel__divider" />

      {/* 固定/关闭按钮 */}
      <button
        className={`performance-panel__btn ${persistedSettings.pinned ? 'performance-panel__btn--active' : ''}`}
        onClick={handleTogglePin}
        title={persistedSettings.pinned ? (language === 'zh' ? '取消常驻' : 'Unpin') : (language === 'zh' ? '常驻' : 'Pin')}
      >
        {persistedSettings.pinned ? <PinFilledIcon /> : <PinIcon />}
      </button>

      <button
        className="performance-panel__btn"
        onClick={handleClose}
        title={language === 'zh' ? '关闭' : 'Close'}
      >
        <CloseIcon />
      </button>
      {confirmDialog}
    </div>
  );
};

export default PerformancePanel;
