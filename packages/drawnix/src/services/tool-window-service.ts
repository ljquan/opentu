/**
 * Tool Window Service
 *
 * 管理工具箱工具以弹窗形式打开的状态。
 * 支持多实例窗口、最小化、常驻工具栏、位置记忆等能力。
 */

import { BehaviorSubject, Observable } from 'rxjs';
import {
  ToolDefinition,
  ToolWindowLaunchMode,
  ToolWindowState,
} from '../types/toolbox.types';

/** localStorage key for pinned tools */
const PINNED_TOOLS_STORAGE_KEY = 'aitu-pinned-tools';
const PIN_PREFERENCES_STORAGE_KEY = 'aitu-tool-pin-preferences';
const LAUNCHER_INSTANCE_PREFIX = 'launcher:';
const INSTANCE_OFFSET_X = 36;
const INSTANCE_OFFSET_Y = 28;
const INSTANCE_BASE_X = 96;
const INSTANCE_BASE_Y = 72;

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
  /** 打开策略 */
  launchMode?: ToolWindowLaunchMode;
  /** 指定窗口初始位置，避免与调用方窗口重叠 */
  position?: { x: number; y: number };
}

/**
 * 工具窗口管理服务
 */
class ToolWindowService {
  private static instance: ToolWindowService;

  /** 工具窗口状态映射（真实窗口实例） */
  private toolStates: Map<string, ToolWindowState> = new Map();

  /** 常驻工具 ID 集合 */
  private pinnedToolIds: Set<string> = new Set();

  /** 常驻工具信息缓存（用于刷新后恢复 launcher 图标） */
  private pinnedToolInfos: Map<string, SerializableToolInfo> = new Map();

  /** 用户显式设置过的常驻偏好（覆盖工具默认行为） */
  private pinPreferences: Map<string, boolean> = new Map();

  /** 工具状态变化通知（仅真实实例） */
  private toolStatesSubject = new BehaviorSubject<ToolWindowState[]>([]);

  /** 兼容旧 API：已打开的工具列表 */
  private openToolsSubject = new BehaviorSubject<ToolDefinition[]>([]);

  /** 会话内窗口激活顺序计数器 */
  private activationOrderCounter = 0;

  /** 同工具实例序号计数器（关闭后不回收） */
  private instanceCounters: Map<string, number> = new Map();

  private constructor() {
    this.loadPinPreferences();
    this.loadPinnedTools();
    this.reconcilePinnedToolsWithPreferences();
    setTimeout(() => this.notify(), 0);
  }

  static getInstance(): ToolWindowService {
    if (!ToolWindowService.instance) {
      ToolWindowService.instance = new ToolWindowService();
    }
    return ToolWindowService.instance;
  }

