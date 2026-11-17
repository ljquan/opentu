/**
 * With Gradient Fill Plugin
 *
 * 为图形元素支持渐变和图片填充
 * 通过在 afterChange 钩子中修改 SVG DOM 来实现
 */

import { PlaitBoard, PlaitElement, getRectangleByElements } from '@plait/core';
import { isFillConfig, FillConfig } from '../types/fill.types';
import {
  parseFillValue,
  createSVGDefs,
} from '../utils/fill-renderer';
import { isClosedElement } from '../utils/property';

// 存储已处理的元素和它们的填充定义 ID
const processedFillDefs = new WeakMap<PlaitElement, string>();
const elementIndexes = new WeakMap<
  PlaitBoard,
  { children: PlaitElement[]; byId: Map<string, PlaitElement> }
>();

const ELEMENT_GROUP_SELECTOR = 'g[plait-data-id], g[id]';
const readElementId = (element: Element): string | null =>
  element.getAttribute('plait-data-id') || element.getAttribute('id');

const fillObservers = new WeakMap<
  PlaitBoard,
  { host: Element; observer: MutationObserver }
>();

/**
 * 查找元素对应的 SVG 组元素
 * 优先使用 Plait API，回退到 DOM 查询
 */
function findElementG(board: PlaitBoard, element: PlaitElement): SVGGElement | null {
  // 方法 1: 使用 Plait 的 API 获取元素的 G 元素
  try {
    const g = PlaitElement.getElementG(element);
    if (g) return g;
  } catch {
    // 忽略异常，尝试其他方法
  }

  // 方法 2: 通过 element.id 在 DOM 中查找
  if (element?.id) {
    const host = PlaitBoard.getElementHost(board);
    if (host) {
      const g = host.querySelector(`g[plait-data-id="${element.id}"], g[id="${element.id}"]`) as SVGGElement;
      if (g) return g;
    }
  }

  return null;
}

/**
 * 获取元素的填充目标 SVG 元素
 * 对于不同类型的元素，填充应用的目标可能不同
 */
function getFillTargetElement(elementG: SVGGElement): SVGElement | null {
  // 优先查找 path 或 rect 或 ellipse 等形状元素
  const fillTarget = elementG.querySelector('path, rect, ellipse, polygon, circle') as SVGElement;
  return fillTarget;
}

/**
 * 获取或创建 SVG defs 元素
 */
function getOrCreateDefs(svg: SVGSVGElement): SVGDefsElement {
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = createSVGDefs();
    svg.insertBefore(defs, svg.firstChild);
  }
  return defs;
}

/**
 * 清理旧的填充定义
 */
function cleanupOldFillDef(svg: SVGSVGElement, element: PlaitElement): void {
  const oldDefId = processedFillDefs.get(element);
  if (oldDefId) {
    const oldDef = svg.querySelector(`#${oldDefId}`);
    if (oldDef) {
      oldDef.remove();
    }
  }
}

/**
 * 应用填充配置到元素
 * 优化：使用替换而不是删除再添加，避免闪烁
 */
function applyFillConfig(
  board: PlaitBoard,
  element: PlaitElement,
  fillConfig: FillConfig
): void {
  const elementG = findElementG(board, element);
  if (!elementG) return;

  const fillTarget = getFillTargetElement(elementG);
  if (!fillTarget) return;

  const svg = elementG.closest('svg');
  if (!svg) return;

  // 获取元素尺寸
  const rect = getRectangleByElements(board, [element], false);
  const width = rect?.width || 100;
  const height = rect?.height || 100;

  // 解析填充值
  const parsed = parseFillValue(fillConfig, element.id, width, height);

  // 获取 defs 容器
  const defs = getOrCreateDefs(svg);

  // 优化：先设置 fill 引用，再替换/添加定义
  // 这样可以避免"先删除再添加"导致的闪烁
  if (parsed.defElement) {
    const newDefId = parsed.defElement.id;
    const existingDef = defs.querySelector(`#${newDefId}`);
    
    if (existingDef) {
      // 替换现有定义（不会产生闪烁）
      existingDef.replaceWith(parsed.defElement);
    } else {
      // 不存在则添加新定义
      defs.appendChild(parsed.defElement);
    }
    
    // 设置填充引用
    fillTarget.setAttribute('fill', parsed.fillValue);
    processedFillDefs.set(element, newDefId);
    
    // 清理旧的不同 ID 的定义（类型切换时）
    const oldDefId = processedFillDefs.get(element);
    if (oldDefId && oldDefId !== newDefId) {
      const oldDef = defs.querySelector(`#${oldDefId}`);
      if (oldDef) {
        oldDef.remove();
      }
    }
  } else {
    // 纯色填充：直接设置颜色
    fillTarget.setAttribute('fill', parsed.fillValue);
    
    // 清理旧的定义
    cleanupOldFillDef(svg, element);
  }
}

