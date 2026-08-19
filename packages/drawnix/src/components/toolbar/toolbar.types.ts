/**
 * Unified toolbar type definitions
 * @file toolbar.types.ts
 */

import type { MediaLibraryConfig } from '../../types/asset.types';

/**
 * 统一工具栏容器组件属性
 */
export interface UnifiedToolbarProps {
  /**
   * (可选) 自定义CSS类名
   */
  className?: string;
  /**
   * (可选) 项目抽屉是否打开
   */
  projectDrawerOpen?: boolean;
  /**
   * (可选) 项目抽屉打开/关闭切换回调
   */
  onProjectDrawerToggle?: () => void;
  /**
   * (可选) 工具箱抽屉是否打开
   */
  toolboxDrawerOpen?: boolean;
  /**
   * (可选) 工具箱抽屉打开/关闭切换回调
   */
  onToolboxDrawerToggle?: () => void;
  /**
   * (可选) 任务面板是否展开
   */
  taskPanelExpanded?: boolean;
  /**
   * (可选) 任务面板展开/关闭切换回调
   */
  onTaskPanelToggle?: () => void;
  /**
   * (可选) 备份恢复对话框打开回调
   */
  onOpenBackupRestore?: () => void;
  /**
   * (可选) 云端同步设置打开回调
   */
  onOpenCloudSync?: () => void;
  /**
   * (可选) 知识库开关回调
   */
  onKnowledgeBaseToggle?: () => void;
  /**
   * (可选) 素材库打开回调
   */
  onOpenMediaLibrary?: (config?: Partial<MediaLibraryConfig> & {
    selectButtonText?: string;
    batchSelectButtonText?: string;
  }) => void;
  /**
   * 延后功能层是否已启用
   */
  deferredFeaturesEnabled?: boolean;

  /**
   * 常驻工具条是否已启用
   */
  minimizedToolsBarEnabled?: boolean;

  /**
   * 确保工具窗口运行时已启用
   */
  onEnableToolWindows?: () => void;
}

/**
 * 工具栏分区通用属性
 * 应用于 AppToolbar, CreationToolbar
 */
export interface ToolbarSectionProps {
  /**
   * 是否嵌入到统一容器中
   * - true: 不应用独立定位样式,作为子组件渲染
   * - false: 应用原有绝对定位样式(移动端使用)
   * @default false
   */
  embedded?: boolean;

  /**
   * 是否处于图标模式
   * - true: 隐藏文本标签,仅显示图标
   * - false: 正常显示图标和文本
   * @default false
   */
  iconMode?: boolean;

  /**
   * 素材库打开回调
   */
  onOpenMediaLibrary?: (config?: Partial<MediaLibraryConfig> & {
    selectButtonText?: string;
    batchSelectButtonText?: string;
  }) => void;

  /**
   * 延后功能层是否已启用
   */
  deferredFeaturesEnabled?: boolean;

  /**
   * 常驻工具条是否已启用
   */
  minimizedToolsBarEnabled?: boolean;

  /**
   * 确保工具窗口运行时已启用
   */
  onEnableToolWindows?: () => void;
}