  private loadPinnedTools(): void {
    try {
      const stored = localStorage.getItem(PINNED_TOOLS_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const infos = JSON.parse(stored) as SerializableToolInfo[];
      if (!Array.isArray(infos) || infos.length === 0) {
        return;
      }

      if (typeof infos[0] === 'string') {
        (infos as unknown as string[]).forEach((id) => {
          this.pinnedToolIds.add(id);
        });
        return;
      }

      infos.forEach((info) => {
        this.pinnedToolIds.add(info.id);
        this.pinnedToolInfos.set(info.id, info);
      });
    } catch (e) {
      console.warn('Failed to load pinned tools:', e);
    }
  }

  private loadPinPreferences(): void {
    try {
      const stored = localStorage.getItem(PIN_PREFERENCES_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const raw = JSON.parse(stored) as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') {
        return;
      }

      Object.entries(raw).forEach(([toolId, value]) => {
        if (typeof value === 'boolean') {
          this.pinPreferences.set(toolId, value);
        }
      });
    } catch (e) {
      console.warn('Failed to load tool pin preferences:', e);
    }
  }

  private savePinnedTools(): void {
    try {
      const infos: SerializableToolInfo[] = [];
      this.pinnedToolIds.forEach((id) => {
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

  private savePinPreferences(): void {
    try {
      const serialized = Object.fromEntries(this.pinPreferences.entries());
      localStorage.setItem(
        PIN_PREFERENCES_STORAGE_KEY,
        JSON.stringify(serialized)
      );
    } catch (e) {
      console.warn('Failed to save tool pin preferences:', e);
    }
  }

  private reconcilePinnedToolsWithPreferences(): void {
    this.pinPreferences.forEach((pinned, toolId) => {
      if (pinned) {
        return;
      }
      this.pinnedToolIds.delete(toolId);
      this.pinnedToolInfos.delete(toolId);
    });
  }

  observeToolStates(): Observable<ToolWindowState[]> {
    return this.toolStatesSubject.asObservable();
  }

  observeOpenTools(): Observable<ToolDefinition[]> {
    return this.openToolsSubject.asObservable();
  }

  getToolStates(): ToolWindowState[] {
    return Array.from(this.toolStates.values());
  }

  getToolbarTools(): ToolWindowState[] {
    const pinnedOrder = new Map(
      Array.from(this.pinnedToolIds).map((toolId, index) => [toolId, index])
    );
    const instances = this.getToolStates().sort((a, b) => {
      if (a.toolId === b.toolId) {
        return a.instanceIndex - b.instanceIndex;
      }

      const aPinnedOrder = pinnedOrder.get(a.toolId);
      const bPinnedOrder = pinnedOrder.get(b.toolId);

      if (aPinnedOrder !== undefined && bPinnedOrder !== undefined) {
        return aPinnedOrder - bPinnedOrder;
      }
      if (aPinnedOrder !== undefined) {
        return -1;
      }
      if (bPinnedOrder !== undefined) {
        return 1;
      }

      if (a.activationOrder !== b.activationOrder) {
        return a.activationOrder - b.activationOrder;
      }

      return a.toolId.localeCompare(b.toolId);
    });

    const toolIdsWithInstances = new Set(instances.map((state) => state.toolId));
    const launchers = Array.from(this.pinnedToolIds)
      .filter((toolId) => !toolIdsWithInstances.has(toolId))
      .map((toolId) => this.createLauncherState(toolId))
      .filter((state): state is ToolWindowState => !!state);

    return [...instances, ...launchers];
  }

  getToolInstances(toolId: string): ToolWindowState[] {
    return this.getToolStates()
      .filter((state) => state.toolId === toolId)
      .sort((a, b) => {
        if (a.instanceIndex !== b.instanceIndex) {
          return a.instanceIndex - b.instanceIndex;
        }
        return a.activationOrder - b.activationOrder;
      });
  }

  getToolInstance(instanceId: string): ToolWindowState | undefined {
    return this.toolStates.get(instanceId);
  }

  getToolState(target: string): ToolWindowState | undefined {
    return this.resolveState(target) || this.createLauncherState(target);
  }

  getPrimaryToolState(toolId: string): ToolWindowState | undefined {
    const instances = this.getToolInstances(toolId);
    if (instances.length === 0) {
      return undefined;
    }

    const openInstances = instances.filter((state) => state.status === 'open');
    if (openInstances.length > 0) {
      return openInstances.reduce((top, state) =>
        top.activationOrder >= state.activationOrder ? top : state
      );
    }

    return instances.reduce((top, state) =>
      top.activationOrder >= state.activationOrder ? top : state
    );
  }

  canOpenMultiple(tool: ToolDefinition): boolean {
    if (typeof tool.supportsMultipleWindows === 'boolean') {
      return tool.supportsMultipleWindows;
    }
    return !!tool.url;
  }

  openTool(tool: ToolDefinition, options?: OpenToolOptions): string | undefined {
    const launchMode = this.resolveLaunchMode(tool, options?.launchMode);
    this.applyAutoPinBehavior(tool, options);

    if (this.pinnedToolIds.has(tool.id)) {
      this.updatePinnedToolInfo(tool);
      this.savePinnedTools();
    }

    if (launchMode === 'reuse') {
      const reusableState = this.getPrimaryToolState(tool.id);
      if (reusableState) {
        this.applyOpenToExistingState(reusableState, tool, options);
        this.notify();
        return reusableState.instanceId;
      }
    }

    const instanceId = this.openNewToolInstance(tool, options);
    return instanceId;
  }

  openNewToolInstance(
    tool: ToolDefinition,
    options?: Omit<OpenToolOptions, 'launchMode'>
  ): string {
    this.applyAutoPinBehavior(tool, options);

    const instanceId = this.generateInstanceId(tool.id);
    const instanceIndex = this.nextInstanceIndex(tool.id);
    const newState: ToolWindowState = {
      instanceId,
      toolId: tool.id,
      instanceIndex,
      tool,
      status: 'open',
      position: options?.position || this.getCascadedPosition(tool.id),
      activationOrder: this.nextActivationOrder(),
      isPinned: this.pinnedToolIds.has(tool.id),
      isLauncher: false,
      autoMaximize: options?.autoMaximize,
      componentProps: options?.componentProps,
    };

    if (newState.isPinned) {
      this.updatePinnedToolInfo(tool);
      this.savePinnedTools();
    }

    this.toolStates.set(instanceId, newState);
    this.notify();
    return instanceId;
  }

  closeTool(target: string): void {
    const state = this.resolveState(target);
    if (!state) {
      return;
    }

    this.toolStates.delete(state.instanceId);
    if (this.getToolInstances(state.toolId).length === 0) {
      this.instanceCounters.delete(state.toolId);
    }
    this.notify();
  }

  minimizeTool(
    target: string,
    position?: { x: number; y: number },
    size?: { width: number; height: number }
  ): void {
    const state = this.resolveState(target);
    if (!state) {
      return;
    }

    state.status = 'minimized';
    if (position) {
      state.position = position;
    }
    if (size) {
      state.size = size;
    }
    this.notify();
  }

  restoreTool(target: string): void {
    const state = this.resolveState(target);
    if (!state) {
      return;
    }

    state.status = 'open';
    state.activationOrder = this.nextActivationOrder();
    this.notify();
  }

  toggleToolVisibility(target: string): void {
    const state = this.resolveState(target);
    if (!state) {
      return;
    }

    switch (state.status) {
      case 'open':
        this.minimizeTool(state.instanceId);
        break;
      case 'minimized':
        this.restoreTool(state.instanceId);
        break;
      default:
        break;
    }
  }

  setPinned(toolId: string, pinned: boolean): void {
    const state = this.getPrimaryToolState(toolId);
    this.setPinnedState(toolId, pinned, {
      tool: state?.tool,
      persistPreference: true,
    });

    this.getToolInstances(toolId).forEach((state) => {
      state.isPinned = pinned;
    });

    this.notify();
  }

  isPinned(toolId: string): boolean {
    return this.pinnedToolIds.has(toolId);
  }

  getPinnedToolIds(): string[] {
    return Array.from(this.pinnedToolIds);
  }

  updateToolPosition(
    target: string,
    position: { x: number; y: number },
    size?: { width: number; height: number }
  ): void {
    const state = this.resolveState(target);
    if (!state) {
      return;
    }

    state.position = position;
    if (size) {
      state.size = size;
    }
  }

  updateToolSize(
    target: string,
    size: { width: number; height: number }
  ): void {
    const state = this.resolveState(target);
    if (!state) {
      return;
    }

    state.size = size;
    this.notify();
  }

  markToolActivated(target: string): void {
    const state = this.resolveState(target);
    if (!state || state.status !== 'open') {
      return;
    }

    if (state.activationOrder > this.getTopOpenActivationOrder(state.instanceId)) {
      return;
    }

    state.activationOrder = this.nextActivationOrder();
    this.notify();
  }

  isToolOpen(toolId: string): boolean {
    return this.getToolInstances(toolId).some((state) => state.status === 'open');
  }

  isToolMinimized(toolId: string): boolean {
    return this.getToolInstances(toolId).some(
      (state) => state.status === 'minimized'
    );
  }

  private resolveLaunchMode(
    tool: ToolDefinition,
    launchMode: ToolWindowLaunchMode | undefined
  ): Exclude<ToolWindowLaunchMode, 'auto'> {
    if (launchMode && launchMode !== 'auto') {
      return launchMode;
    }
    return this.canOpenMultiple(tool) ? 'new' : 'reuse';
  }

  private applyOpenToExistingState(
    state: ToolWindowState,
    tool: ToolDefinition,
    options?: Omit<OpenToolOptions, 'launchMode'>
  ): void {
    state.tool = tool;
    state.toolId = tool.id;
    state.isPinned = this.pinnedToolIds.has(tool.id);
    state.isLauncher = false;

    if (options?.componentProps !== undefined) {
      state.componentProps = options.componentProps;
    }

    if (state.status !== 'open') {
      state.status = 'open';
      state.activationOrder = this.nextActivationOrder();
      if (options?.autoMaximize) {
        state.autoMaximize = true;
      }
      return;
    }

    if (options?.autoMaximize) {
      state.autoMaximize = true;
    }

    state.activationOrder = this.nextActivationOrder();
  }

  private resolveState(target: string): ToolWindowState | undefined {
    return this.toolStates.get(target) || this.getPrimaryToolState(target);
  }

  private shouldAutoPinOnOpen(
    tool: ToolDefinition,
    options?: Omit<OpenToolOptions, 'launchMode'>
  ): boolean {
    if (options && Object.prototype.hasOwnProperty.call(options, 'autoPin')) {
      return options.autoPin === true;
    }

    const userPreference = this.pinPreferences.get(tool.id);
    if (typeof userPreference === 'boolean') {
      return userPreference;
    }

    return tool.defaultWindowBehavior?.autoPinOnOpen === true;
  }

  private applyAutoPinBehavior(
    tool: ToolDefinition,
    options?: Omit<OpenToolOptions, 'launchMode'>
  ): void {
    if (!this.shouldAutoPinOnOpen(tool, options)) {
      return;
    }

    const persistPreference =
      options && Object.prototype.hasOwnProperty.call(options, 'autoPin');
    this.setPinnedState(tool.id, true, { tool, persistPreference });
  }

  private updatePinnedToolInfo(tool: ToolDefinition): void {
    this.pinnedToolInfos.set(tool.id, {
      id: tool.id,
      name: tool.name,
      category: tool.category,
    });
  }

  private setPinnedState(
    toolId: string,
    pinned: boolean,
    options?: {
      tool?: ToolDefinition;
      persistPreference?: boolean;
    }
  ): void {
    if (pinned) {
      this.pinnedToolIds.add(toolId);
      const tool = options?.tool || this.getPrimaryToolState(toolId)?.tool;
      if (tool) {
        this.updatePinnedToolInfo(tool);
      }
    } else {
      this.pinnedToolIds.delete(toolId);
      this.pinnedToolInfos.delete(toolId);
    }

    if (options?.persistPreference) {
      this.pinPreferences.set(toolId, pinned);
      this.savePinPreferences();
    }

    this.savePinnedTools();
  }

  private createLauncherState(toolId: string): ToolWindowState | undefined {
    if (!this.pinnedToolIds.has(toolId)) {
      return undefined;
    }

    const info = this.pinnedToolInfos.get(toolId);
    if (!info) {
      return undefined;
    }

    return {
      instanceId: `${LAUNCHER_INSTANCE_PREFIX}${toolId}`,
      toolId,
      instanceIndex: 0,
      tool: {
        id: info.id,
        name: info.name,
        category: info.category,
      } as ToolDefinition,
      status: 'closed',
      activationOrder: 0,
      isPinned: true,
      isLauncher: true,
    };
  }

  private nextActivationOrder(): number {
    this.activationOrderCounter += 1;
    return this.activationOrderCounter;
  }

  private nextInstanceIndex(toolId: string): number {
    const next = (this.instanceCounters.get(toolId) || 0) + 1;
    this.instanceCounters.set(toolId, next);
    return next;
  }

  private getTopOpenActivationOrder(excludeInstanceId?: string): number {
    let maxOrder = 0;

    this.toolStates.forEach((state, instanceId) => {
      if (instanceId === excludeInstanceId || state.status !== 'open') {
        return;
      }
      if (state.activationOrder > maxOrder) {
        maxOrder = state.activationOrder;
      }
    });

    return maxOrder;
  }

  private getCascadedPosition(
    toolId: string
  ): { x: number; y: number } | undefined {
    const instances = this.getToolInstances(toolId);
    if (instances.length === 0) {
      return undefined;
    }

    const latestState = instances.reduce((latest, state) =>
      latest.activationOrder >= state.activationOrder ? latest : state
    );
    const fallbackOffset = instances.length;

    return {
      x:
        (latestState.position?.x ?? INSTANCE_BASE_X + fallbackOffset * INSTANCE_OFFSET_X) +
        INSTANCE_OFFSET_X,
      y:
        (latestState.position?.y ?? INSTANCE_BASE_Y + fallbackOffset * INSTANCE_OFFSET_Y) +
        INSTANCE_OFFSET_Y,
    };
  }

  private generateInstanceId(toolId: string): string {
    const suffix =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return `${toolId}:${suffix}`;
  }

  private notify(): void {
    const states = this.getToolStates();
    this.toolStatesSubject.next(states);

    const openTools = states
      .filter((state) => state.status === 'open')
      .map((state) => state.tool);
    this.openToolsSubject.next(openTools);
  }
}

export const toolWindowService = ToolWindowService.getInstance();
