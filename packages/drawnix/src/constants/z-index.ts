/**
 * Z-Index 层级管理常量
 *
 * 采用分层设计，每层预留100个单位空间
 * 详细规范请参考: docs/Z_INDEX_GUIDE.md
 */

export const Z_INDEX = {
  // ==========================================
  // Layer 0: Base (0-999)
  // ==========================================
  CANVAS_INTERNAL: 100,

  // ==========================================
  // Layer 1: Canvas Elements (1000-1999)
  // ==========================================
  CANVAS_DECORATION: 1000,
  CANVAS_TEMPORARY: 1100,

  // ==========================================
  // Layer 2: Toolbars (2000-2999)
  // ==========================================
  UNIFIED_TOOLBAR: 2000,
  CREATION_TOOLBAR: 2010,
  POPUP_TOOLBAR: 2020,
  ZOOM_TOOLBAR: 2030,
  APP_TOOLBAR: 2040,
  PENCIL_TOOLBAR: 2050,
  TASK_PET_OVERLAY: 2060,

  // ==========================================
  // Layer 3: Popovers (3000-3999)
  // ==========================================
  POPOVER: 3000,
  POPOVER_FEEDBACK: 3010,
  POPOVER_ZOOM: 3020,

  // ==========================================
  // Layer 3.5: Popovers above Drawers (4500-4999)
  // 这些 popover 需要显示在抽屉之上
  // ==========================================
  POPOVER_APP: 4500,

  // ==========================================
  // Layer 4: Drawers/Panels (4000-4999)
  // ==========================================
  TASK_QUEUE_PANEL: 4000,
  VIEW_NAVIGATION: 4005, // 视图导航（缩放+小地图），在 ChatDrawer 下方
  MINIMAP: 4005, // 保留兼容性，与 VIEW_NAVIGATION 相同
  CHAT_DRAWER: 4010,
  GENERATION_HISTORY: 4020,
  TOOLBOX_DRAWER: 4040,

  // ==========================================
  // Layer 5: Modals (5000-5999)
  // ==========================================
  DIALOG: 5200,
  DIALOG_CLEAN_CONFIRM: 5201,
  DIALOG_SETTINGS: 5200,
  DIALOG_AI_IMAGE: 5000,
  DIALOG_AI_VIDEO: 5000,
  DIALOG_INNER: 5200,
  DIALOG_POPOVER: 5500,
  TOOLTIP: 5600,

  // ==========================================
  // Layer 6: Notifications (6000-6999)
  // ==========================================
  PERFORMANCE_PANEL: 5900, // 性能面板，低于通知但高于对话框
  ACTIVE_TASK_WARNING: 6000,
  TOAST: 6100,
  MESSAGE: 6200,

  // ==========================================
  // Layer 7: Auth Dialogs (7000-7999)
  // ==========================================
  AUTH_DIALOG: 7000,

  // ==========================================
  // Layer 8: Image Viewer (8000-8999)
  // ==========================================
  IMAGE_VIEWER: 8000,
  IMAGE_VIEWER_TOOLBAR: 8010,
  IMAGE_VIEWER_CLOSE: 8020,

  // ==========================================
  // Layer 9: Critical Overlays (9000+)
  // ==========================================
  LOADING: 9000,
  SYSTEM_ERROR: 9100,
  SLIDESHOW: 9500,
  DEBUG: 9999,

  // ==========================================
  // Layer 10: Dropdown Portal (10000)
  // 用于 Portal 渲染的下拉菜单，需要在所有其他 UI 之上
  // ==========================================
  DROPDOWN_PORTAL: 10000,
} as const;

export type ZIndexKey = keyof typeof Z_INDEX;

/**
 * 获取z-index值的辅助函数
 * @param key - Z_INDEX的键名
 * @returns z-index数值
 *
 * @example
 * ```tsx
 * import { getZIndex } from '@/constants/z-index';
 *
 * <div style={{ zIndex: getZIndex('DIALOG_AI_IMAGE') }}>
 * ```
 */
export function getZIndex(key: ZIndexKey): number {
  return Z_INDEX[key];
}