/**
 * 根据元素 ID 查找 board.children 中的元素
 */
function findElementById(board: PlaitBoard, id: string): PlaitElement | null {
  let index = elementIndexes.get(board);
  if (!index || index.children !== board.children) {
    index = {
      children: board.children,
      byId: new Map(board.children.map((element) => [element.id, element])),
    };
    elementIndexes.set(board, index);
  }
  return index.byId.get(id) || null;
}

/**
 * 获取元素的 FillConfig
 * 新的数据结构使用 element.fillConfig，兼容旧的 element.fill
 */
function getElementFillConfig(element: PlaitElement): FillConfig | null {
  // 优先使用新的 fillConfig 属性
  const fillConfig = (element as any).fillConfig as FillConfig | undefined;
  if (fillConfig && isFillConfig(fillConfig)) {
    return fillConfig;
  }
  // 兼容旧数据：element.fill 是 FillConfig 对象的情况
  if (element.fill && isFillConfig(element.fill)) {
    return element.fill;
  }
  return null;
}

/**
 * 检查 fill 属性是否需要修复
 * 如果值是 [object Object] 或者是无效的引用，返回 true
 * 如果元素有渐变/图片 fillConfig 但 fill 是普通颜色，也返回 true
 */
function needsFillFix(fillValue: string | null, element?: PlaitElement | null): boolean {
  if (!fillValue) return false;
  // 检查是否是 [object Object]（对象被错误转换为字符串）
  if (fillValue === '[object Object]') return true;
  // 检查是否是 url(#...) 引用
  if (fillValue.startsWith('url(#')) {
    const match = fillValue.match(/url\(#([^)]+)\)/);
    if (match) {
      const defId = match[1];
      // 如果渐变定义不存在，需要修复
      if (!document.getElementById(defId)) {
        return true;
      }
    }
    // 如果已经是 url(#...) 引用且定义存在，不需要修复
    return false;
  }
  
  // 如果元素有渐变或图片 fillConfig，但当前 fill 是普通颜色值，需要修复
  // 这种情况发生在 Plait 拖动/重新渲染元素时使用了 fallbackColor
  if (element) {
    const fillConfig = getElementFillConfig(element);
    if (fillConfig && (fillConfig.type === 'gradient' || fillConfig.type === 'image')) {
      // 当前 fill 不是 url 引用，说明被重置为了普通颜色
      return true;
    }
  }
  
  return false;
}

/**
 * 处理 DOM 变化，修复被 Plait 重新渲染的元素
 */
function handleDOMMutation(board: PlaitBoard, mutations: MutationRecord[]): void {
  const elementsToFix = new Set<PlaitElement>();

  mutations.forEach((mutation) => {
    // 监听 fill 属性变化
    if (mutation.type === 'attributes' && mutation.attributeName === 'fill') {
      const target = mutation.target as SVGElement;
      const fillValue = target.getAttribute('fill');
      
      // 先找到元素，再检查是否需要修复
      const gElement = target.closest(ELEMENT_GROUP_SELECTOR) as SVGGElement;
      if (gElement) {
        const elementId = readElementId(gElement);
        if (elementId) {
          const element = findElementById(board, elementId);
          const fillConfig = element ? getElementFillConfig(element) : null;
          // 传入 element 以便检查是否有渐变/图片配置
          if (element && fillConfig && isClosedElement(board, element) && needsFillFix(fillValue, element)) {
            elementsToFix.add(element);
          }
        }
      }
    }
    
    // 监听子节点变化（元素被重新渲染）
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof SVGGElement && readElementId(node)) {
          const elementId = readElementId(node);
          if (elementId) {
            const element = findElementById(board, elementId);
            const fillConfig = element ? getElementFillConfig(element) : null;
            if (element && fillConfig && isClosedElement(board, element)) {
              elementsToFix.add(element);
            }
          }
        }
        
        // 也检查添加的子元素（可能是 path 等形状元素）
        if (node instanceof Element) {
          const gElement = node.closest(ELEMENT_GROUP_SELECTOR) as SVGGElement;
          if (gElement) {
            const elementId = readElementId(gElement);
            if (elementId) {
              const element = findElementById(board, elementId);
              const fillConfig = element ? getElementFillConfig(element) : null;
              if (element && fillConfig && isClosedElement(board, element)) {
                elementsToFix.add(element);
              }
            }
          }
        }
      });
    }
  });

  // 立即同步修复
  if (elementsToFix.size > 0) {
    elementsToFix.forEach((element) => {
      const fillConfig = getElementFillConfig(element);
      if (fillConfig) {
        applyFillConfig(board, element, fillConfig);
      }
    });
  }
}

