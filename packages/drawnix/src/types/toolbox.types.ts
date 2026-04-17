/**
 * Toolbox Type Definitions
 *
 * 定义工具箱系统的所有 TypeScript 类型和接口
 */

import { PlaitElement, Point } from '@plait/core';

export interface ToolDefaultWindowBehavior {
  /** 打开工具后是否默认常驻到左侧最小化工具栏 */
  autoPinOnOpen?: boolean;
}

/**
 * 工具定义 - 工具箱中的工具配置
 *
 * 定义可用工具的基本信息和默认配置
 */
export type ToolDefinition = {
  /** 唯一标识 */
  id: string;

  /** 工具名称 */
  name: string;

  /** 工具描述 */
  description?: string;

  /** 图标（emoji 或 icon name 或 React 组件） */
  icon?: string | React.ReactNode;

  /** 分类 */
  category?: string;

  /** 默认宽度（画布单位） */
  defaultWidth?: number;

  /** 默认高度（画布单位） */
  defaultHeight?: number;

  /** iframe sandbox 权限 */
  permissions?: string[];

  /** 是否支持同工具多窗口实例 */
  supportsMultipleWindows?: boolean;

  /** 默认窗口行为 */
  defaultWindowBehavior?: ToolDefaultWindowBehavior;
} & (
  | {
      /** iframe URL (外部页面工具必填) */
      url: string;
      /** 内部组件标识 */
      component?: never;
    }
  | {
      /** iframe URL */
      url?: never;
      /** 内部组件标识 (内部 React 组件工具必填) */
      component: string;
    }
);

/**
 * 工具元素 - 画布上的工具实例
 *
 * 继承 PlaitElement，成为画布的原生元素，支持拖拽、缩放、旋转等完整交互能力
 */
export type PlaitTool = PlaitElement & {
  /** 元素类型标识 */
  type: 'tool';

  /** 位置和尺寸（画布坐标）[左上角, 右下角] */
  points: [Point, Point];

  /** 旋转角度（度数） */
  angle: number;

  /** 工具定义ID（关联到 ToolDefinition） */
  toolId: string;

  /** 可选元数据 */
  metadata?: {
    /** 工具名称 */
    name?: string;
    /** 工具分类 */
    category?: string;
    /** iframe sandbox 权限列表 */
    permissions?: string[];
    /** 内部组件标识 */
    component?: string;
  };
} & (
  | {
      /** iframe URL */
      url: string;
      /** 内部组件标识 */
      component?: never;
    }
  | {
      /** iframe URL */
      url?: never;
      /** 内部组件标识 */
      component: string;
    }
);

/**
 * 工具分类枚举
 */
export enum ToolCategory {
  /** AI 工具（提示词、生成等） */
  AI_TOOLS = 'ai-tools',

  /** 内容工具（文案、素材等） */
  CONTENT_TOOLS = 'content-tools',

  /** 实用工具（批处理、转换等） */
  UTILITIES = 'utilities',

  /** 自定义工具 */
  CUSTOM = 'custom',
}

/**
 * 工具箱状态
 */
export interface ToolboxState {
  /** 是否打开 */
  isOpen: boolean;

  /** 当前选中的分类 */
  selectedCategory?: string;

  /** 搜索关键词 */
  searchQuery?: string;
}

/**
 * 工具窗口状态枚举
 */
export type ToolWindowStatus = 'open' | 'minimized' | 'closed';

export type ToolWindowLaunchMode = 'auto' | 'reuse' | 'new';

export interface ToolInstanceContextProps {
  /** 当前窗口实例 ID */
  toolInstanceId: string;

  /** 所属工具 ID */
  toolId: string;

  /** 同工具下的实例序号 */
  instanceIndex: number;
}

/**
 * 工具窗口状态 - 管理弹窗形式打开的工具
 *
 * 用于跟踪工具弹窗的显示状态、位置和常驻设置
 */
export interface ToolWindowState {
  /** 窗口实例 ID；launcher 使用伪 instanceId */
  instanceId: string;

  /** 所属工具 ID */
  toolId: string;

  /** 同工具下的实例序号；launcher 固定为 0 */
  instanceIndex: number;

  /** 工具定义 */
  tool: ToolDefinition;

  /** 窗口状态 */
  status: ToolWindowStatus;

  /** 窗口位置（屏幕坐标） */
  position?: { x: number; y: number };

  /** 窗口尺寸 */
  size?: { width: number; height: number };

  /** 最近一次激活顺序，值越大层级越高 */
  activationOrder: number;

  /** 是否常驻工具栏 */
  isPinned: boolean;

  /** 是否为关闭态 launcher 图标 */
  isLauncher: boolean;

  /** 是否自动最大化（仅在首次打开时生效） */
  autoMaximize?: boolean;

  /** 传递给工具组件的额外 props（如 initialNoteId） */
  componentProps?: Record<string, unknown>;
}
