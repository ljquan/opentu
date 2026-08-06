/**
 * Snapshot Helper
 * 快照测试辅助工具，支持状态矩阵和交互前后截图
 */
import { type Page, type Locator, expect } from '@playwright/test';

/**
 * 组件状态定义
 */
export interface ComponentState {
  /** 状态名称 */
  name: string;
  /** 状态设置函数 */
  setup: () => Promise<void>;
  /** 可选的清理函数 */
  cleanup?: () => Promise<void>;
}

/**
 * 快照配置
 */
export interface SnapshotConfig {
  /** 最大差异像素比例 */
  maxDiffPixelRatio?: number;
  /** 等待时间（动画稳定） */
  waitTime?: number;
  /** 是否全页面截图 */
  fullPage?: boolean;
  /** 遮罩元素（隐藏动态内容） */
  mask?: Locator[];
}

/**
 * 交互快照对
 */
export interface InteractionSnapshotPair {
  /** 前状态快照名 */
  before: string;
  /** 后状态快照名 */
  after: string;
  /** 交互操作 */
  interaction: () => Promise<void>;
}

/**
 * 批量快照项
 */
export interface BatchSnapshotItem {
  /** 定位器 */
  locator: Locator;
  /** 快照名称 */
  name: string;
  /** 可选配置 */
  config?: SnapshotConfig;
}

const DEFAULT_CONFIG: SnapshotConfig = {
  maxDiffPixelRatio: 0.08,
  waitTime: 500,
  fullPage: false,
};

/**
 * 快照辅助工具类
 */
export class SnapshotHelper {
  private page: Page;
  private defaultConfig: SnapshotConfig;