/**
 * 设置 MutationObserver
 * 同步处理 fill 属性变化，避免黑色闪烁
 */
function setupMutationObserver(board: PlaitBoard): boolean {
  const host = PlaitBoard.getElementHost(board);
  if (!host) return false;
  const previous = fillObservers.get(board);
  if (previous?.host === host) return false;
  previous?.observer.disconnect();

  // 使用同步处理，立即修复错误的 fill 值
  const observer = new MutationObserver((mutations) => handleDOMMutation(board, mutations));
  observer.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['fill'],
  });
  fillObservers.set(board, { host, observer });
  return true;
}

/**
 * 扫描并修复所有显示不正确的渐变填充元素
 * 检查 DOM 中的实际 fill 属性，修复错误值
 */
function scanAndFixIncorrectFills(board: PlaitBoard): void {
  const host = PlaitBoard.getElementHost(board);
  if (!host) return;
  
  // 查找所有可能有问题的 fill 属性
  const allFillTargets = host.querySelectorAll('path[fill], rect[fill], ellipse[fill], polygon[fill], circle[fill]');
  
  allFillTargets.forEach((target) => {
    const fillValue = target.getAttribute('fill');
    
    // 先找到元素，再检查是否需要修复
    const gElement = target.closest(ELEMENT_GROUP_SELECTOR) as SVGGElement;
    if (gElement) {
      const elementId = readElementId(gElement);
      if (elementId) {
        const element = findElementById(board, elementId);
        const fillConfig = element ? getElementFillConfig(element) : null;
        // 传入 element 以便检查是否有渐变/图片配置
        if (element && fillConfig && isClosedElement(board, element) && needsFillFix(fillValue, element)) {
          applyFillConfig(board, element, fillConfig);
        }
      }
    }
  });
}

/**
 * 处理所有元素的填充渲染
 * @param board - Plait Board 实例
 * @param immediate - 是否立即同步处理（不使用 requestAnimationFrame）
 */
function processAllFillRendering(
  board: PlaitBoard,
  immediate = false,
  elements = board.children
): void {
  elements.forEach((element) => {
    const fillConfig = getElementFillConfig(element);
    
    // 只处理有 FillConfig 的元素
    if (fillConfig && isClosedElement(board, element)) {
      if (immediate) {
        // 同步处理，用于初始加载
        applyFillConfig(board, element, fillConfig);
      } else {
        // 异步处理，用于变更后的更新
        requestAnimationFrame(() => {
          applyFillConfig(board, element, fillConfig);
        });
      }
    }
  });
  
  // 额外扫描并修复任何显示不正确的元素
  if (immediate && elements === board.children) {
    scanAndFixIncorrectFills(board);
  }
}

// 已设置重试的 board 实例
const retriedBoards = new WeakSet<PlaitBoard>();

/**
 * 预先准备 SVG defs
 * 在渲染之前就创建好渐变定义
 */
function prepareGradientDefs(board: PlaitBoard): void {
  const host = PlaitBoard.getElementHost(board);
  if (!host) return;
  
  const svg = host.closest('svg') || host.querySelector('svg');
  if (!svg) return;
  
  board.children.forEach((element) => {
    const fillConfig = getElementFillConfig(element);
    if (fillConfig && (fillConfig.type === 'gradient' || fillConfig.type === 'image')) {
      if (isClosedElement(board, element)) {
        // 获取元素尺寸
        const rect = getRectangleByElements(board, [element], false);
        const width = rect?.width || 100;
        const height = rect?.height || 100;
        
        // 创建渐变定义
        const parsed = parseFillValue(fillConfig, element.id, width, height);
        
        if (parsed.defElement) {
          const defs = getOrCreateDefs(svg as SVGSVGElement);
          // 检查是否已存在
          const existingDef = defs.querySelector(`#${parsed.defElement.id}`);
          if (!existingDef) {
            defs.appendChild(parsed.defElement);
            processedFillDefs.set(element, parsed.defElement.id);
          }
        }
      }
    }
  });
}

/**
 * 检查需要渐变填充的元素是否都已准备好
 * 返回未准备好的元素数量
 */
