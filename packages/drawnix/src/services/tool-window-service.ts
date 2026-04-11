/**
 * Tool Window Service
 * 
 * 管理工具箱工具以弹窗形式打开的状态
 * 支持最小化、常驻工具栏、位置记忆等功能
 */

import { BehaviorSubject, Observable } from 'rxjs';
import { ToolDefinition, ToolWindowState } from '../types/toolbox.types';

/** localStorage key for pinned tools */
const PINNED_TOOLS_STORAGE_KEY = 'aitu-pinned-tools';

/** 可序列化的工具信息 */
interface SerializableToolInfo {
  id: string;
  name: string;
  category?: string;
}

/**
 * 打开工具窗口选项
 */
interface OpenToolOptions {
  /** 是否自动最大化 */
  autoMaximize?: boolean;
  /** 是否自动设置为常驻 */
  autoPin?: boolean;
  /** 传递给工具组件的额外 props（如 initialNoteId） */
  componentProps?: Record<string, unknown>;
}

/**
 * 工具窗口管理服务
 */
class ToolWindowService {
  private static instance: ToolWindowService;
  
  /** 工具窗口状态映射 */
  private toolStates: Map<string, ToolWindowState> = new Map();
  
  /** 常驻工具 ID 集合 */
  private pinnedToolIds: Set<string> = new Set();
  
  /** 常驻工具信息缓存（用于刷新后恢复） */
  private pinnedToolInfos: Map<string, SerializableToolInfo> = new Map();
  
  /** 工具状态变化通知 */
  private toolStatesSubject = new BehaviorSubject<ToolWindowState[]>([]);
  
  /** 兼容旧 API：已打开的工具列表 */
  private openToolsSubject = new BehaviorSubject<ToolDefinition[]>([]);

  /** 会话内窗口激活顺序计数器 */
  private activationOrderCounter = 0;