  constructor(page: Page, config?: Partial<SnapshotConfig>) {
    this.page = page;
    this.defaultConfig = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 等待并截图
   * @param locator 要截图的元素
   * @param name 快照名称
   * @param config 可选配置
   */
  async waitAndSnapshot(
    locator: Locator,
    name: string,
    config?: SnapshotConfig
  ): Promise<void> {
    const mergedConfig = { ...this.defaultConfig, ...config };
    
    // 等待元素可见
    await expect(locator).toBeVisible();
    
    // 等待动画稳定
    if (mergedConfig.waitTime) {
      await this.page.waitForTimeout(mergedConfig.waitTime);
    }
    
    // 截图
    await expect(locator).toHaveScreenshot(`${name}.png`, {
      maxDiffPixelRatio: mergedConfig.maxDiffPixelRatio,
      mask: mergedConfig.mask,
    });
  }

  /**
   * 全页面截图
   * @param name 快照名称
   * @param config 可选配置
   */
  async fullPageSnapshot(
    name: string,
    config?: SnapshotConfig
  ): Promise<void> {
    const mergedConfig = { ...this.defaultConfig, ...config };
    
    // 等待页面稳定
    await this.page.waitForLoadState('domcontentloaded');
    if (mergedConfig.waitTime) {
      await this.page.waitForTimeout(mergedConfig.waitTime);
    }
    
    // 截图
    await expect(this.page).toHaveScreenshot(`${name}.png`, {
      maxDiffPixelRatio: mergedConfig.maxDiffPixelRatio,
      fullPage: true,
      mask: mergedConfig.mask,
    });
  }

  /**
   * 组件状态矩阵截图
   * 捕获组件在不同状态下的快照
   * @param component 组件定位器
   * @param states 状态数组
   * @param prefix 快照名前缀
   */
  async captureStateMatrix(
    component: Locator,
    states: ComponentState[],
    prefix: string
  ): Promise<void> {
    for (const state of states) {
      // 设置状态
      await state.setup();
      
      // 等待状态稳定
      await this.page.waitForTimeout(this.defaultConfig.waitTime || 500);
      
      // 检查组件是否可见
      const isVisible = await component.isVisible();
      
      if (isVisible) {
        // 截图
        await expect(component).toHaveScreenshot(`${prefix}-${state.name}.png`, {
          maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
        });
      }
      
      // 清理状态
      if (state.cleanup) {
        await state.cleanup();
      }
    }
  }

  /**
   * 交互前后对比截图
   * @param component 组件定位器
   * @param pair 交互快照对
   */
  async captureInteraction(
    component: Locator,
    pair: InteractionSnapshotPair
  ): Promise<void> {
    // 前状态截图
    await this.page.waitForTimeout(this.defaultConfig.waitTime || 500);
    
    const isVisibleBefore = await component.isVisible();
    if (isVisibleBefore) {
      await expect(component).toHaveScreenshot(`${pair.before}.png`, {
        maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
      });
    } else {
      // 如果组件不可见，截取页面特定区域或跳过
      await expect(this.page).toHaveScreenshot(`${pair.before}.png`, {
        maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
      });
    }
    
    // 执行交互
    await pair.interaction();
    
    // 等待交互完成
    await this.page.waitForTimeout(this.defaultConfig.waitTime || 500);
    
    // 后状态截图
    const isVisibleAfter = await component.isVisible();
    if (isVisibleAfter) {
      await expect(component).toHaveScreenshot(`${pair.after}.png`, {
        maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
      });
    } else {
      await expect(this.page).toHaveScreenshot(`${pair.after}.png`, {
        maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
      });
    }
  }

  /**
   * 批量组件截图
   * @param items 批量截图项
   */
  async batchCapture(items: BatchSnapshotItem[]): Promise<void> {
    for (const item of items) {
      const config = { ...this.defaultConfig, ...item.config };
      
      // 等待元素可见
      const isVisible = await item.locator.isVisible();
      if (!isVisible) {
        console.warn(`Component ${item.name} is not visible, skipping...`);
        continue;
      }
      
      // 等待稳定
      await this.page.waitForTimeout(config.waitTime || 500);
      
      // 截图
      await expect(item.locator).toHaveScreenshot(`${item.name}.png`, {
        maxDiffPixelRatio: config.maxDiffPixelRatio,
        mask: config.mask,
      });
    }
  }

  /**
   * 悬停状态截图
   * @param element 要悬停的元素
   * @param name 快照名称
   */
  async captureHoverState(
    element: Locator,
    name: string
  ): Promise<void> {
    // 悬停
    await element.hover();
    
    // 等待悬停效果
    await this.page.waitForTimeout(200);
    
    // 截图
    await expect(element).toHaveScreenshot(`${name}-hover.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
  }

  /**
   * 聚焦状态截图
   * @param element 要聚焦的元素
   * @param name 快照名称
   */
  async captureFocusState(
    element: Locator,
    name: string
  ): Promise<void> {
    // 聚焦
    await element.focus();
    
    // 等待聚焦效果
    await this.page.waitForTimeout(100);
    
    // 截图
    await expect(element).toHaveScreenshot(`${name}-focus.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
  }

  /**
   * 选中状态截图（用于列表项等）
   * @param element 要选中的元素
   * @param selectAction 选中操作
   * @param name 快照名称
   */
  async captureSelectedState(
    element: Locator,
    selectAction: () => Promise<void>,
    name: string
  ): Promise<void> {
    // 未选中状态
    await expect(element).toHaveScreenshot(`${name}-unselected.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
    
    // 执行选中
    await selectAction();
    await this.page.waitForTimeout(200);
    
    // 选中状态
    await expect(element).toHaveScreenshot(`${name}-selected.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
  }

  /**
   * 展开/折叠状态截图
   * @param container 容器元素
   * @param toggleAction 切换操作
   * @param prefix 快照名前缀
   */
  async captureExpandCollapseState(
    container: Locator,
    toggleAction: () => Promise<void>,
    prefix: string
  ): Promise<void> {
    // 折叠状态
    await this.page.waitForTimeout(300);
    await expect(container).toHaveScreenshot(`${prefix}-collapsed.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
    
    // 切换
    await toggleAction();
    await this.page.waitForTimeout(300);
    
    // 展开状态
    await expect(container).toHaveScreenshot(`${prefix}-expanded.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
  }

  /**
   * 加载状态截图
   * @param container 容器元素
   * @param loadingSelector 加载指示器选择器
   * @param name 快照名称
   */
  async captureLoadingState(
    container: Locator,
    loadingSelector: string,
    name: string
  ): Promise<void> {
    const loadingIndicator = container.locator(loadingSelector);
    
    // 如果能捕获到加载状态
    const isLoading = await loadingIndicator.isVisible({ timeout: 1000 }).catch(() => false);
    if (isLoading) {
      await expect(container).toHaveScreenshot(`${name}-loading.png`, {
        maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
      });
    }
    
    // 等待加载完成
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
    await this.page.waitForTimeout(300);
    
    // 加载完成状态
    await expect(container).toHaveScreenshot(`${name}-loaded.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
  }

  /**
   * 错误状态截图
   * @param container 容器元素
   * @param errorSelector 错误提示选择器
   * @param triggerError 触发错误的操作
   * @param name 快照名称
   */
  async captureErrorState(
    container: Locator,
    errorSelector: string,
    triggerError: () => Promise<void>,
    name: string
  ): Promise<void> {
    // 触发错误
    await triggerError();
    
    // 等待错误提示出现
    const errorElement = container.locator(errorSelector);
    await errorElement.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
    await this.page.waitForTimeout(300);
    
    // 截图
    await expect(container).toHaveScreenshot(`${name}-error.png`, {
      maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
    });
  }

  /**
   * 空状态截图
   * @param container 容器元素
   * @param emptySelector 空状态选择器
   * @param name 快照名称
   */
  async captureEmptyState(
    container: Locator,
    emptySelector: string,
    name: string
  ): Promise<void> {
    const emptyElement = container.locator(emptySelector);
    
    // 检查是否为空状态
    const isEmpty = await emptyElement.isVisible();
    if (isEmpty) {
      await expect(container).toHaveScreenshot(`${name}-empty.png`, {
        maxDiffPixelRatio: this.defaultConfig.maxDiffPixelRatio,
      });
    }
  }
}

export default SnapshotHelper;