function countPendingElements(board: PlaitBoard): number {
  let pending = 0;
  
  board.children.forEach((element) => {
    const fillConfig = getElementFillConfig(element);
    if (fillConfig && (fillConfig.type === 'gradient' || fillConfig.type === 'image')) {
      if (isClosedElement(board, element)) {
        const elementG = findElementG(board, element);
        const fillTarget = elementG ? getFillTargetElement(elementG) : null;
        if (!fillTarget) {
          pending++;
        }
      }
    }
  });
  
  return pending;
}

/**
 * 延迟重试渐变填充应用
 * 解决初始渲染时 DOM 可能未准备好的问题
 * 使用智能重试：检测元素就绪状态，未全部就绪时继续重试
 */
function scheduleRetryFillRendering(board: PlaitBoard): void {
  // 避免重复设置
  if (retriedBoards.has(board)) return;
  retriedBoards.add(board);
  
  // 重试配置：延迟时间和最大重试次数
  const maxRetries = 15;
  const baseDelay = 16;
  let retryCount = 0;
  
  const doRetry = () => {
    retryCount++;
    
    try {
      const host = PlaitBoard.getElementHost(board);
      if (!host) return;
      
      prepareGradientDefs(board);
      processAllFillRendering(board, true);
      
      // 检查是否还有未处理的元素
      const pendingCount = countPendingElements(board);
      
      // 如果还有未准备好的元素且未达到最大重试次数，继续重试
      if (pendingCount > 0 && retryCount < maxRetries) {
        // 使用指数退避策略，但限制最大延迟为 500ms
        const delay = Math.min(baseDelay * Math.pow(1.5, retryCount), 500);
        setTimeout(doRetry, delay);
      }
    } catch {
      // board 可能已经销毁，忽略错误
    }
  };
  
  // 使用 requestAnimationFrame 确保在当前渲染帧之后运行
  // 这比 setTimeout(0) 更可靠，因为它会在浏览器完成当前渲染后执行
  requestAnimationFrame(() => {
    doRetry();
    
    // 额外使用 setTimeout 作为后备，处理可能的边缘情况
    setTimeout(doRetry, 0);
  });
}

/**
 * 插件：支持渐变和图片填充
 * 
 * 工作原理：
 * 1. 数据迁移在 workspace-storage-service 加载阶段已完成
 *    (element.fill 是字符串 fallbackColor，element.fillConfig 是完整配置)
 * 2. Plait 渲染时使用 element.fill 字符串，显示 fallbackColor
 * 3. 本插件在 afterChange 中检测 fillConfig 并应用真正的渐变
 * 4. MutationObserver 监听 DOM 变化，确保动态添加的元素也能正确渲染
 */
export const withGradientFill = (board: PlaitBoard): PlaitBoard => {
  const { afterChange } = board;
  let isFirstRender = true;
  let lastChildren = board.children;

  board.afterChange = () => {
    // 先调用原始的 afterChange
    afterChange();

    // 设置 MutationObserver（只需一次）
    const hostChanged = setupMutationObserver(board);

    const operations = board.operations;
    const onlyTransientChanges = operations.length > 0 && operations.every(
      (operation) => operation.type === 'set_selection' || operation.type === 'set_viewport'
    );
    if (!isFirstRender && !hostChanged && onlyTransientChanges && lastChildren === board.children) {
      return;
    }
    lastChildren = board.children;

    // Node property/size edits only need their own fill reapplied. Structural,
    // theme and snapshot changes retain the full repair path as a fallback.
    if (!isFirstRender && !hostChanged && operations.some((operation) => operation.type === 'set_node') && operations.every(
      (operation) => ['set_node', 'set_selection', 'set_viewport'].includes(operation.type)
    )) {
      const changed = new Set<PlaitElement>();
      for (const operation of operations) {
        if (operation.type === 'set_node') {
          const element = board.children[operation.path[0]];
          if (element) changed.add(element);
        }
      }
      processAllFillRendering(board, true, [...changed]);
      return;
    }
    
    elementIndexes.delete(board);
    // 预先准备渐变定义
    prepareGradientDefs(board);

    // 处理填充渲染
    if (isFirstRender) {
      isFirstRender = false;
      
      // 首次渲染：立即同步处理
      processAllFillRendering(board, true);
      
      // 使用多次延迟重试确保渐变被正确应用
      // 这解决了 DOM 可能在初始 afterChange 时未完全准备好的问题
      scheduleRetryFillRendering(board);
    } else {
      // 后续变更也使用同步处理
      processAllFillRendering(board, true);
    }
  };

  return board;
};