  private constructor() {
    this.loadPinnedTools();
    // 延迟通知，让订阅者有机会订阅
    setTimeout(() => this.notify(), 0);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ToolWindowService {
    if (!ToolWindowService.instance) {
      ToolWindowService.instance = new ToolWindowService();
    }
    return ToolWindowService.instance;
  }

  /**
   * 从 localStorage 加载常驻工具列表
   */
  private loadPinnedTools(): void {
    try {
      const stored = localStorage.getItem(PINNED_TOOLS_STORAGE_KEY);
      if (stored) {
        const infos = JSON.parse(stored) as SerializableToolInfo[];
        // 兼容旧格式（只有 id 数组）
        if (Array.isArray(infos) && infos.length > 0) {
          if (typeof infos[0] === 'string') {
            // 旧格式：string[]
            (infos as unknown as string[]).forEach(id => {
              this.pinnedToolIds.add(id);
            });
          } else {
            // 新格式：SerializableToolInfo[]
            infos.forEach(info => {
              this.pinnedToolIds.add(info.id);
              this.pinnedToolInfos.set(info.id, info);
              // 为常驻工具创建初始状态（closed）
              this.toolStates.set(info.id, {
                tool: {
                  id: info.id,
                  name: info.name,
                  category: info.category,
                  // icon 和 component 在实际打开时会被更新
                } as ToolDefinition,
                status: 'closed',
                activationOrder: 0,
                isPinned: true,
              });
            });
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load pinned tools:', e);
    }
  }

  /**
   * 保存常驻工具列表到 localStorage
   */
  private savePinnedTools(): void {
    try {
      const infos: SerializableToolInfo[] = [];
      this.pinnedToolIds.forEach(id => {
        const info = this.pinnedToolInfos.get(id);
        if (info) {
          infos.push(info);
        }
      });
      localStorage.setItem(PINNED_TOOLS_STORAGE_KEY, JSON.stringify(infos));
    } catch (e) {
      console.warn('Failed to save pinned tools:', e);
    }
  }

  /**
   * 观察工具窗口状态列表（新 API）
   */
  observeToolStates(): Observable<ToolWindowState[]> {
    return this.toolStatesSubject.asObservable();
  }

  /**
   * 获取所有工具窗口状态
   */
  getToolStates(): ToolWindowState[] {
    return Array.from(this.toolStates.values());
  }

  /**
   * 获取需要在工具栏显示图标的工具列表
   * 包括：已打开的工具 + 最小化的工具 + 已关闭但常驻的工具
   */
  getToolbarTools(): ToolWindowState[] {
    return this.getToolStates().filter(
      state => state.status !== 'closed' || state.isPinned
    );
  }

  /**
   * 获取指定工具的状态
   */
  getToolState(toolId: string): ToolWindowState | undefined {
    return this.toolStates.get(toolId);
  }

  private nextActivationOrder(): number {
    this.activationOrderCounter += 1;
    return this.activationOrderCounter;
  }

  private getTopOpenActivationOrder(excludeToolId?: string): number {
    let maxOrder = 0;

    this.toolStates.forEach((state, toolId) => {
      if (toolId === excludeToolId || state.status !== 'open') {
        return;
      }
      if (state.activationOrder > maxOrder) {
        maxOrder = state.activationOrder;
      }
    });

    return maxOrder;
  }

  private promoteOpenTool(toolId: string): boolean {
    const state = this.toolStates.get(toolId);
    if (!state || state.status !== 'open') {
      return false;
    }

    if (state.activationOrder > this.getTopOpenActivationOrder(toolId)) {
      return false;
    }

    state.activationOrder = this.nextActivationOrder();
    return true;
  }

  markToolActivated(toolId: string): void {
    if (this.promoteOpenTool(toolId)) {
      this.notify();
    }
  }

  /**
   * 打开工具窗口
   * @param tool 工具定义
   * @param options 可选配置项
   */
  openTool(tool: ToolDefinition, options?: OpenToolOptions): void {
    const existingState = this.toolStates.get(tool.id);
    let shouldNotify = false;
    
    // 如果需要自动常驻，先设置
    if (options?.autoPin && !this.pinnedToolIds.has(tool.id)) {
      this.pinnedToolIds.add(tool.id);
      this.pinnedToolInfos.set(tool.id, {
        id: tool.id,
        name: tool.name,
        category: tool.category,
      });
      this.savePinnedTools();
    }
    
    if (existingState) {
      existingState.tool = tool;
      existingState.isPinned = this.pinnedToolIds.has(tool.id);

      if (existingState.status === 'open') {
        // 已经打开，更新 componentProps 并聚焦（WinBox 自身处理聚焦）
        if (options?.componentProps !== undefined) {
          existingState.componentProps = options.componentProps;
          shouldNotify = true;
        }
        shouldNotify = this.promoteOpenTool(tool.id) || shouldNotify;
      } else {
        // 从最小化或关闭状态恢复
        existingState.status = 'open';
        existingState.activationOrder = this.nextActivationOrder();
        shouldNotify = true;
        // 如果设置了自动最大化，更新状态
        if (options?.autoMaximize) {
          existingState.autoMaximize = true;
        }
        // 更新 componentProps
        if (options?.componentProps !== undefined) {
          existingState.componentProps = options.componentProps;
        }
      }
    } else {
      // 创建新的窗口状态
      const newState: ToolWindowState = {
        tool,
        status: 'open',
        activationOrder: this.nextActivationOrder(),
        isPinned: this.pinnedToolIds.has(tool.id),
        autoMaximize: options?.autoMaximize,
        componentProps: options?.componentProps,
      };
      this.toolStates.set(tool.id, newState);
      shouldNotify = true;
    }
    
    // 如果是常驻工具，更新缓存的工具信息
    if (this.pinnedToolIds.has(tool.id)) {
      this.pinnedToolInfos.set(tool.id, {
        id: tool.id,
        name: tool.name,
        category: tool.category,
      });
      this.savePinnedTools();
    }
    
    if (shouldNotify) {
      this.notify();
    }
  }

  /**
   * 关闭工具窗口
   * - 非常驻工具：从状态中移除
   * - 常驻工具：状态设为 closed，保留以便在工具栏显示
   */
  closeTool(toolId: string): void {
    const state = this.toolStates.get(toolId);
    if (!state) return;

    if (state.isPinned) {
      // 常驻工具：设为关闭状态，保留在 map 中
      state.status = 'closed';
    } else {
      // 非常驻工具：完全移除
      this.toolStates.delete(toolId);
    }
    
    this.notify();
  }

  /**
   * 最小化工具窗口
   * 保留实例，记录位置，在工具栏显示图标
   */
  minimizeTool(toolId: string, position?: { x: number; y: number }, size?: { width: number; height: number }): void {
    const state = this.toolStates.get(toolId);
    if (!state) return;

    state.status = 'minimized';
    if (position) {
      state.position = position;
    }
    if (size) {
      state.size = size;
    }
    
    this.notify();
  }

  /**
   * 从最小化恢复工具窗口
   */
  restoreTool(toolId: string): void {
    const state = this.toolStates.get(toolId);
    if (!state) return;

    state.status = 'open';
    state.activationOrder = this.nextActivationOrder();
    this.notify();
  }

  /**
   * 切换工具窗口可见性
   * - open -> minimized
   * - minimized -> open
   * - closed (pinned) -> open (新实例)
   */
  toggleToolVisibility(toolId: string): void {
    const state = this.toolStates.get(toolId);
    if (!state) return;

    switch (state.status) {
      case 'open':
        this.minimizeTool(toolId);
        break;
      case 'minimized':
        this.restoreTool(toolId);
        break;
      case 'closed':
        // 常驻工具从关闭状态重新打开（创建新实例）
        state.status = 'open';
        state.activationOrder = this.nextActivationOrder();
        // 清除位置和尺寸，让 WinBox 使用默认值
        state.position = undefined;
        state.size = undefined;
        this.notify();
        break;
    }
  }

  /**
   * 设置工具是否常驻工具栏
   */
  setPinned(toolId: string, pinned: boolean): void {
    const state = this.toolStates.get(toolId);
    
    if (pinned) {
      this.pinnedToolIds.add(toolId);
      if (state) {
        state.isPinned = true;
        // 保存工具信息以便刷新后恢复
        this.pinnedToolInfos.set(toolId, {
          id: state.tool.id,
          name: state.tool.name,
          category: state.tool.category,
        });
      }
    } else {
      this.pinnedToolIds.delete(toolId);
      this.pinnedToolInfos.delete(toolId);
      if (state) {
        state.isPinned = false;
        // 如果取消常驻且已关闭，则从 map 中移除
        if (state.status === 'closed') {
          this.toolStates.delete(toolId);
        }
      }
    }
    
    this.savePinnedTools();
    this.notify();
  }

  /**
   * 检查工具是否常驻
   */
  isPinned(toolId: string): boolean {
    return this.pinnedToolIds.has(toolId);
  }

  /**
   * 获取所有常驻工具 ID
   */
  getPinnedToolIds(): string[] {
    return Array.from(this.pinnedToolIds);
  }

  /**
   * 更新工具窗口位置和尺寸
   */
  updateToolPosition(
    toolId: string,
    position: { x: number; y: number },
    size?: { width: number; height: number }
  ): void {
    const state = this.toolStates.get(toolId);
    if (!state) return;

    state.position = position;
    if (size) {
      state.size = size;
    }
    // 不需要通知，位置更新不触发重渲染
  }

  /**
   * 更新工具窗口尺寸
   */
  updateToolSize(toolId: string, size: { width: number; height: number }): void {
    const state = this.toolStates.get(toolId);
    if (!state) return;

    state.size = size;
    this.notify();
  }

  /**
   * 检查工具是否已打开窗口（兼容旧 API）
   */
  isToolOpen(toolId: string): boolean {
    const state = this.toolStates.get(toolId);
    return state?.status === 'open';
  }

  /**
   * 检查工具是否已最小化
   */
  isToolMinimized(toolId: string): boolean {
    const state = this.toolStates.get(toolId);
    return state?.status === 'minimized';
  }

  /**
   * 通知订阅者
   */
  private notify(): void {
    const states = this.getToolStates();
    this.toolStatesSubject.next(states);
    
    // 兼容旧 API
    const openTools = states
      .filter(state => state.status === 'open')
      .map(state => state.tool);
    this.openToolsSubject.next(openTools);
  }
}

export const toolWindowService = ToolWindowService.getInstance();
