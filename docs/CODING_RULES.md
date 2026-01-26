# Aitu 编码规则详解

本文档包含项目中积累的具体编码规则和常见错误案例。这是 `CLAUDE.md` 的详细补充，当需要具体的实现指导时参考本文档。

> **注意**：本文档由 CLAUDE.md 拆分而来，包含详细的错误示例和解决方案。基础编码规范请参考 `docs/CODING_STANDARDS.md`。

---

## 目录

- [文件命名规范](#文件命名规范)
- [TypeScript 规范](#typescript-规范)
- [React 组件规范](#react-组件规范)
- [CSS/SCSS 规范](#cssscss-规范)
- [Service Worker 规范](#service-worker-规范)
- [缓存与存储规范](#缓存与存储规范)
- [API 与任务处理规范](#api-与任务处理规范)
- [UI 交互规范](#ui-交互规范)
- [安全规范](#安全规范)
- [E2E 测试规范](#e2e-测试规范)

---


### 文件命名规范
- **组件**: `PascalCase.tsx` (如 `ImageCropPopup.tsx`)
- **Hooks**: `camelCase.ts` (如 `useImageCrop.ts`)
- **工具**: `kebab-case.ts` (如 `image-utils.ts`)
- **类型**: `kebab-case.types.ts` (如 `image-crop.types.ts`)
- **常量**: `UPPER_SNAKE_CASE.ts` (如 `STORAGE_KEYS.ts`)

### TypeScript 规范
- 对象类型使用 `interface`，联合类型使用 `type`
- 所有组件 Props 必须有类型定义
- 避免使用 `any`，使用具体类型或泛型

#### 元组类型 vs 数组类型

**场景**: 当函数参数期望固定长度的元组（如 `[Point, Point]`）时

❌ **错误示例**:
```typescript
// 错误：使用数组类型，TypeScript 无法确定长度
const points: [number, number][] = [
  [x1, y1],
  [x2, y2],
];
// 类型错误：类型"[number, number][]"不能赋给类型"[Point, Point]"
// 目标仅允许 2 个元素，但源中的元素可能不够
createShape(board, points, shapeType);
```

✅ **正确示例**:
```typescript
// 正确：显式声明为元组类型
const points: [[number, number], [number, number]] = [
  [x1, y1],
  [x2, y2],
];
createShape(board, points, shapeType);
```

**原因**: `[T, T][]` 表示"T 的二元组的数组（长度不定）"，而 `[[T, T], [T, T]]` 表示"恰好包含两个 T 二元组的元组"。当 API 期望固定数量的点（如矩形的左上角和右下角）时，必须使用精确的元组类型，否则 TypeScript 无法保证数组长度符合要求。

#### 扩展外部库的枚举类型

**场景**: 需要在外部库的枚举（如 `@plait/common` 的 `StrokeStyle`）基础上添加新值时

❌ **错误示例**:
```typescript
// 错误：直接修改外部库的枚举（无法做到）或使用魔术字符串
import { StrokeStyle } from '@plait/common';

// 无法向 StrokeStyle 添加 'hollow' 值
// 使用字符串字面量会导致类型不兼容
const strokeStyle = 'hollow';  // ❌ 类型不匹配
setStrokeStyle(board, strokeStyle);  // 错误：类型 'string' 不能赋给 StrokeStyle
```

✅ **正确示例**:
```typescript
// 正确：创建扩展类型，同时保持与原始枚举的兼容性
import { StrokeStyle } from '@plait/common';

// 1. 使用联合类型扩展
export type FreehandStrokeStyle = StrokeStyle | 'hollow';

// 2. 创建同名常量对象，合并原始枚举值
export const FreehandStrokeStyle = {
  ...StrokeStyle,
  hollow: 'hollow' as const,
};

// 使用时可以访问所有值
const style1 = FreehandStrokeStyle.solid;   // ✅ 原始值
const style2 = FreehandStrokeStyle.hollow;  // ✅ 扩展值

// 函数参数使用扩展类型
export const setFreehandStrokeStyle = (
  board: PlaitBoard, 
  strokeStyle: FreehandStrokeStyle  // ✅ 接受原始值和扩展值
) => { ... };
```

**原因**: TypeScript 的枚举是封闭的，无法在外部添加新成员。通过 "类型 + 同名常量对象" 模式，可以：1) 保持与原始枚举的完全兼容；2) 类型安全地添加新值；3) 在运行时和编译时都能正确使用。这是扩展第三方库类型的标准模式。

#### Blob 对象的 MIME 类型获取

**场景**: 处理 `File | Blob` 联合类型时获取文件的 MIME 类型

❌ **错误示例**:
```typescript
// 错误：假设只有 File 有 type 属性，Blob 时使用默认值
async function addAsset(file: File | Blob) {
  const mimeType = file instanceof File 
    ? file.type 
    : 'application/octet-stream';  // ❌ 忽略了 Blob.type
  
  // 如果 Blob 是通过 new Blob([data], { type: 'image/png' }) 创建的
  // 这里会错误地返回 'application/octet-stream'
}
```

✅ **正确示例**:
```typescript
// 正确：Blob 也有 type 属性，优先使用
async function addAsset(file: File | Blob) {
  const mimeType = file instanceof File 
    ? file.type 
    : (file.type || 'application/octet-stream');  // ✅ 先检查 Blob.type
}

// 或更简洁的写法（File 继承自 Blob，都有 type）
async function addAsset(file: File | Blob) {
  const mimeType = file.type || 'application/octet-stream';
}
```

**原因**: `Blob` 构造函数支持通过 `options.type` 设置 MIME 类型，如 `new Blob([data], { type: 'image/png' })`。在处理从 ZIP 解压的文件、Canvas 导出的图片等场景时，传入的是带有正确 `type` 的 `Blob` 对象。如果忽略 `Blob.type`，会导致文件类型验证失败。

#### Import 语句必须放在文件顶部

**场景**: 添加新的 import 语句时

❌ **错误示例**:
```typescript
interface MyInterface {
  name: string;
}

const MAX_SIZE = 100;

// 错误：import 在变量声明之后
import { someUtil } from './utils';
```

✅ **正确示例**:
```typescript
import { someUtil } from './utils';

interface MyInterface {
  name: string;
}

const MAX_SIZE = 100;
```

**原因**: ESLint 规则 `import/first` 要求所有 `import` 语句必须放在模块最顶部（JSDoc 注释之后），位于任何变量声明、类型定义或其他代码之前。这样做便于快速了解模块的依赖关系，保持代码结构清晰。

#### 类型可推断时移除显式类型注解

**场景**: 变量直接赋值为字面量时

❌ **错误示例**:
```typescript
// 错误：类型可从字面量推断，显式声明是冗余的
private isEnabled: boolean = false;
private count: number = 0;
private name: string = 'default';
```

✅ **正确示例**:
```typescript
// 正确：让 TypeScript 自动推断类型
private isEnabled = false;
private count = 0;
private name = 'default';

// 注意：联合类型或复杂类型仍需显式声明
private status: 'pending' | 'done' = 'pending';
private config: Config | null = null;
```

**原因**: ESLint 规则 `@typescript-eslint/no-inferrable-types` 要求移除可从初始值推断的冗余类型注解，保持代码简洁。当变量赋值为 `false`、`true`、数字或字符串字面量时，TypeScript 能自动推断类型。

#### Service Worker 与主线程模块不共享

**场景**: 需要在 Service Worker 和主线程中使用相同逻辑时

❌ **错误示例**:
```typescript
// apps/web/src/sw/index.ts
// 错误：SW 中直接导入主线程包
import { sanitizeObject } from '@drawnix/drawnix';
// 会导致打包体积膨胀或循环依赖
```

✅ **正确示例**:
```typescript
// 正确：SW 和主线程各自维护独立模块

// 主线程版本：packages/drawnix/src/utils/sanitize-utils.ts
export function sanitizeObject(data: unknown): unknown { ... }

// SW 版本：apps/web/src/sw/task-queue/utils/sanitize-utils.ts
export function sanitizeObject(obj: unknown): unknown { ... }
```

**原因**: Service Worker 和主线程是完全隔离的执行环境，有各自独立的打包入口。SW 无法直接 import `@drawnix/drawnix` 包，否则会将整个主线程代码打包进 SW，导致体积膨胀。相同逻辑需要在两个环境中分别维护独立的模块副本。

**相关文件**:
- 主线程：`packages/drawnix/src/utils/sanitize-utils.ts`
- Service Worker：`apps/web/src/sw/task-queue/utils/sanitize-utils.ts`

#### Service Worker 枚举值使用小写

**场景**: 读取 SW 任务队列数据（如 `sw-task-queue` 数据库）进行过滤时

❌ **错误示例**:
```typescript
// sw-debug 或其他外部模块读取 SW 数据
const TaskStatus = {
  COMPLETED: 'COMPLETED',  // ❌ 大写
};
const TaskType = {
  IMAGE: 'IMAGE',  // ❌ 大写
  VIDEO: 'VIDEO',
};

// 过滤已完成任务 - 永远匹配不到！
const completedTasks = tasks.filter(
  task => task.status === TaskStatus.COMPLETED  // 实际数据是 'completed'
);
```

✅ **正确示例**:
```typescript
// 正确：使用小写，与 SW 定义保持一致
const TaskStatus = {
  COMPLETED: 'completed',  // ✅ 小写
};
const TaskType = {
  IMAGE: 'image',  // ✅ 小写
  VIDEO: 'video',
};

// 正确匹配
const completedTasks = tasks.filter(
  task => task.status === TaskStatus.COMPLETED
);
```

**原因**: SW 内部的枚举定义使用小写值（见 `apps/web/src/sw/task-queue/types.ts`），读取 SW 数据时必须使用相同的值进行匹配。大小写不一致会导致过滤或比较失败，但不会报错，难以调试。

**相关文件**:
- `apps/web/src/sw/task-queue/types.ts` - SW 枚举定义

#### 共享模块与统一配置模式

**场景**: 多个功能模块有相似逻辑但细节不同时（如宫格图和灵感图的拆分）

❌ **错误示例**:
```typescript
// image-splitter.ts - 重复的去白边逻辑
function splitGrid(imageUrl: string) {
  const borders = trimBorders(imageData, 0.5, 0.15);
  // ...
}

// photo-wall-splitter.ts - 几乎相同的逻辑
function splitPhotoWall(imageUrl: string) {
  const borders = trimBorders(imageData, 0.5, 0.15);
  // ...
}
```

✅ **正确示例**:
```typescript
// image-split-core.ts - 核心模块，统一配置
export type TrimMode = 'strict' | 'normal' | 'none';

export function getTrimParams(trimMode: TrimMode) {
  switch (trimMode) {
    case 'strict': return { borderRatio: 1.0, maxTrimRatio: 0.05 };
    case 'normal': return { borderRatio: 0.95, maxTrimRatio: 0.05 };
    case 'none': return null;
  }
}

// image-splitter.ts - 使用配置区分行为
const trimMode: TrimMode = isStandardGrid ? 'strict' : 'normal';
const params = getTrimParams(trimMode);
if (params) {
  borders = trimBorders(imageData, params.borderRatio, params.maxTrimRatio);
}
```

**原因**:
1. 避免代码重复，便于统一维护
2. 通过配置类型区分行为，而非复制代码
3. 核心模块命名规范：`*-core.ts`（如 `image-split-core.ts`）

**相关文件**:
- `packages/drawnix/src/utils/image-split-core.ts` - 图片拆分核心模块

### React 组件规范
- 使用函数组件和 Hooks
- 使用 `React.memo` 优化重渲染
- 事件处理器使用 `useCallback` 包装
- Hook 顺序：状态 hooks → 副作用 hooks → 事件处理器 → 渲染逻辑

#### useCallback 定义顺序必须在 useEffect 依赖之前

**场景**: 当 `useEffect` 的依赖数组引用某个 `useCallback` 定义的函数时

❌ **错误示例**:
```typescript
// 错误：handleResetView 在 useEffect 依赖中被引用，但定义在 useEffect 之后
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === '0') {
      handleResetView(); // 引用了后面才定义的函数
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [handleResetView]); // ❌ 运行时错误: Cannot access 'handleResetView' before initialization

const handleResetView = useCallback(() => {
  // 重置逻辑
}, []);
```

✅ **正确示例**:
```typescript
// 正确：被依赖的 useCallback 必须在 useEffect 之前定义
const handleResetView = useCallback(() => {
  // 重置逻辑
}, []);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === '0') {
      handleResetView();
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [handleResetView]); // ✅ 正常工作
```

**原因**: JavaScript 的 `const` 声明有暂时性死区（TDZ），在声明语句执行前访问会抛出 `ReferenceError`。`useEffect` 的依赖数组在组件首次渲染时就会被读取，此时如果被依赖的函数还未定义，就会报错。

---

#### Hover 延迟操作需要正确的计时器清理

**场景**: 实现 hover 延迟展开/显示等交互效果时（如工具栏 Popover 延迟展开）

❌ **错误示例**:
```typescript
// 错误：没有清理计时器，可能导致内存泄漏和意外行为
const [open, setOpen] = useState(false);

<div
  onPointerEnter={() => {
    setTimeout(() => setOpen(true), 300);  // 计时器没有被追踪
  }}
>
```

✅ **正确示例**:
```typescript
// 正确：使用 ref 追踪计时器，在离开和卸载时清理
const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const clearHoverTimeout = useCallback(() => {
  if (hoverTimeoutRef.current) {
    clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = null;
  }
}, []);

// 组件卸载时清理
useEffect(() => {
  return () => clearHoverTimeout();
}, [clearHoverTimeout]);

<div
  onPointerEnter={() => {
    clearHoverTimeout();  // 先清除之前的计时器
    hoverTimeoutRef.current = setTimeout(() => setOpen(true), 300);
  }}
  onPointerLeave={() => {
    clearHoverTimeout();  // 离开时取消延迟操作
  }}
  onPointerDown={() => {
    clearHoverTimeout();  // 点击时立即响应，取消延迟
    setOpen(true);
  }}
>
```

**关键点**:
- 使用 `useRef` 存储计时器 ID（不用 state，避免不必要的重渲染）
- `onPointerLeave` 清除计时器（用户离开后取消待执行的操作）
- `onPointerDown` 清除计时器（点击时立即响应，不等待延迟）
- `useEffect` 清理函数确保组件卸载时清除计时器

#### 单击/双击区分场景的计时器清理

**场景**: 使用 `setTimeout` 延迟单击操作以区分单击和双击时

❌ **错误示例**:
```typescript
// 错误：没有在组件卸载时清理计时器
const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

// 单击延迟处理
onClick={() => {
  if (clickTimerRef.current) {
    clearTimeout(clickTimerRef.current);
  }
  clickTimerRef.current = setTimeout(() => {
    handleSingleClick(); // 组件卸载后仍可能执行，导致 state 更新到已卸载组件
  }, 200);
}}

// 双击取消单击
onDoubleClick={() => {
  if (clickTimerRef.current) {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
  }
  handleDoubleClick();
}}
// ⚠️ 缺少 useEffect 清理！
#### 优先使用项目已有的工具函数

**场景**: 需要使用 debounce、throttle 等常见工具函数时

❌ **错误示例**:
```typescript
// 错误：在组件内部自己实现 debounce
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}
```

✅ **正确示例**:
```typescript
const clickTimerRef = useRef<NodeJS.Timeout | null>(null);

// 组件卸载时清理计时器
useEffect(() => {
  return () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  };
}, []);

// 单击延迟处理
onClick={() => {
  if (clickTimerRef.current) {
    clearTimeout(clickTimerRef.current);
  }
  clickTimerRef.current = setTimeout(() => {
    handleSingleClick();
  }, 200);
}}

// 双击取消单击
onDoubleClick={() => {
  if (clickTimerRef.current) {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
  }
  handleDoubleClick();
}}
```

**原因**: 如果用户在计时器等待期间导航离开页面（组件卸载），计时器回调仍会执行，可能导致：
1. 内存泄漏（闭包引用已卸载组件的状态）
2. React 警告："Can't perform a React state update on an unmounted component"
3. stale callback 访问过期的 props/state
// 正确：用项目的 @aitu/utils 包
import { debounce } from '@aitu/utils';
```

**可用的工具函数来源**:
- `@aitu/utils`: `debounce`、`throttle` 等项目共享工具函数

**原因**: 重复实现常见工具函数会增加代码体积，且可能存在边界情况处理不完善的问题。项目已有的工具函数经过测试和优化，应优先使用。

#### 滑块等连续输入控件的更新策略

**场景**: 滑块拖动时触发昂贵操作（如 SVG pattern 重新生成、Canvas 重绘）

❌ **错误示例**:
```typescript
// 错误 1：每次滑块变化都立即触发外部回调，导致频繁重绘和抖动
const handleSliderChange = (value: number) => {
  setConfig({ ...config, scale: value });
  onChange?.({ ...config, scale: value }); // 每次都触发，造成性能问题
};

// 错误 2：使用 debounce（防抖），用户停止拖动后才更新，响应迟钝
const debouncedOnChange = useMemo(
  () => debounce((config) => onChange?.(config), 150),
  [onChange]
);
```

✅ **正确示例**:
```typescript
// 正确：使用 throttle（节流），定时触发更新，平衡响应性和性能
import { throttle } from '@aitu/utils';

// 节流版本的外部回调
const throttledOnChange = useMemo(
  () => throttle((newConfig: Config) => {
    onChange?.(newConfig);
  }, 100), // 100ms 节流
  [onChange]
);

// 滑块专用的更新函数：立即更新 UI，节流触发外部回调
const updateConfigThrottled = useCallback(
  (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);        // 立即更新 UI
    throttledOnChange(newConfig); // 节流触发外部回调
  },
  [config, throttledOnChange]
);

<input
  type="range"
  onChange={(e) => updateConfigThrottled({ scale: Number(e.target.value) })}
/>
```

**关键点**:
- 内部状态 (`setConfig`) 立即更新，保证滑块 UI 的即时响应
- 外部回调 (`onChange`) 使用 `throttle`（节流），减少昂贵操作的执行频率
- **防抖 vs 节流**: 防抖等用户停止操作后才触发（适合搜索框）；节流定时触发（适合滑块）
- 节流时间根据操作开销选择：轻量操作 50-100ms，重量操作（SVG/Canvas）100-200ms
- 使用 `useMemo` 包装 throttle 函数，避免每次渲染创建新实例

#### React Context 回调中必须使用函数式更新

**场景**: 在 Context 提供的回调函数（如 `openDialog`, `closeDialog`）中更新状态时

❌ **错误示例**:
```typescript
// 错误：使用闭包中的 context.appState，可能是过期的引用
const closeDialog = (dialogType: DialogType) => {
  const newOpenDialogTypes = new Set(context.appState.openDialogTypes);
  newOpenDialogTypes.delete(dialogType);
  context.setAppState({
    ...context.appState,  // 闭包中的旧状态！
    openDialogTypes: newOpenDialogTypes,
  });
};

// 问题场景：
// 1. 打开弹窗 A：openDialogTypes = { A }
// 2. 打开弹窗 B：openDialogTypes = { A, B }
// 3. 关闭弹窗 A 时，closeDialog 中的 context.appState 可能仍是 { A }
// 4. 结果：openDialogTypes 变成 {}，弹窗 B 也被关闭了！
```

✅ **正确示例**:
```typescript
// 正确：使用函数式更新，确保始终使用最新的状态
const closeDialog = (dialogType: DialogType) => {
  context.setAppState((prevState) => {
    const newOpenDialogTypes = new Set(prevState.openDialogTypes);
    newOpenDialogTypes.delete(dialogType);
    return {
      ...prevState,
      openDialogTypes: newOpenDialogTypes,
    };
  });
};

// 同样适用于 openDialog
const openDialog = (dialogType: DialogType) => {
  context.setAppState((prevState) => {
    const newOpenDialogTypes = new Set(prevState.openDialogTypes);
    newOpenDialogTypes.add(dialogType);
    return {
      ...prevState,
      openDialogTypes: newOpenDialogTypes,
    };
  });
};
```

**原因**: 
- Context 的回调函数可能被旧的事件处理器或 useCallback 缓存调用
- 闭包中的 `context.appState` 是创建回调时的快照，不是最新状态
- 函数式更新 `setState(prev => ...)` 保证 `prev` 始终是最新状态
- 这个问题在多个弹窗/抽屉同时打开时特别容易出现

#### 模式切换时的状态同步问题

**场景**: 当 UI 组件（如 Toolbar）需要触发模式切换时，直接调用底层的 `setMode` 可能导致相关状态不同步

❌ **错误示例**:
```typescript
// ViewerToolbar.tsx - 直接调用 setMode
<button onClick={() => onModeChange('edit')}>
  编辑
</button>

// UnifiedMediaViewer.tsx - 传递底层 setMode
<ViewerToolbar
  onModeChange={actions.setMode}  // 错误：只改变模式，不设置 editingItem
/>

// 结果：模式变成 'edit'，但 editingItem 仍为 null
// 后续保存时 editingItem 为 null，无法正确覆盖原图
```

✅ **正确示例**:
```typescript
// UnifiedMediaViewer.tsx - 创建包装函数
const handleModeChange = useCallback((newMode: ViewerMode) => {
  if (newMode === 'edit') {
    // 进入编辑模式时，同时设置相关状态
    const currentItem = items[currentIndex];
    if (currentItem && currentItem.type === 'image') {
      updateEditingItem(currentItem);  // 同步更新 editingItem
    }
  }
  actions.setMode(newMode);
}, [items, currentIndex, actions, updateEditingItem]);

<ViewerToolbar
  onModeChange={handleModeChange}  // 正确：使用包装函数
/>
```

**原因**: 
- 当多个状态需要联动更新时，直接暴露底层的单一状态更新函数容易导致状态不一致
- 应该封装成一个函数，确保所有相关状态同步更新
- 这在模式切换、打开/关闭弹窗等场景中尤其重要

#### 传递 React 组件作为 prop 时必须实例化

**场景**: 将 React 组件作为 `icon` 或其他 prop 传递给子组件时

❌ **错误示例**:
```typescript
// 错误：传递组件函数本身，而不是 JSX 实例
import { BackgroundColorIcon } from './icons';

const icon = !hexColor ? BackgroundColorIcon : undefined;

// 子组件中渲染时：
// {icon} → React 警告 "Functions are not valid as a React child"
```

✅ **正确示例**:
```typescript
// 正确：传递 JSX 实例
import { BackgroundColorIcon } from './icons';

const icon = !hexColor ? <BackgroundColorIcon /> : undefined;

// 子组件中渲染时：
// {icon} → 正常渲染
```

**原因**: React 组件本质上是函数，直接将函数作为子元素传递会导致 React 警告。需要调用组件（`<Component />`）生成 JSX 元素后再传递。

#### 内联 style 的 undefined 值会覆盖 CSS 类样式

**场景**: 当需要条件性地应用内联样式，同时使用 CSS 类作为备选样式时

❌ **错误示例**:
```typescript
// 错误：style 对象中的 undefined 值会覆盖 CSS 类的 background
<label
  className={classNames('fill-label', { 'color-mixed': fill === undefined })}
  style={{
    background: fill ? fill : undefined,  // undefined 会覆盖 .color-mixed 的 background
  }}
/>
```

✅ **正确示例**:
```typescript
// 正确：当需要 CSS 类生效时，不传递 style 对象
<label
  className={classNames('fill-label', { 'color-mixed': fill === undefined })}
  style={
    fill === undefined
      ? undefined  // 不设置 style，让 CSS 类的 background 生效
      : { background: fill }
  }
/>
```

**原因**: React 的内联 style 优先级高于 CSS 类。即使 `background: undefined`，React 仍会在元素上设置空的 style 属性，这可能干扰 CSS 类的样式应用。当需要 CSS 类完全控制样式时，应该不传递 style 对象（`style={undefined}`）。

#### 使用 ResizeObserver 实现组件级别的响应式布局

**场景**: 当组件位于可调整大小的侧边栏、抽屉或面板中时，使用基于视口宽度的媒体查询 (`@media`) 无法准确反映组件的实际可用空间。

❌ **错误示例**:
```scss
// 仅依赖视口宽度的媒体查询
@media (max-width: 1200px) {
  .task-item {
    grid-template-areas: "preview prompt" "info info";
  }
}
```

✅ **正确示例**:
```typescript
// TaskItem.tsx
const [isCompactLayout, setIsCompactLayout] = useState(false);
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // 根据组件实际宽度切换布局
      setIsCompactLayout(entry.contentRect.width < 500);
    }
  });

  resizeObserver.observe(container);
  return () => resizeObserver.disconnect();
}, []);

return (
  <div ref={containerRef} className={classNames('task-item', { 'task-item--compact': isCompactLayout })}>
    {/* ... */}
  </div>
);
```

**原因**: 本项目大量使用可拖拽调整宽度的抽屉（如任务队列、聊天侧栏）。组件的布局应取决于其父容器的宽度，而非整个浏览器的宽度。`ResizeObserver` 提供了精确的容器级别响应式控制。

#### 避免在子组件中重写布局样式以保持 Grid 一致性

**场景**: 当多个组件（如 `TaskQueuePanel` 和 `DialogTaskList`）复用同一个基础组件（如 `TaskItem`）时。

❌ **错误示例**:
```scss
// dialog-task-list.scss
.dialog-task-list {
  .task-item {
    // ❌ 错误：在外部强行修改基础组件的布局
    display: flex; 
    flex-direction: row;
    // ... 大量覆盖样式
  }
}
```

✅ **正确示例**:
```scss
// dialog-task-list.scss
.dialog-task-list {
  .task-item {
    // ✅ 正确：只调整尺寸和细节，复用基础组件自带的响应式布局
    padding: 10px;
    &__preview-wrapper { width: 100px; }
  }
}
```

**原因**: 基础组件（如 `TaskItem`）已经包含了完善的响应式 Grid 布局逻辑。在子组件容器中强行覆盖布局（如从 Grid 改为 Flex）会导致维护困难、布局不一致，并破坏基础组件原有的响应式能力。应优先通过微调尺寸或传递 Props 让基础组件自我调整。

### CSS/SCSS 规范
- 使用 BEM 命名规范
- 优先使用设计系统 CSS 变量
- 属性顺序：定位 → 盒模型 → 外观 → 排版 → 动画

#### 使用 box-shadow 替代 border 实现不影响尺寸的边框

**场景**: 当需要边框不影响元素实际尺寸时（如裁剪框、选区框等精确定位场景）

❌ **错误示例**:
```scss
// 边框画在元素内部，会占用元素空间
// 导致可视边界比实际区域大 2px
.crop-area {
  position: absolute;
  border: 2px solid #4f46e5;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);
}
```

✅ **正确示例**:
```scss
// 使用 box-shadow 模拟边框，边框画在元素外部
// 元素内边缘即为实际边界
.crop-area {
  position: absolute;
  // 第一个 shadow 是边框，第二个是遮罩
  box-shadow: 0 0 0 2px #4f46e5, 0 0 0 9999px rgba(0, 0, 0, 0.6);
}
```

**原因**: CSS `border` 默认使用 `box-sizing: content-box`，边框会画在元素边界内部。对于裁剪框等需要精确对应实际区域的场景，使用 `box-shadow: 0 0 0 Npx color` 可以模拟边框，且边框画在元素外部，不影响元素尺寸。

#### 绝对定位子元素需要正确的父容器设置

**场景**: 在容器内添加绝对定位的浮层/预览框等元素时

❌ **错误示例**:
```scss
.container {
  // 缺少 position: relative，子元素的绝对定位相对于更上层的定位元素
  overflow: hidden; // 会裁切溢出的绝对定位子元素
  
  .floating-preview {
    position: absolute;
    right: 100%; // 想要显示在容器左侧
    // 结果：1) 定位参照物可能不对 2) 被 overflow: hidden 裁切掉
  }
}
```

✅ **正确示例**:
```scss
.container {
  position: relative; // 作为绝对定位子元素的参照物
  overflow: visible;  // 允许子元素溢出显示
  
  .floating-preview {
    position: absolute;
    right: 100%; // 正确显示在容器左侧
  }
}
```

**检查清单**:
- 父容器需要 `position: relative`（或其他非 static 的定位）
- 如果子元素需要溢出显示，父容器需要 `overflow: visible`
- 多层嵌套时，确认绝对定位的参照元素是正确的

**原因**: `position: absolute` 的元素相对于最近的非 static 定位祖先元素定位。如果父容器没有设置定位，子元素会相对于更上层的元素定位，导致位置错误。同时 `overflow: hidden` 会裁切超出容器边界的内容，包括绝对定位的子元素。

#### 移动端固定定位元素需要考虑工具栏遮挡

**场景**: 移动端页面底部或顶部的固定定位元素（输入框、提示条等）需要避开左侧工具栏

❌ **错误示例**:
```scss
// 直接居中，没有考虑左侧工具栏
.ai-input-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
}

@media (max-width: 640px) {
  .ai-input-bar {
    // 移动端仍然直接居中，会被工具栏遮挡
    bottom: 16px;
  }
}
```

✅ **正确示例**:
```scss
.ai-input-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
}

@media (max-width: 640px) {
  .ai-input-bar {
    bottom: 16px;
    // 考虑左侧工具栏宽度 (48px)，偏移居中点
    left: calc(50% + 24px); // 工具栏宽度的一半
    max-width: calc(100% - 60px); // 左侧工具栏 + 右侧边距
  }
}
```

**检查清单**:
- 移动端 (`@media max-width: 640px/768px`) 的固定定位元素
- 是否会与左侧 unified-toolbar (48px) 重叠
- 是否会与右上角缩放控件重叠
- 使用 `$toolbar-width` 变量而非硬编码数值

**相关变量**: `$toolbar-width: 48px` (定义在 `styles/_common-variables.scss`)

#### 移动端触控需要 touch 事件实现 hover 效果

**场景**: 桌面端的 hover 预览/提示在移动端没有效果，需要添加 touch 事件支持

❌ **错误示例**:
```tsx
// 只有鼠标事件，移动端触控没有预览效果
<canvas
  onMouseEnter={() => setPreviewVisible(true)}
  onMouseLeave={() => setPreviewVisible(false)}
  onMouseMove={(e) => updatePreviewPosition(e)}
/>
```

✅ **正确示例**:
```tsx
// 添加触控状态追踪
const isTouchingRef = useRef(false);

const handleTouchStart = (e: React.TouchEvent) => {
  isTouchingRef.current = true;
  const touch = e.touches[0];
  updatePreviewPosition(touch.clientX, touch.clientY);
  setPreviewVisible(true);
};

const handleTouchMove = (e: React.TouchEvent) => {
  const touch = e.touches[0];
  updatePreviewPosition(touch.clientX, touch.clientY);
  // 触控移动时始终显示预览
  setPreviewVisible(true);
};

const handleTouchEnd = () => {
  isTouchingRef.current = false;
  // 延迟隐藏，让用户看到最终位置
  setTimeout(() => {
    if (!isTouchingRef.current) {
      setPreviewVisible(false);
    }
  }, 500);
};

<canvas
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
  onMouseMove={handleMouseMove}
  onTouchStart={handleTouchStart}
  onTouchMove={handleTouchMove}
  onTouchEnd={handleTouchEnd}
/>
```

**注意事项**:
- 触控时会同时触发 `pointerdown`，可能导致拖拽状态与预览状态冲突
- 使用 `isTouchingRef` 区分移动端触控和桌面端鼠标拖拽
- 触控结束后延迟隐藏预览，给用户时间查看结果
- Canvas 元素需要设置 `touch-action: none` 防止默认滚动行为

### Git 提交规范
- 格式: `<type>(<scope>): <subject>`
- 类型: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`

### 重要规则
- **UI 框架**: 使用 TDesign React，配置浅色主题
- **Tooltips**: 始终使用 `theme='light'`
- **品牌色一致性**: 覆盖第三方组件（如 TDesign Tag）的默认颜色以符合 AITU 品牌视觉
  - **示例**: 处理中状态使用蓝紫色系 (`#5A4FCF`)
  - **CSS**: `.t-tag--theme-primary { background-color: rgba(90, 79, 207, 0.08); color: #5A4FCF; }`
- **文件大小限制**: 单个文件不超过 500 行
- **文档语言**: 规格文档使用中文
- **概念术语一致性**: 使用 `/docs/CONCEPTS.md` 中定义的标准术语

### TDesign Dropdown 的 popupProps 透传

**场景**: 需要监听 TDesign Dropdown 组件的显示/隐藏状态变化时

❌ **错误示例**:
```tsx
// 错误：Dropdown 没有直接的 onVisibleChange 属性
<Dropdown
  options={options}
  trigger="context-menu"
  onVisibleChange={(visible) => {  // ❌ 类型错误
    setMenuOpen(visible);
  }}
>
  <Button>触发器</Button>
</Dropdown>
```

✅ **正确示例**:
```tsx
// 正确：通过 popupProps 透传给底层 Popup 组件
<Dropdown
  options={options}
  trigger="context-menu"
  popupProps={{
    onVisibleChange: (visible) => {
      setMenuOpen(visible);
    }
  }}
>
  <Button>触发器</Button>
</Dropdown>
```

**原因**: TDesign 的 `Dropdown` 组件没有直接暴露 `onVisibleChange` 属性，需要通过 `popupProps` 透传给底层的 `Popup` 组件。这是 TDesign 的组合式 API 设计，很多底层能力需要通过 `xxxProps` 透传。

### 强制重绘使用 void 前缀

**场景**: 需要触发浏览器强制重绘（reflow）以确保 CSS 变更立即生效时

❌ **错误示例**:
```typescript
// ESLint 报错：Expected an assignment or function call and instead saw an expression
element.offsetHeight;
```

✅ **正确示例**:
```typescript
// 使用 void 运算符明确表示故意丢弃返回值
void element.offsetHeight;
```

**原因**: 读取 `offsetHeight` 属性会触发浏览器回流（reflow），这是一种常见的强制重绘技巧。但 ESLint 会报错因为这是一个"无用"的表达式。添加 `void` 运算符可以：
1. 消除 ESLint 警告
2. 明确表示我们的意图是触发副作用而非使用返回值

**常见使用场景**:
- CSS 动画开始前重置状态
- 确保 transition 属性变更后立即生效
- 在设置初始样式和应用动画样式之间强制重绘

### 项目概念文档维护

**场景**: 添加新功能、新类型或新概念时

**规则**: 项目使用 `/docs/CONCEPTS.md` 作为核心术语和概念的权威定义。添加新功能时应检查并更新概念文档。

**需要更新概念文档的情况**:
- 引入新的类型定义（如新的 TaskType、AssetSource 等）
- 添加新的 React Context
- 创建新的 Service 或核心服务
- 添加新的 MCP 工具
- 引入新的数据流模式
- 添加新的虚拟路径前缀

**概念文档结构**:
- 术语表：中英文对照、定义、关键文件
- 架构分层：应用层、核心库、适配层
- 数据流：AI 生成流程、素材库数据流
- 状态管理：Context 和持久化存储
- 命名规范：文件、变量、事件

**参考**: 查看 `/docs/CONCEPTS.md` 获取完整的术语定义和概念说明

### navigator.storage.estimate() 返回浏览器配额而非磁盘空间

**场景**: 需要获取用户设备存储空间信息时

❌ **错误示例**:
```typescript
// 错误：误以为 quota 是实际磁盘剩余空间
const estimate = await navigator.storage.estimate();
const diskFreeSpace = estimate.quota; // ❌ 这不是磁盘剩余空间！
console.log(`磁盘剩余: ${diskFreeSpace / 1024 / 1024 / 1024} GB`); 
// 可能显示 500+ GB，但实际磁盘只剩 10GB
```

✅ **正确示例**:
```typescript
// 正确理解：quota 是浏览器分配给该站点的配额上限
const estimate = await navigator.storage.estimate();
const usage = estimate.usage || 0;   // 该站点已使用的存储
const quota = estimate.quota || 0;   // 浏览器分配的配额（通常是磁盘空间的某个比例）
const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;

// 只用于判断站点存储使用率，不用于显示磁盘空间
if (usagePercent > 80) {
  console.warn('站点存储使用率较高');
}
```

**原因**: `navigator.storage.estimate()` 返回的 `quota` 是浏览器为该源（origin）分配的存储配额，通常是磁盘可用空间的某个比例（如 50%），而非实际磁盘剩余空间。向用户展示这个值会造成误解。Web API 无法直接获取真实的磁盘剩余空间。

### 异步初始化模式

**场景**: 使用 `settingsManager` 或其他需要异步初始化的服务时

❌ **错误示例**:
```typescript
async initialize(): Promise<boolean> {
  const settings = geminiSettings.get(); // 可能返回加密的 JSON！
  await swTaskQueueClient.initialize({ apiKey: settings.apiKey });
}
```

✅ **正确示例**:
```typescript
async initialize(): Promise<boolean> {
  await settingsManager.waitForInitialization(); // 等待解密完成
  const settings = geminiSettings.get(); // 现在返回解密后的值
  await swTaskQueueClient.initialize({ apiKey: settings.apiKey });
}
```

**原因**: `settingsManager` 使用异步方法 `decryptSensitiveDataForLoading()` 解密敏感数据（如 API Key）。如果在解密完成前调用 `geminiSettings.get()`，会返回加密的 JSON 对象而不是解密后的字符串，导致 API 请求失败。

### 跨层数据转换必须传递所有字段

**场景**: 在主线程和 Service Worker 之间传递数据对象时，需要将内部类型转换为传输格式

❌ **错误示例**:
```typescript
// 错误：转换时漏掉了 options 字段
const swWorkflow = {
  id: legacyWorkflow.id,
  name: legacyWorkflow.name,
  steps: legacyWorkflow.steps.map(step => ({
    id: step.id,
    mcp: step.mcp,
    args: step.args,
    description: step.description,
    status: step.status,
    // 漏掉了 step.options！导致批量信息（batchId 等）丢失
  })),
};
```

✅ **正确示例**:
```typescript
// 正确：显式传递所有字段，包括可选字段
const swWorkflow = {
  id: legacyWorkflow.id,
  name: legacyWorkflow.name,
  steps: legacyWorkflow.steps.map(step => ({
    id: step.id,
    mcp: step.mcp,
    args: step.args,
    description: step.description,
    status: step.status,
    options: step.options,  // 包含 batchId, batchIndex, batchTotal 等
  })),
};
```

**常见遗漏的字段**:
- `options` - 批量参数、执行模式等
- `metadata` - 元数据信息
- `context` - 上下文信息
- 任何 `?:` 可选字段

**原因**: 跨层通信时，如果源类型有可选字段，在转换时很容易遗漏。这会导致功能静默失败（如批量生成只执行第一个），且很难排查。建议在转换函数中显式列出所有字段，或使用 TypeScript 的类型检查确保字段完整。

### Service Worker 初始化时序

**场景**: 提交工作流到 Service Worker 执行前

❌ **错误示例**:
```typescript
// 错误：直接提交工作流，SW 可能还未初始化
const submitToSW = async (workflow) => {
  await workflowSubmissionService.submit(swWorkflow);
  // 如果 SW 的 workflowHandler 未初始化，工作流会被暂存
  // 步骤状态永远停留在 pending（"待开始"）
};
```

✅ **正确示例**:
```typescript
// 正确：先确保 SW 已初始化
const submitToSW = async (workflow) => {
  // 确保 SW 任务队列已初始化（发送 TASK_QUEUE_INIT 消息）
  const { swTaskQueueService } = await import('../services/sw-task-queue-service');
  await swTaskQueueService.initialize();
  
  await workflowSubmissionService.submit(swWorkflow);
};
```

**原因**: Service Worker 的 `workflowHandler` 需要收到 `TASK_QUEUE_INIT` 消息后才会初始化。如果在 SW 初始化前提交工作流，消息会被暂存到 `pendingWorkflowMessages`，等待配置到达。若配置永远不到达（如 `swTaskQueueService.initialize()` 未被调用），工作流就永远不会开始执行，步骤状态保持 `pending`。

### Service Worker 更新提示在开发模式下被跳过

**场景**: 在 localhost 本地测试 Service Worker 更新提示功能

**现象**: 修改代码并构建后，在 localhost 环境下看不到版本更新提示

**原因**: 项目在开发模式下（`localhost` 或 `127.0.0.1`）会自动跳过更新提示，直接激活新的 Service Worker。

```typescript
// apps/web/src/main.tsx 中的逻辑
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
  if (isDevelopment) {
    // 开发模式：直接跳过 waiting，不显示提示
    newWorker.postMessage({ type: 'SKIP_WAITING' });
  } else {
    // 生产模式：显示更新提示
    window.dispatchEvent(new CustomEvent('sw-update-available', { ... }));
  }
}
```

**测试方法**:

1. **在控制台手动触发更新提示（仅测试 UI）**:
```javascript
window.__debugTriggerUpdate('0.5.10')
```

2. **部署到生产环境测试**: 只有在非 localhost 环境下才会显示更新提示

3. **正确的版本升级流程**:
```bash
pnpm run version:patch   # 升级版本号
pnpm run build:web       # 重新构建
# 部署到生产环境后会触发更新提示
```

**注意**: 
- Service Worker 更新检测是基于 `sw.js` 文件内容的字节级比较
- 只修改 `version.json` 不会触发 SW 更新，必须修改 `sw.js` 内容
- 版本号通过 `__APP_VERSION__` 变量注入到 `sw.js` 中

### PostMessage 日志由调试模式完全控制

**场景**: Service Worker 与主线程之间的通讯日志记录

**关键原则**: PostMessage 日志记录必须完全由调试模式控制，避免影响未开启调试模式的应用性能。

✅ **正确实现**:
```typescript
// 1. postmessage-logger.ts 中的日志记录检查
function shouldLogMessage(messageType: string): boolean {
  // 调试模式未启用时，立即返回 false，不进行任何记录操作
  if (!isDebugModeActive()) {
    return false;
  }
  return !EXCLUDED_MESSAGE_TYPES.includes(messageType);
}

// 2. message-bus.ts 中的日志记录
export function sendToClient(client: Client, message: unknown): void {
  // Only attempt to log if debug mode is enabled
  let logId = '';
  if (isPostMessageLoggerDebugMode()) {
    const messageType = (message as { type?: string })?.type || 'unknown';
    logId = logSentMessage(messageType, message, client.id);
  }
  
  client.postMessage(message);
  // ... 仅在调试模式启用时广播日志
}

// 3. Service Worker 中的日志记录
sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  // Log received message only if debug mode is enabled
  let logId = '';
  if (isPostMessageLoggerDebugMode()) {
    logId = logReceivedMessage(messageType, event.data, clientId);
  }
  
  // ... 处理消息
});

// 4. 调试模式切换时的内存清理
export function setPostMessageLoggerDebugMode(enabled: boolean): void {
  const wasEnabled = debugModeEnabled;
  debugModeEnabled = enabled;
  
  if (!enabled && wasEnabled) {
    // 从启用变为禁用时，立即清空日志，释放内存
    logs.length = 0;
    pendingRequests.clear();
  }
}
```

**性能影响**:
- **调试关闭**: 零日志记录开销，零内存占用，应用运行不受影响
- **调试启用**: 完整的日志记录，实时显示在调试面板，可接受的性能开销仅在调试时产生

**相关文件**:
- `docs/SW_DEBUG_POSTMESSAGE_LOGGING.md` - 完整的实现文档
- `apps/web/src/sw/task-queue/postmessage-logger.ts` - 日志记录模块
- `apps/web/src/sw/task-queue/utils/message-bus.ts` - 消息总线模块
- `apps/web/public/sw-debug.html` - 调试面板界面

### 重复提交检测应由 UI 层处理

**场景**: 实现防重复提交功能时

❌ **错误示例**:
```typescript
// 错误：在服务层基于参数哈希进行去重
class TaskQueueService {
  private recentSubmissions: Map<string, number>;

  createTask(params: GenerationParams, type: TaskType): Task {
    const paramsHash = generateParamsHash(params, type);
    
    // 服务层拦截"相同参数"的任务
    if (this.isDuplicateSubmission(paramsHash)) {
      throw new Error('Duplicate submission detected');
    }
    
    this.recentSubmissions.set(paramsHash, Date.now());
    // ... 创建任务
  }

  private isDuplicateSubmission(hash: string): boolean {
    const lastSubmission = this.recentSubmissions.get(hash);
    return lastSubmission && Date.now() - lastSubmission < 5000;
  }
}
```

✅ **正确示例**:
```typescript
// 正确：服务层只检查 taskId 重复（防止同一任务被提交两次）
class TaskQueueService {
  createTask(params: GenerationParams, type: TaskType): Task {
    const taskId = generateTaskId(); // UUID v4，每次不同
    
    if (this.tasks.has(taskId)) {
      console.warn(`Task ${taskId} already exists`);
      return;
    }
    
    // ... 创建任务，不做参数去重
  }
}

// UI 层通过按钮防抖和状态管理处理重复提交
const AIInputBar = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async () => {
    if (isSubmitting) return; // 防止重复点击
    
    setIsSubmitting(true);
    try {
      await taskQueueService.createTask(params, type);
    } finally {
      // 使用冷却时间防止快速连续提交
      setTimeout(() => setIsSubmitting(false), 1000);
    }
  };
};
```

**原因**: 
1. **用户意图不同**: 用户连续提交相同参数可能是故意的（想生成多张相同提示词的图片）
2. **去重规则复杂**: "相同参数"的定义不清晰（图片 base64 是否算相同？时间戳呢？）
3. **职责分离**: 防重复点击是 UI 交互问题，应由 UI 层解决
4. **调试困难**: 服务层拦截导致的错误不易排查，用户不知道为什么提交失败

### API 请求禁止重试

**场景**: 实现 API 调用（图片生成、视频生成、聊天等）时

❌ **错误示例**:
```typescript
// 错误：添加重试逻辑
const maxRetries = 3;
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    const response = await fetch(apiUrl, options);
    if (response.ok) return response.json();
  } catch (error) {
    if (attempt < maxRetries - 1) {
      await sleep(retryDelay);
      continue;
    }
    throw error;
  }
}
```

✅ **正确示例**:
```typescript
// 正确：直接请求，失败则抛出错误
const response = await fetch(apiUrl, options);
if (!response.ok) {
  const error = new Error(`HTTP ${response.status}`);
  throw error;
}
return response.json();
```

**禁止重试的请求类型**:
- AI 生成 API（图片、视频、角色）
- 聊天 API
- 任务队列中的任务执行
- Service Worker 中的 fetch 请求

**原因**: 
1. AI 生成请求成本高（时间和费用），重试会导致重复消耗
2. 失败通常是由于内容策略、配额限制或 API 问题，重试无法解决
3. 用户可以手动重试失败的任务
4. 重试会延长错误反馈时间，影响用户体验

### Plait 选中状态渲染触发

**场景**: 在异步回调（如 `setTimeout`）中使用 `addSelectedElement` 选中元素时

❌ **错误示例**:
```typescript
// 错误：addSelectedElement 只更新 WeakMap 缓存，不触发渲染
setTimeout(() => {
  const element = board.children.find(el => el.id === elementId);
  clearSelectedElement(board);
  addSelectedElement(board, element);  // 选中状态已更新，但 UI 不会刷新
  BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
}, 50);
```

✅ **正确示例**:
```typescript
// 正确：使用 Transforms.setNode 触发 board.apply() 从而触发渲染
setTimeout(() => {
  const elementIndex = board.children.findIndex(el => el.id === elementId);
  const element = elementIndex >= 0 ? board.children[elementIndex] : null;
  if (element) {
    clearSelectedElement(board);
    addSelectedElement(board, element);
    BoardTransforms.updatePointerType(board, PlaitPointerType.selection);
    // 设置临时属性触发渲染，然后立即删除
    Transforms.setNode(board, { _forceRender: Date.now() } as any, [elementIndex]);
    Transforms.setNode(board, { _forceRender: undefined } as any, [elementIndex]);
  }
}, 50);
```

**原因**: Plait 的 `addSelectedElement` 只是将元素存入 `BOARD_TO_SELECTED_ELEMENT` WeakMap 缓存，不会触发任何渲染。在同步流程中（如 `insertElement` 内部），`Transforms.insertNode` 已经触发了 `board.apply()` 和渲染链，所以选中状态能正常显示。但在异步回调中单独调用时，需要手动触发一次 `board.apply()` 来刷新渲染。`Transforms.setNode` 会调用 `board.apply()`，从而触发完整的渲染链。

### 插入元素后选中需通过 ID 查找实际引用

**场景**: 使用 `Transforms.insertNode` 插入元素后，需要选中该元素

❌ **错误示例**:
```typescript
// 错误：直接使用传入的对象调用 addSelectedElement
const newElement = { id: idCreator(), type: 'pen', ... };
Transforms.insertNode(board, newElement, [board.children.length]);

clearSelectedElement(board);
addSelectedElement(board, newElement);  // 可能报错：Unable to find the path for Plait node
```

✅ **正确示例**:
```typescript
// 正确：通过 ID 从 board.children 中查找实际插入的元素
const newElement = { id: idCreator(), type: 'pen', ... };
Transforms.insertNode(board, newElement, [board.children.length]);

// 查找实际插入到 board 中的元素引用
const insertedElement = board.children.find(child => child.id === newElement.id);
if (insertedElement) {
  clearSelectedElement(board);
  addSelectedElement(board, insertedElement);
}
```

**原因**: `Transforms.insertNode` 插入元素时，Plait 可能会对元素进行处理或创建新的引用。`addSelectedElement` 内部会调用 `findPath` 查找元素路径，如果传入的对象引用与 `board.children` 中的不一致，会导致 "Unable to find the path for Plait node" 错误。

### 异步任务幂等性检查应检查存在性而非完成状态

**场景**: 实现防止任务重复执行的检查逻辑时（如页面刷新后恢复任务）

❌ **错误示例**:
```typescript
// 错误：只检查 completed 状态，会导致 in_progress 的任务被重复执行
async checkProcessedRequest(requestId: string): Promise<boolean> {
  const result = await db.get('requests', requestId);
  // 用户刷新页面时，in_progress 的任务会被再次执行！
  if (result && result.status === 'completed' && result.response) {
    return true;
  }
  return false;
}
### Plait API 函数签名注意事项

**场景**: 调用 Plait 的工具函数（如 `getRectangleByElements`）时

❌ **错误示例**:
```typescript
// 错误：漏掉 board 参数，导致 elements.forEach is not a function 错误
const elementRect = getRectangleByElements([element], false);
// getRectangleByElements 的第一个参数是 board，不是 elements！
```

✅ **正确示例**:
```typescript
// 正确：检查任务是否存在，无论状态如何
async checkProcessedRequest(requestId: string): Promise<boolean> {
  const result = await db.get('requests', requestId);
  // 存在即返回 true，防止重复执行
  if (result) {
    return true;
  }
  return false;
}
```

**原因**: 
- 当任务状态为 `in_progress` 时，说明任务已经开始执行
- 如果只检查 `completed` 状态，用户刷新页面后会导致同一任务被重复执行
- 正确的做法是检查任务记录是否存在，存在即视为"已处理"
- 这符合幂等性原则：同一请求多次执行应该得到相同结果

**适用场景**:
- Service Worker 恢复任务
- 页面刷新后的任务续接
- 分布式系统中的请求去重
// 正确：board 作为第一个参数
const elementRect = getRectangleByElements(board, [element], false);
```

**常见的需要 board 参数的 Plait 函数**:
- `getRectangleByElements(board, elements, includePadding)`
- `getSelectedElements(board)`
- `PlaitElement.getElementG(element)` - 注意这个不需要 board

**原因**: Plait 的大多数工具函数需要 board 作为上下文，用于访问视口、缩放比例等信息。漏掉 board 参数会导致运行时错误，且错误信息可能难以理解（如将 elements 数组误认为 board 对象导致的方法调用错误）。

### 禁止自动删除用户数据

**场景**: 添加定时清理、自动裁剪、过期删除等"优化"逻辑时

❌ **错误示例**:
```typescript
// 错误：自动删除超过 24 小时的已完成任务
async restoreFromStorage() {
  // ... 恢复任务
  taskQueueStorage.cleanupOldTasks(); // 会删除素材库依赖的任务数据！
}

// 错误：创建新会话时自动删除旧会话
const createSession = async () => {
  if (sessions.length >= MAX_SESSIONS) {
    await pruneOldSessions(MAX_SESSIONS); // 会删除用户的聊天历史！
  }
};

// 错误：定期清理"过期"的工作流数据
setInterval(() => cleanupOldWorkflows(), 24 * 60 * 60 * 1000);
```

✅ **正确示例**:
```typescript
// 正确：不自动删除任务数据
async restoreFromStorage() {
  // ... 恢复任务
  // NOTE: 不调用 cleanupOldTasks()，任务数据是素材库的数据来源
}

// 正确：不限制会话数量，让用户手动管理
const createSession = async () => {
  const newSession = await chatStorageService.createSession();
  // 不自动删除旧会话，用户可以手动删除
};

// 正确：只清理临时数据，不清理用户数据
setInterval(() => {
  cleanupRecentSubmissions(); // ✅ 清理内存中的去重缓存（临时数据）
  cleanupStaleRequests();     // ✅ 清理过期的请求状态（临时数据）
}, 60000);
```

**可以自动清理的数据**:
- 内存中的临时状态（去重缓存、请求状态、锁）
- 追踪事件缓存（临时数据）
- 存储空间不足时的 LRU 缓存淘汰（用户会收到提示）

**禁止自动清理的数据**:
- 任务数据（素材库依赖）
- 聊天会话和消息
- 工作流数据
- 用户上传的素材
- 项目和画板数据

**原因**: 本项目的素材库通过 `taskQueueService.getTasksByStatus(COMPLETED)` 获取 AI 生成的素材。如果自动删除已完成的任务，素材库就无法展示这些 AI 生成的图片/视频。类似地，聊天历史、工作流数据都是用户的重要数据，不应被自动删除。

### 类服务的 setInterval 必须保存 ID 并提供 destroy 方法

**场景**: 在类（Service、Manager、Client）中使用 `setInterval` 进行定期任务（如清理、监控、心跳）

❌ **错误示例**:
```typescript
class RequestManager {
  constructor() {
    // 错误：没有保存 interval ID，无法清理
    setInterval(() => {
      this.cleanupExpiredRequests();
    }, 60000);
  }
  // 没有 destroy 方法！
}

class DuplexClient {
  private startPerformanceMonitoring(): void {
    // 错误：interval 一旦创建就永远运行
    setInterval(() => {
      this.updatePerformanceMetrics();
    }, 5000);
  }
}
```

✅ **正确示例**:
```typescript
class RequestManager {
  private cleanupTimerId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimerId) {
      clearInterval(this.cleanupTimerId);
    }
    this.cleanupTimerId = setInterval(() => {
      this.cleanupExpiredRequests();
    }, 60000);
  }

  destroy(): void {
    if (this.cleanupTimerId) {
      clearInterval(this.cleanupTimerId);
      this.cleanupTimerId = null;
    }
    // 清理其他资源...
  }
}
```

**检查清单**:
- 每个 `setInterval` 调用都保存返回的 ID 到类成员变量
- 类必须提供 `destroy()` 方法用于清理定时器
- 重复调用启动方法时先清理旧定时器
- 单例模式的类在重新获取实例前也需要清理

**原因**: 类服务通常是单例或长期存在的，但在某些场景下（如热更新、测试、页面切换）需要销毁重建。未清理的 `setInterval` 会导致：
1. 内存泄漏（闭包持有整个类实例）
2. 定时器累积（每次创建新实例都增加一个定时器）
3. 回调执行在已销毁的实例上

### Map/Set 需要清理机制防止无限增长

**场景**: 使用 Map 或 Set 缓存数据（如工作流、请求、会话）

❌ **错误示例**:
```typescript
class WorkflowService {
  private workflows: Map<string, Workflow> = new Map();

  submit(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);
    // 只有 set，没有 delete！
  }

  handleCompleted(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    workflow.status = 'completed';
    // 完成后没有从 Map 中移除，导致无限增长
  }
}
```

✅ **正确示例**:
```typescript
// 清理延迟：完成后保留 5 分钟供查询
const CLEANUP_DELAY = 5 * 60 * 1000;

class WorkflowService {
  private workflows: Map<string, Workflow> = new Map();
  private cleanupTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  handleCompleted(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.status = 'completed';
    }
    // 调度延迟清理
    this.scheduleCleanup(workflowId);
  }

  handleFailed(workflowId: string, error: string): void {
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.status = 'failed';
      workflow.error = error;
    }
    this.scheduleCleanup(workflowId);
  }

  private scheduleCleanup(workflowId: string): void {
    // 清除已有的清理定时器
    const existingTimer = this.cleanupTimers.get(workflowId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.workflows.delete(workflowId);
      this.cleanupTimers.delete(workflowId);
    }, CLEANUP_DELAY);

    this.cleanupTimers.set(workflowId, timer);
  }
}
```

**常见需要清理的 Map/Set**:
- `workflows` - 工作流完成/失败后
- `pendingRequests` - 请求超时或完成后
- `sessions` - 会话过期后
- `subscriptions` - 取消订阅后
- `batches` - 批处理完成后

**原因**: 没有清理机制的 Map/Set 会随着使用不断增长，最终导致内存溢出。即使单个条目很小，长期积累也会消耗大量内存。应该在数据不再需要时（完成、失败、超时、取消）及时清理。

### 不要绕过封装函数直接调用底层 API

**场景**: 项目中有封装好的函数处理额外逻辑（如日志记录、状态追踪、错误处理）

❌ **错误示例**:
```typescript
// 错误：直接调用 postMessage，绕过了日志记录系统
async sendToFocused(message: Message): Promise<boolean> {
  const focusedClient = await this.findFocusedClient();
  if (focusedClient) {
    focusedClient.postMessage(message); // 绕过了 sendToClient 的日志记录
    return true;
  }
  return false;
}
```

✅ **正确示例**:
```typescript
// 正确：使用封装函数，确保日志被记录
async sendToFocused(message: Message): Promise<boolean> {
  const focusedClient = await this.findFocusedClient();
  if (focusedClient) {
    sendToClient(focusedClient, message); // 通过封装函数发送，会记录日志
    return true;
  }
  return false;
}
```

**常见场景**:
- `sendToClient()` vs 直接 `client.postMessage()`
- `fetchWithRetry()` vs 直接 `fetch()`
- `logError()` vs 直接 `console.error()`
- `cacheService.set()` vs 直接 `localStorage.setItem()`

**原因**: 封装函数通常包含重要的附加逻辑（日志记录、错误处理、监控上报等）。直接调用底层 API 会绕过这些逻辑，导致功能不完整或难以调试。在添加新代码时，应检查是否有现成的封装函数可用。

### 页面卸载时必须清理所有定时器资源

**场景**: 页面使用多个 `setInterval` 进行定时任务（如心跳、监控、轮询）

❌ **错误示例**:
```javascript
// 启动多个定时器
const heartbeatTimer = setInterval(sendHeartbeat, 5000);
startMemoryMonitoring(); // 内部也创建了 memoryMonitorInterval

// 卸载时只清理了部分定时器
window.addEventListener('beforeunload', () => {
  clearInterval(heartbeatTimer);
  // 遗漏了 memoryMonitorInterval！
});
```

✅ **正确示例**:
```javascript
// 启动多个定时器
const heartbeatTimer = setInterval(sendHeartbeat, 5000);
startMemoryMonitoring();

// 卸载时清理所有定时器
window.addEventListener('beforeunload', () => {
  clearInterval(heartbeatTimer);
  stopMemoryMonitoring(); // 确保清理所有定时器
});
```

**检查清单**:
- 列出页面中所有的 `setInterval` 调用
- 确保 `beforeunload` 或 `unload` 事件中清理每一个定时器
- 封装在函数中的定时器需要提供对应的 `stop` 函数
- 考虑使用统一的资源管理器来追踪所有需要清理的资源

**原因**: 遗漏的定时器会在页面卸载后继续运行（特别是在 SPA 或 iframe 场景），导致：
1. 资源泄漏（回调函数持有的闭包无法释放）
2. 不必要的 CPU 占用
3. 可能访问已销毁的 DOM 或状态

### 调试日志清理规范

**场景**: 开发功能时添加 `console.log` 调试日志

❌ **错误示例**:
```typescript
// 开发时添加了大量调试日志，提交时忘记删除
function handleClick(event: PointerEvent) {
  console.log('[MyComponent] handleClick:', event);
  console.log('[MyComponent] current state:', state);
  // 业务逻辑...
  console.log('[MyComponent] result:', result);
}
```

✅ **正确示例**:
```typescript
// 1. 提交前删除所有 console.log 或将其注释掉
function handleClick(event: PointerEvent) {
  // 业务逻辑...
}

// 2. 使用分级日志记录高价值调试信息
function complexFunction() {
  // console.info('[System] Initializing component'); // 高级生命周期事件
  // console.debug('[Debug] Trace data:', data);      // 详细数据追踪
  // 业务逻辑...
}
```

**原因**: 调试日志会污染控制台输出，影响生产环境的日志分析，也会增加代码体积。开发时可以自由添加日志，但提交前必须清理。如果某些日志对生产调试有价值，应使用注释形式保留或使用分级的 `console.debug/info` (但需确保不会导致性能问题)。

**Exceptions**:
- `console.error` / `console.warn` 用于记录真正的错误/警告是允许的
- 带有 `[DEBUG]` 前缀且通过环境变量控制的日志可以保留
- 关键系统启动或成功标志日志 (如 `Initialized successfully`) 推荐保留一份但需保持简洁。

### Z-Index 管理规范

**规范文档**: 参考 `docs/Z_INDEX_GUIDE.md` 获取完整规范

**核心原则**:
- 使用预定义的层级常量，禁止硬编码魔术数字
- TypeScript: 从 `constants/z-index.ts` 导入 `Z_INDEX`
- SCSS: 从 `styles/z-index.scss` 导入并使用 `$z-*` 变量或 `z()` 函数

**层级结构** (每层预留100单位):
```
Layer 0 (0-999):     Base & Canvas Internal
Layer 1 (1000-1999): Canvas Elements & Decorations
Layer 2 (2000-2999): Toolbars (unified-toolbar: 2000, popovers: 3000)
Layer 3 (3000-3999): Popovers & Tooltips
Layer 4 (4000-4999): Drawers & Panels (task-queue, chat-drawer)
Layer 5 (5000-5999): Modals & Dialogs (AI dialogs: 5100+)
Layer 6 (6000-6999): Notifications (active-task-warning: 6000)
Layer 7 (7000-7999): Auth Dialogs
Layer 8 (8000-8999): Image Viewer
Layer 9 (9000+):     Critical Overlays (loading, system-error)
```

**使用示例**:
```typescript
// TypeScript/TSX
import { Z_INDEX } from '@/constants/z-index';
<Rnd style={{ zIndex: Z_INDEX.DIALOG_AI_IMAGE }}>
```

```scss
// SCSS
@import 'styles/z-index';
.my-toolbar {
  z-index: $z-unified-toolbar;  // 或 z-index: z('unified-toolbar');
}
```

**禁止事项**:
- ❌ 禁止使用随意的数字 (如 9999, 10000, 10001)
- ❌ 禁止在同一层级随意 +1/-1
- ❌ 临时修复必须在完成后转换为规范用法

### 媒体 URL 处理规范（避免 CSP 和生命周期问题）

**场景**: 需要在画布中引用动态生成的图片/视频（如合并图片、AI 生成结果）

❌ **错误示例 1: 使用 data: URL**
```typescript
// 错误：data: URL 会被 CSP 的 connect-src 阻止 fetch
const dataUrl = canvas.toDataURL('image/png');
DrawTransforms.insertImage(board, { url: dataUrl, ... });
// @plait/core 的 convertImageToBase64 会对所有 URL 发起 fetch
// 生产环境 CSP connect-src 不包含 data: 会报错！
```

❌ **错误示例 2: 使用 blob: URL**
```typescript
// 错误：blob: URL 在页面刷新后失效
const blob = await fetch(imageUrl).then(r => r.blob());
const blobUrl = URL.createObjectURL(blob);
DrawTransforms.insertImage(board, { url: blobUrl, ... });
// 页面刷新后，blob: URL 失效，图片无法显示！
```

✅ **正确示例: 使用虚拟路径 + Service Worker 拦截**
```typescript
// 1. 生成 Blob 并缓存到 Cache API
const blob = await new Promise<Blob>((resolve, reject) => {
  canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Failed')), 'image/png');
});

// 2. 使用虚拟路径 URL（由 Service Worker 拦截返回缓存内容）
const taskId = `merged-image-${Date.now()}`;
const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
const cacheKey = `${location.origin}${stableUrl}`;

// 3. 缓存到 Cache API
await unifiedCacheService.cacheMediaFromBlob(cacheKey, blob, 'image', { taskId });

// 4. 使用虚拟路径插入图片
DrawTransforms.insertImage(board, { url: stableUrl, ... });
```

**虚拟路径规范**:
- 统一前缀: `/__aitu_cache__/`
- 图片路径: `/__aitu_cache__/image/{taskId}.{ext}`
- 视频路径: `/__aitu_cache__/video/{taskId}.{ext}`
- Service Worker 通过路径或扩展名区分类型

**原因**:
1. `data: URL` 被 CSP 的 `connect-src` 阻止（生产环境）
2. `blob: URL` 生命周期与页面绑定，刷新后失效
3. 虚拟路径 + Cache API 持久化，刷新后仍可访问

### 虚拟路径 URL 匹配规范

**场景**: 需要根据素材 URL 查找或删除画布中的元素时（如删除素材时同步删除画布元素）

❌ **错误示例: 使用精确匹配或 startsWith**
```typescript
// 错误：素材 URL 可能是完整 URL，画布元素可能是相对路径
function isCacheUrl(url: string): boolean {
  return url.startsWith('/__aitu_cache__/');  // 无法匹配 http://localhost/__aitu_cache__/...
}

function findElement(assetUrl: string) {
  return board.children.find(el => el.url === assetUrl);  // 精确匹配会失败
}
// 素材 URL: http://localhost:7200/__aitu_cache__/image/xxx.png
// 元素 URL: /__aitu_cache__/image/xxx.png
// 结果：无法匹配！
```

✅ **正确示例: 提取路径部分进行匹配**
```typescript
const CACHE_URL_PREFIX = '/__aitu_cache__/';

// 检查是否为缓存 URL（支持完整 URL 和相对路径）
function isCacheUrl(url: string): boolean {
  return url.includes(CACHE_URL_PREFIX);  // ✅ 使用 includes
}

// 提取缓存路径部分用于匹配
function extractCachePath(url: string): string | null {
  const cacheIndex = url.indexOf(CACHE_URL_PREFIX);
  if (cacheIndex === -1) return null;
  return url.slice(cacheIndex);  // 返回 /__aitu_cache__/... 部分
}

// 匹配时使用路径部分比较
function findElements(assetUrl: string) {
  const targetPath = extractCachePath(assetUrl);
  return board.children.filter(el => {
    const elPath = extractCachePath(el.url);
    return el.url === assetUrl || (targetPath && elPath && targetPath === elPath);
  });
}
```

**原因**:
- 素材存储时可能使用完整 URL（含 origin）
- 画布元素可能使用相对路径（由 Service Worker 拦截）
- 同一资源的两种 URL 形式必须能相互匹配

### Cache API 缓存 key 一致性规范

**场景**: 主线程缓存媒体到 Cache API，Service Worker 需要读取该缓存

❌ **错误示例: 使用 location.origin 拼接完整 URL**
```typescript
// 主线程缓存时
const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
const cacheKey = `${location.origin}${stableUrl}`;  // http://localhost:7200/...
await cache.put(cacheKey, response);

// SW 读取时（代理场景下 origin 不同）
const cacheKey = request.url;  // https://ai-tu.netlify.app/...
const cached = await cache.match(cacheKey);  // ❌ 找不到！
```

✅ **正确示例: 使用相对路径作为缓存 key + 多 key 回退查找**
```typescript
// 主线程缓存时 - 使用相对路径
const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
const cacheKey = stableUrl;  // /__aitu_cache__/image/xxx.png
await cache.put(cacheKey, response);

// SW 读取时 - 优先完整 URL，回退到相对路径
let cachedResponse = await cache.match(request.url);  // 完整 URL
if (!cachedResponse) {
  cachedResponse = await cache.match(url.pathname);   // 相对路径回退
}
```

**原因**:
- 使用 `location.origin` 会在代理场景下导致 key 不一致（本地 vs 线上域名）
- 推荐使用相对路径作为缓存 key，确保一致性
- SW 端采用多 key 回退策略，兼容历史数据和不同场景

### 相对路径 URL 解析规范

**场景**: 需要从 URL 中提取文件扩展名、路径等信息时（如下载文件时确定文件名）

❌ **错误示例: 直接使用 new URL() 解析**
```typescript
// 错误：相对路径无法被 new URL() 解析，会抛异常
function getFileExtension(url: string): string {
  try {
    const urlPath = new URL(url).pathname;  // ❌ 相对路径会抛 TypeError
    const ext = urlPath.substring(urlPath.lastIndexOf('.') + 1);
    return ext;
  } catch {
    return 'bin';  // 回退到错误的扩展名
  }
}

// 下载合并图片时：
// url = '/__aitu_cache__/image/merged-image-xxx.png'
// 结果：下载文件扩展名变成 .bin
```

✅ **正确示例: 先判断是否为相对路径**
```typescript
function getFileExtension(url: string): string {
  try {
    let urlPath: string;
    
    // 相对路径直接使用，不需要 URL 解析
    if (url.startsWith('/') || !url.includes('://')) {
      urlPath = url;
    } else {
      urlPath = new URL(url).pathname;
    }
    
    const lastDotIndex = urlPath.lastIndexOf('.');
    if (lastDotIndex > 0 && lastDotIndex < urlPath.length - 1) {
      return urlPath.substring(lastDotIndex + 1).toLowerCase();
    }
  } catch {
    // URL 解析失败
  }
  return 'bin';
}
```

**原因**:
- `new URL(path)` 要求完整 URL 或提供 base URL，相对路径会抛 `TypeError: Invalid URL`
- 虚拟路径如 `/__aitu_cache__/xxx` 是相对路径，需要特殊处理
- 判断 `startsWith('/')` 或不包含 `://` 可以识别相对路径

### Service Worker 架构设计：避免复杂的往返通信

**场景**: 设计需要 Service Worker 执行的工具或任务时

❌ **错误示例: 复杂的往返通信架构**
```typescript
// 错误：ai_analyze 被设计为需要主线程执行，但内部又通过 SW 发起 chat 请求
// 形成了复杂的往返通信链，页面刷新时容易断链

// 流程：
// 1. 主线程发起工作流 → SW
// 2. SW 发现 ai_analyze 需要主线程执行
// 3. SW → 主线程 (MAIN_THREAD_TOOL_REQUEST)
// 4. 主线程执行 ai_analyze，调用 agentExecutor
// 5. agentExecutor 调用 callApiStreamViaSW
// 6. 主线程 → SW (CHAT_START)  ← 又回到 SW！
// 7. SW 执行 chat，通过 MessageChannel 返回结果
// 8. 主线程收到结果，发送 MAIN_THREAD_TOOL_RESPONSE
// 9. SW 继续工作流

// 问题：刷新页面时，步骤 6-8 的通信链会断裂，导致工作流卡住

export function requiresMainThread(toolName: string): boolean {
  const delegatedTools = [
    'ai_analyze',  // ❌ 内部又调用 SW，不应该委托给主线程
    // ...
  ];
  return delegatedTools.includes(toolName);
}
```

✅ **正确示例: 简化架构，避免往返通信**
```typescript
// 正确：如果操作最终在 SW 中执行，就应该直接在 SW 中实现

// 简化后的流程：
// 1. 主线程发起工作流 → SW
// 2. SW 直接执行 ai_analyze（不委托给主线程）
// 3. SW 内部调用 chat API
// 4. SW 解析结果，添加后续步骤
// 5. SW 继续执行后续步骤

// 在 SW 中注册工具，直接执行
export const swMCPTools: Map<string, SWMCPTool> = new Map([
  ['generate_image', generateImageTool],
  ['generate_video', generateVideoTool],
  ['ai_analyze', aiAnalyzeTool],  // ✅ 直接在 SW 执行
]);

// 从委托列表中移除
export function requiresMainThread(toolName: string): boolean {
  const delegatedTools = [
    'canvas_insert',  // 需要 DOM 操作，必须在主线程
    'insert_mermaid', // 需要渲染，必须在主线程
    // 'ai_analyze' - 不再委托，直接在 SW 执行
  ];
  return delegatedTools.includes(toolName);
}
```

**原因**:
1. 复杂的往返通信增加了故障点，页面刷新时容易断链
2. Service Worker 是独立于页面的后台进程，刷新不影响 SW 执行
3. 如果工具最终依赖 SW 执行（如 chat API），就应该直接在 SW 中实现
4. 只有真正需要 DOM/Canvas 操作的工具才应该委托给主线程

**判断标准**: 工具是否真正需要主线程
- ✅ 需要委托：DOM 操作、Canvas 渲染、获取用户输入
- ❌ 不需要委托：纯 API 调用、数据处理、文件操作

**Service Worker 更新注意**: 修改 SW 代码后需要重新加载才能生效：
1. Chrome DevTools → Application → Service Workers → 点击 "Update"
2. 或关闭所有使用该 SW 的标签页，重新打开

### Service Worker 更新后禁止自动刷新页面

**场景**: Service Worker 更新检测和页面刷新逻辑

❌ **错误示例**:
```typescript
// 错误：收到 SW 更新消息后自动刷新页面
navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data?.type === 'SW_UPDATED') {
    window.location.reload();  // 自动刷新会打断用户操作！
  }
});

navigator.serviceWorker.addEventListener('controllerchange', () => {
  window.location.reload();  // 自动刷新会打断用户操作！
});
```

✅ **正确示例**:
```typescript
// 正确：使用标志位，只有用户确认后才刷新
let userConfirmedUpgrade = false;

// 监听 SW_UPDATED 消息
navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data?.type === 'SW_UPDATED') {
    // 只有用户主动确认升级后才刷新页面
    if (!userConfirmedUpgrade) {
      return;  // 跳过自动刷新
    }
    setTimeout(() => window.location.reload(), 1000);
  }
});

// 监听 controller 变化
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!userConfirmedUpgrade) {
    return;  // 跳过自动刷新
  }
  setTimeout(() => window.location.reload(), 1000);
});

// 监听用户确认升级事件
window.addEventListener('user-confirmed-upgrade', () => {
  userConfirmedUpgrade = true;
  // 触发 SW 跳过等待
  pendingWorker?.postMessage({ type: 'SKIP_WAITING' });
});
```

**原因**: 
- 自动刷新会打断用户正在进行的操作（编辑、生成任务等）
- 用户可能有未保存的工作，强制刷新会导致数据丢失
- 应该显示更新提示，让用户选择合适的时机刷新

**相关文件**:
- `apps/web/src/main.tsx` - Service Worker 注册和更新逻辑
- `components/version-update/version-update-prompt.tsx` - 版本更新提示组件

### 设置保存后需要主动更新 Service Worker 配置

**场景**: 用户在设置面板修改配置（如 API Key、流式请求开关）并保存后

❌ **错误示例**:
```typescript
// 错误：只保存到本地存储，不更新运行中的 SW 配置
const handleSave = async () => {
  geminiSettings.set({
    apiKey,
    baseUrl,
    imageStreamEnabled,  // 新增的配置
  });
  // SW 使用的仍是初始化时的旧配置！
};
```

✅ **正确示例**:
```typescript
// 正确：保存后同时更新 SW 配置
const handleSave = async () => {
  // 1. 保存到本地存储
  geminiSettings.set({
    apiKey,
    baseUrl,
    imageStreamEnabled,
  });

  // 2. 主动推送配置到运行中的 SW
  swTaskQueueClient.updateConfig({
    geminiConfig: {
      apiKey,
      baseUrl,
      imageStreamEnabled,
    },
  });
};
```

**原因**: 
- Service Worker 在初始化时接收配置（通过 `TASK_QUEUE_INIT` 消息）
- 之后 SW 使用内存中的配置，不会重新读取本地存储
- 如果用户修改设置后不调用 `updateConfig()`，SW 继续使用旧配置
- 这会导致用户开启的功能（如流式请求）看似保存成功但实际未生效

**通信协议**:
```typescript
// 主线程 → Service Worker
swTaskQueueClient.updateConfig({
  geminiConfig: { ... },  // 可选
  videoConfig: { ... },   // 可选
});

// SW 内部处理
case 'TASK_QUEUE_UPDATE_CONFIG':
  Object.assign(this.geminiConfig, data.geminiConfig);
  Object.assign(this.videoConfig, data.videoConfig);
  break;
```

### Service Worker 内部处理虚拟路径 URL

**场景**: 在 Service Worker 内部需要获取 `/__aitu_cache__/` 或 `/asset-library/` 等虚拟路径的资源时

❌ **错误示例: 使用 fetch 获取虚拟路径**
```typescript
// 错误：SW 内部的 fetch 不会触发 SW 的 fetch 事件拦截
async function processReferenceImage(url: string) {
  if (url.startsWith('/__aitu_cache__/')) {
    const response = await fetch(url);  // ❌ 这个请求不会被 SW 拦截！
    const blob = await response.blob();  // 会失败或返回 404
    return blobToBase64(blob);
  }
}
```

✅ **正确示例: 直接从 Cache API 获取**
```typescript
// 正确：直接从 Cache API 获取，绕过 fetch
async function processReferenceImage(url: string) {
  if (url.startsWith('/__aitu_cache__/')) {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    // 缓存 key 是完整 URL（包含 origin）
    const cacheKey = `${self.location.origin}${url}`;
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      return blobToBase64(blob);
    }
  }
}
```

**原因**:
- Service Worker 的 fetch 事件只拦截来自页面（客户端）的请求
- SW 内部发起的 fetch 请求不会触发自身的 fetch 事件（避免无限循环）
- 因此必须直接从 Cache API 获取，而不是通过 fetch
- 注意缓存 key 是完整 URL，需要用 `self.location.origin` 构造

### Service Worker 中 opaque 响应的处理

**场景**: 使用 `no-cors` 模式获取外部图片时，会返回 opaque 响应

❌ **错误示例**:
```typescript
// 错误：只检查 status !== 0，会把 opaque 响应当作失败
for (let options of fetchOptions) {
  response = await fetch(currentUrl, options);
  if (response && response.status !== 0) {
    break; // opaque 响应 status === 0，会被跳过！
  }
}

// 错误：尝试读取 opaque 响应的 body
if (response.type === 'opaque') {
  const blob = await response.blob(); // blob 是空的！
  const corsResponse = new Response(blob, { ... }); // 创建的是空响应
  await cache.put(request, corsResponse); // 缓存了空响应
}
```

✅ **正确示例**:
```typescript
// 正确：同时检查 status 和 type
for (let options of fetchOptions) {
  response = await fetch(currentUrl, options);
  // opaque 响应 status === 0 但 type === 'opaque'，应该接受
  if (response && (response.status !== 0 || response.type === 'opaque')) {
    break;
  }
}

// 正确：opaque 响应无法缓存，直接返回给浏览器
if (response.type === 'opaque') {
  // 标记域名，后续请求跳过 SW
  markCorsFailedDomain(hostname);
  // 直接返回，依赖浏览器 disk cache
  return response;
}
```

**原因**:
- `no-cors` 模式返回的 opaque 响应，`status` 始终是 `0`，`type` 是 `'opaque'`
- opaque 响应的 `body` 是安全锁定的，无法读取（返回空 Blob）
- 浏览器可以用 opaque 响应显示图片，但 SW 无法读取或有效缓存
- 对于 CORS 配置错误的服务器，应该依赖浏览器的 disk cache

### Cache API 返回前必须验证响应有效性

**场景**: 从 Cache API 返回缓存的响应时

❌ **错误示例**:
```typescript
// 错误：直接返回缓存，没有验证内容是否有效
const cachedResponse = await cache.match(request);
if (cachedResponse) {
  return cachedResponse; // 可能是之前错误缓存的空响应！
}
```

✅ **正确示例**:
```typescript
const cachedResponse = await cache.match(request);
if (cachedResponse) {
  const responseClone = cachedResponse.clone();
  const blob = await responseClone.blob();
  
  // 检查 blob 是否为空
  if (blob.size === 0) {
    console.warn('检测到空缓存，删除并重新获取');
    await cache.delete(request);
    // 继续执行网络请求逻辑...
  } else {
    // 缓存有效，返回响应
    return cachedResponse;
  }
}
```

**原因**:
- 之前的代码 bug（如尝试缓存 opaque 响应的空 body）可能导致空响应被缓存
- 返回空响应会导致图片无法显示，用户体验差
- 在返回前验证 `blob.size > 0` 可以自动修复历史问题
- 删除无效缓存后重新获取，确保用户看到正确的内容

### Cache.put() 会消费 Response body，无法重复使用

**场景**: 需要将同一个 Response 对象缓存到多个不同的 key 时

❌ **错误示例**:
```typescript
// 错误：Cache.put() 会消费 Response 的 body，后续无法 clone
const response = new Response(blob, {
  headers: { 'Content-Type': 'image/jpeg' },
});

// 第一次 put 消费了 body
await thumbCache.put(cacheKey1, response);

// 第二次 clone 会失败：Response body is already used
await thumbCache.put(cacheKey2, response.clone()); // ❌ TypeError
```

✅ **正确示例**:
```typescript
// 正确：为每个缓存 key 创建独立的 Response 对象
const createResponse = () => new Response(blob, {
  headers: { 'Content-Type': 'image/jpeg' },
});

// 每个 put 使用独立的 Response 对象
await thumbCache.put(cacheKey1, createResponse());
await thumbCache.put(cacheKey2, createResponse());
await thumbCache.put(cacheKey3, createResponse());
```

**原因**:
- `Cache.put()` 方法会读取并消费 Response 的 body stream
- 一旦 body 被消费，就无法再次读取或 clone
- Response 对象本身很轻量（只是包装 Blob），为每个 key 创建新对象是安全的
- 使用工厂函数 `createResponse()` 可以方便地创建多个独立实例

### fetchOptions 优先级：优先尝试可缓存的模式

**场景**: 在 Service Worker 中获取外部图片时，需要尝试多种 fetch 模式

❌ **错误示例**:
```typescript
// 错误：no-cors 模式优先，会导致 opaque 响应无法缓存
let fetchOptions = [
  { mode: 'no-cors' },  // ❌ 优先尝试，但无法缓存
  { mode: 'cors' },     // 可缓存，但优先级低
];
```

✅ **正确示例**:
```typescript
// 正确：优先尝试 cors 模式（可缓存），最后才尝试 no-cors
let fetchOptions = [
  { mode: 'cors' },     // ✅ 优先尝试，可以缓存
  { mode: 'no-cors' },  // 最后备选，无法缓存但可以绕过 CORS
];
```

**原因**:
- `cors` 模式返回的响应可以被 Service Worker 读取和缓存
- `no-cors` 模式返回的 `opaque` 响应无法读取 body，无法有效缓存
- 优先尝试可缓存的模式可以提高后续请求的命中率
- 只有在 cors 模式失败时才降级到 no-cors 模式

### CDN 响应必须多重验证后才能缓存

**场景**: Service Worker 从 CDN 获取静态资源并缓存时

❌ **错误示例**:
```typescript
// 错误：只检查 response.ok，可能缓存 CDN 返回的 HTML 错误页面
const response = await fetch(cdnUrl);
if (response.ok) {
  cache.put(request, response.clone());
  return response; // 可能是 404 页面被当作 JS 执行！
}
```

✅ **正确示例**:
```typescript
const response = await fetch(cdnUrl);
if (response.ok) {
  // 1. Content-Type 验证
  const contentType = response.headers.get('Content-Type') || '';
  const isValidType = contentType.includes('javascript') || 
                      contentType.includes('css') || 
                      contentType.includes('json');
  if (!isValidType) continue; // 尝试下一个源
  
  // 2. Content-Length 验证（排除空响应）
  const length = parseInt(response.headers.get('Content-Length') || '0', 10);
  if (length > 0 && length < 50) continue;
  
  // 3. 内容采样验证（检测 HTML 错误页面）
  const sample = await response.clone().text().then(t => t.slice(0, 200));
  if (sample.includes('<!DOCTYPE') || sample.includes('Not Found')) {
    continue; // CDN 返回了 HTML 错误页面
  }
  
  cache.put(request, response.clone());
  return response;
}
```

**原因**:
- CDN 可能返回 404 但 HTTP 状态码仍是 200（某些 CDN 的行为）
- npm 包不存在时，CDN 返回 HTML 错误页面
- 错误页面被当作 JS 执行会导致 React 多实例冲突，应用崩溃
- 多重验证确保只缓存真正有效的资源

### CDN 请求应设置短超时快速回退

**场景**: Service Worker 实现 CDN 优先加载策略时

❌ **错误示例**:
```typescript
// 错误：超时太长，CDN 回源慢时用户等待时间过长
const CDN_CONFIG = {
  fetchTimeout: 10000, // 10 秒超时
};
```

✅ **正确示例**:
```typescript
// 正确：短超时，CDN 缓存命中很快（<200ms），超时说明在回源
const CDN_CONFIG = {
  fetchTimeout: 1500, // 1.5 秒超时，快速回退到服务器
};
```

**原因**:
- CDN 缓存命中通常 < 200ms，1.5s 足够
- CDN 回源（首次请求）可能需要 3-5 秒，等待太久影响用户体验
- 短超时后快速回退到服务器，保证首次加载速度
- 用户请求会触发 CDN 缓存，后续访问自动加速

### Service Worker 静态资源回退应尝试所有版本缓存

**场景**: 用户使用旧版本 HTML，但服务器已部署新版本删除了旧静态资源

❌ **错误示例**:
```typescript
// 错误：只尝试当前版本缓存，服务器 404 时直接返回错误
const cachedResponse = await cache.match(request);
if (cachedResponse) {
  return cachedResponse;
}

const response = await fetch(request);
if (!response.ok) {
  return new Response('Not found', { status: 404 });
}
```

✅ **正确示例**:
```typescript
// 正确：服务器返回 4xx/5xx 或 HTML 回退时，尝试所有版本缓存
const response = await fetch(request);

// 检测服务器返回 HTML 错误页面（SPA 404 回退）
const contentType = response.headers.get('Content-Type');
const isHtmlFallback = response.ok && contentType?.includes('text/html') && 
  request.destination === 'script';

// 服务器错误或 HTML 回退时，尝试旧版本缓存
if (response.status >= 400 || isHtmlFallback) {
  const allCacheNames = await caches.keys();
  for (const cacheName of allCacheNames) {
    if (cacheName.startsWith('drawnix-static-v')) {
      const oldCache = await caches.open(cacheName);
      const oldResponse = await oldCache.match(request);
      if (oldResponse) {
        console.log(`Found resource in ${cacheName}`);
        return oldResponse;
      }
    }
  }
}
```

**原因**:
- 用户可能缓存了旧版本 HTML，但新部署删除了旧静态资源
- 旧 HTML 请求旧资源，服务器返回 404 或 HTML 错误页面
- 尝试旧版本缓存可以找到用户需要的资源，避免白屏
- 这是 PWA 的重要容错机制，确保版本升级平滑过渡

### 图像处理工具复用规范

**场景**: 需要对图片进行边框检测、去白边、裁剪等处理时

**核心工具文件**: `utils/image-border-utils.ts`

**可用的公共方法**:

| 方法 | 用途 | 返回值 |
|------|------|--------|
| `trimCanvasWhiteAndTransparentBorder` | 去除 Canvas 白边和透明边 | `HTMLCanvasElement` |
| `trimCanvasWhiteAndTransparentBorderWithInfo` | 去除边框并返回偏移信息 | `{ canvas, left, top, trimmedWidth, trimmedHeight, wasTrimmed }` |
| `trimImageWhiteAndTransparentBorder` | 去除图片 URL 的白边 | `Promise<string>` (data URL) |
| `trimCanvasBorders` | 去除 Canvas 边框（灰色+白色） | `HTMLCanvasElement \| null` |
| `removeWhiteBorder` | 去除图片白边（激进模式） | `Promise<string>` |

❌ **错误示例**:
```typescript
// 错误：在组件中重复实现去白边逻辑
const trimWhiteBorder = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // ... 50+ 行重复代码
};
```

✅ **正确示例**:
```typescript
// 正确：使用公共工具方法
import { 
  trimCanvasWhiteAndTransparentBorder,
  trimCanvasWhiteAndTransparentBorderWithInfo,
  trimImageWhiteAndTransparentBorder 
} from '../utils/image-border-utils';

// 只需要裁剪后的 Canvas
const trimmedCanvas = trimCanvasWhiteAndTransparentBorder(canvas);

// 需要知道裁剪偏移量（如计算插入位置）
const { canvas: trimmedCanvas, left, top } = trimCanvasWhiteAndTransparentBorderWithInfo(canvas);

// 处理图片 URL
const trimmedUrl = await trimImageWhiteAndTransparentBorder(imageDataUrl);
```

**使用场景**:
- 合并图片后去白边 → `trimCanvasWhiteAndTransparentBorderWithInfo`（需要偏移量）
- 生成预览图去白边 → `trimImageWhiteAndTransparentBorder`（异步处理 URL）
- 图片分割时去边框 → `trimCanvasBorders`（检测灰色+白色）

**原因**: 图像处理逻辑（像素遍历、边界检测）容易出错且代码量大。使用统一的公共方法可以：
1. 避免重复代码
2. 确保一致的处理行为
3. 便于统一优化和修复 bug

### SSH 远程执行复杂 Shell 命令应使用 base64 编码

**场景**: 通过 SSH 在远程服务器执行包含引号、变量替换等复杂 shell 脚本时

❌ **错误示例**:
```javascript
// 错误：多层引号转义导致 shell 语法错误
const remoteCommand = `bash -c '
  VERSION=$(tar -xzf ${uploadsDir}/${tarName} -O web/version.json 2>/dev/null | grep '"'"'"version"'"'"' | sed '"'"'s/.*"version": "\\([^"]*\\)".*/\1/'"'"')
  if [ -z "$VERSION" ]; then
    echo "无法读取版本号"
    exit 1
  fi
  // ... 更多命令
'`;
// 错误：/bin/sh: -c: line 1: unexpected EOF while looking for matching `)'
```

✅ **正确示例**:
```javascript
// 正确：使用 base64 编码避免引号转义问题
const extractScript = `VERSION=$(tar -xzf ${uploadsDir}/${tarName} -O web/version.json 2>/dev/null | grep '"version"' | sed 's/.*"version": "\\([^"]*\\)".*/\\1/')
if [ -z "$VERSION" ]; then
  echo "无法读取版本号"
  exit 1
fi
// ... 更多命令`;

// 将脚本编码为 base64，避免引号转义问题
const encodedScript = Buffer.from(extractScript).toString('base64');
const remoteCommand = `echo ${encodedScript} | base64 -d | bash`;

sshCommand += ` ${config.DEPLOY_USER}@${config.DEPLOY_HOST} "${remoteCommand}"`;
```

**原因**: 
- SSH 命令需要经过多层引号转义（Node.js 字符串 → SSH 命令 → shell 执行），复杂的引号嵌套容易导致语法错误
- base64 编码将脚本转换为纯 ASCII 字符串，避免了所有引号转义问题
- 远程服务器通过 `base64 -d` 解码后执行，保持脚本原始格式

**适用场景**:
- 通过 SSH 执行多行 shell 脚本
- 脚本中包含引号、变量替换、管道等复杂语法
- 需要避免引号转义导致的语法错误

### 验证命令

修改代码后必须执行以下验证命令：

```bash
# 类型检查 (以 drawnix 为例)
cd packages/drawnix && npx tsc --noEmit
# 代码规范
pnpm nx lint drawnix
# 单元测试
pnpm nx test drawnix
# 构建验证
pnpm run build
```

### CSS !important 覆盖 JavaScript 动态样式

**场景**: 需要通过 JavaScript 动态设置元素样式（如光标、颜色、尺寸），但 CSS 中存在 `!important` 规则

❌ **错误示例**:
```scss
// SCSS 中使用 !important 固定光标样式
.plait-board-container {
  &.pointer-eraser {
    .board-host-svg {
      cursor: url('data:image/svg+xml;base64,...') 10 10, crosshair !important;
    }
  }
}
```
```typescript
// JavaScript 动态设置光标被 CSS !important 覆盖，无效
function applyCursorStyle(board: PlaitBoard, size: number) {
  const hostSvg = document.querySelector('.board-host-svg');
  hostSvg.style.cursor = generateCursorSvg(size); // 被 !important 覆盖！
}
```

✅ **正确示例**:
```scss
// SCSS 中不使用 !important，或完全移除静态规则
.plait-board-container {
  // 光标由 JavaScript 动态设置（usePencilCursor hook）
  // 不再使用固定大小的 CSS 光标
}
```
```typescript
// JavaScript 动态设置光标正常生效
function applyCursorStyle(board: PlaitBoard, size: number) {
  const hostSvg = document.querySelector('.board-host-svg');
  hostSvg.style.cursor = generateCursorSvg(size); // 正常生效
}
```

**原因**: CSS 的 `!important` 规则优先级高于 JavaScript 设置的内联样式。当需要动态控制样式时（如根据用户设置调整光标大小），必须移除 CSS 中的 `!important` 规则，否则 JavaScript 的样式设置会被完全覆盖。

**检查方法**: 如果 JavaScript 设置的样式不生效，在浏览器开发者工具中检查元素样式，查看是否有 `!important` 规则覆盖。

### Freehand 元素属性设置需要自定义 callback

**场景**: 修改 Freehand（手绘线条）元素的属性（如 strokeStyle、strokeColor）时

❌ **错误示例**:
```typescript
// 错误：直接使用 PropertyTransforms，Freehand 元素可能不被正确处理
const setStrokeStyle = (style: StrokeStyle) => {
  PropertyTransforms.setStrokeStyle(board, style, { getMemorizeKey });
};
```

✅ **正确示例**:
```typescript
// 正确：使用 callback 确保所有选中元素都被处理
export const setStrokeStyle = (board: PlaitBoard, strokeStyle: StrokeStyle) => {
  PropertyTransforms.setStrokeStyle(board, strokeStyle, {
    getMemorizeKey,
    callback: (element: PlaitElement, path: Path) => {
      Transforms.setNode(board, { strokeStyle }, path);
    },
  });
};
```

**原因**: `PropertyTransforms` 的默认行为可能不会处理所有类型的元素（如自定义的 Freehand 元素）。通过提供 `callback` 函数，可以确保对所有选中的元素执行属性设置操作。颜色设置（`setStrokeColor`、`setFillColor`）也使用了相同的模式。

### 错误 3: 第三方窗口/弹窗组件破坏 React 事件委托

**场景**: 使用 `WinBox.js` 或其他直接操作 DOM 的第三方窗口库包装 React 组件时

❌ **错误示例**:
```typescript
// 错误：使用 mount 选项将 React 渲染的 DOM 移动到外部，会破坏 React 的事件冒泡链
new WinBox({
  mount: containerRef.current, // 导致 onClick/onDoubleClick 无响应
  // ...
});
```

✅ **正确示例**:
```typescript
// 正确：使用 React.createPortal 将内容渲染到第三方组件提供的 DOM 容器中
const WinBoxWindow = ({ children }) => {
  const [contentRef, setContentRef] = useState<HTMLElement | null>(null);
  
  useEffect(() => {
    const winbox = new WinBox({
      oncreate: () => {
        setContentRef(winbox.body); // 获取 WinBox 提供的容器
      }
    });
  }, []);

  return contentRef ? createPortal(children, contentRef) : null;
};
```

**原因**: React 使用事件委托机制在 `root` 节点监听事件。如果第三方库通过 `appendChild` 等原生 API 将 DOM 节点移出 React 的 root 树，事件将无法正常冒泡到 React 的监听器。`createPortal` 允许在物理上移动 DOM 的同时，在逻辑上保持 React 的组件树和事件流完整。

### 错误 4: 筛选逻辑中“全部”选项处理不当

**场景**: 实现带有“全部（ALL）”选项的多重过滤逻辑时

❌ **错误示例**:
```typescript
// 错误：未处理 undefined 情况，导致多条件组合时结果意外为空
const matchesType = filters.activeType === 'ALL' || asset.type === filters.activeType;
// 如果 activeType 是 undefined (初始状态)，(undefined === 'ALL') 为 false，逻辑失效
```

✅ **正确示例**:
```typescript
// 正确：显式处理 undefined 和 'ALL'，确保逻辑鲁棒
const matchesType = 
  !filters.activeType || 
  filters.activeType === 'ALL' || 
  asset.type === filters.activeType;
```

**原因**: 初始状态或重置状态下，筛选变量可能是 `undefined` 或 `null`。在进行比较前必须先进行存在性检查，否则会导致筛选结果不符合预期（通常表现为只有单独筛选有效，组合筛选失效）。

### 错误 5: 动态缩放网格布局出现间隙或重叠

**场景**: 实现支持用户调整元素显示尺寸（放大/缩小）的网格列表时

❌ **错误示例**:
```scss
// 错误：使用 Flex 布局配合动态计算的百分比宽度，容易产生像素计算偏差
.grid-row {
  display: flex;
  .item {
    width: 18.523%; // 计算出的宽度，容易在右侧留下缝隙
  }
}
```

✅ **正确示例**:
```scss
// 正确：使用 CSS Grid 布局配合 1fr，确保完美平铺和对齐
.grid-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); // 或动态设置列数
  gap: 16px;
  .item {
    width: 100%;
    height: 100%;
  }
}
```

**原因**: Flex 布局在处理非整数像素的列宽时，浏览器舍入误差会导致右侧出现白边或元素重叠。CSS Grid 的 `1fr` 单元由浏览器底层引擎处理自动分配，能确保每一列都精准对齐容器边界，尤其适合需要频繁变动尺寸的素材预览场景。

### 错误 6: UI 元素高度不统一导致视觉错位

**场景**: 搜索框、按钮、已选计数条等多个组件并排排列时

❌ **错误示例**:
```scss
.search-input { height: 36px; }
.action-button { height: 32px; }
// 导致并排排列时基准线不齐，视觉凌乱
```

✅ **正确示例**:
```scss
// 正确：统一锁定核心高度（如 32px），并在组件库样式上使用 !important 覆盖
.t-input { height: 32px !important; }
.t-button { height: 32px !important; }
.counter-tag { height: 32px; display: flex; align-items: center; }
```

**原因**: “素雅”和“专业”感来自于严格的视觉对齐。在紧凑的工具栏布局中，即便只有 2-4px 的高度差也会被用户感知。应选定一个标准高度并强制执行，消除视觉噪音。

### 错误 7: 后台清理任务过度记录日志

**场景**: Service Worker 或后台定时器定期清理过期日志、缓存或任务时

❌ **错误示例**:
```typescript
// 错误：逐条记录清理项，导致控制台瞬间被淹没
expiredLogs.forEach(log => console.log(`Deleted expired log: ${log.id}`));
```

✅ **正确示例**:
```typescript
// 正确：仅记录清理结果摘要
if (deletedCount > 0) {
  // console.log(`Service Worker: 清理了 ${deletedCount} 条过期控制台日志`);
}
```

**原因**: 后台任务通常是用户无感知的，过度记录调试信息会干扰正常开发。应汇总结果并优先使用分级日志（推荐注释掉或仅在调试模式显示）。

### 错误 8: 点击外部关闭下拉菜单使用透明遮罩层

**场景**: 实现自定义下拉菜单、弹出面板等需要"点击外部关闭"功能时

❌ **错误示例**:
```tsx
// 错误：使用透明遮罩层检测点击，在复杂 z-index 场景下会失效
{isOpen && (
  <>
    <div 
      className="dropdown-overlay"  // position: fixed; z-index: 999
      onClick={() => setIsOpen(false)}
    />
    <div className="dropdown-menu" style={{ zIndex: 1000 }}>
      {/* 菜单内容 */}
    </div>
  </>
)}
// 问题：页面上其他高 z-index 元素（工具栏、弹窗等）会遮挡遮罩层，
// 导致点击这些区域无法触发关闭
```

✅ **正确示例**:
```tsx
// 正确：使用全局 document 事件监听，不受 z-index 影响
useEffect(() => {
  if (!isOpen) return;

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // 检查点击是否在下拉组件内部
    if (target.closest('.dropdown-menu')) return;
    // 点击在外部，关闭下拉
    setIsOpen(false);
  };

  // 使用 mousedown 响应更快
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [isOpen]);

// 组件只渲染下拉菜单，无需遮罩层
{isOpen && (
  <div className="dropdown-menu">
    {/* 菜单内容 */}
  </div>
)}
```

**原因**: 透明遮罩层方案依赖正确的 z-index 层级，在有多个浮层组件的复杂页面中容易失效。全局 document 事件监听在事件捕获阶段工作，不受 DOM 层级和 z-index 影响，是更可靠的方案。同时代码也更简洁，无需维护额外的遮罩层元素和样式。

### 错误 9: 传递给第三方库的回调无法获取最新 React state

**场景**: 将 `useCallback` 创建的回调函数传递给第三方库（如 WinBox 的 `addControl`、图表库的事件处理器等）时

❌ **错误示例**:
```tsx
// 错误：回调中直接使用 state，第三方库保存的是旧回调引用
const [splitSide, setSplitSide] = useState<'left' | 'right' | null>(null);

const handleSplit = useCallback(() => {
  // splitSide 永远是创建回调时的值（通常是初始值 null）
  if (splitSide === 'right') {
    doSomething(); // 永远不会执行！
  }
}, [splitSide]); // 即使加了依赖，第三方库保存的仍是旧回调

useEffect(() => {
  winbox.addControl({ click: handleSplit }); // WinBox 保存了这个引用
}, []);
```

✅ **正确示例**:
```tsx
// 正确：使用 ref 保存状态，回调中读取 ref.current 获取最新值
const [splitSide, _setSplitSide] = useState<'left' | 'right' | null>(null);
const splitSideRef = useRef<'left' | 'right' | null>(null);

// 同步更新 state 和 ref
const setSplitSide = useCallback((side: 'left' | 'right' | null) => {
  _setSplitSide(side);
  splitSideRef.current = side;
}, []);

const handleSplit = useCallback(() => {
  // 使用 ref 获取最新值
  const currentSplitSide = splitSideRef.current;
  if (currentSplitSide === 'right') {
    doSomething(); // 正确执行
  }
}, []); // 依赖数组可以为空，因为读取的是 ref

  useEffect(() => {
    winbox.addControl({ click: handleSplit });
  }, []);
  ```

**原因**: 第三方库（如 WinBox、ECharts、D3 等）在初始化时保存回调函数的引用，之后不会自动更新。当 React 重新渲染创建新的 `useCallback` 实例时，第三方库内部保存的仍然是旧引用。旧回调中的闭包捕获的是创建时的 state 值，导致永远获取不到最新状态。使用 `useRef` 保存状态可以绕过闭包问题，因为 ref 对象本身不变，只是 `.current` 属性的值在变化。

### 错误 10: 独立的 React 树缺少上下文环境

**场景**: 在使用 `createRoot` 或 `render` 手动挂载组件（如画布元素 `ToolGenerator`、`WorkZone` 或第三方窗口内部）时

❌ **错误示例**:
```tsx
// 错误：直接渲染组件，导致新 React 树与主应用树脱节，无法访问全局 Context
const root = createRoot(container);
root.render(<MyComponent />);
// 报错：Uncaught Error: useI18n must be used within I18nProvider
```

✅ **正确示例**:
```tsx
// 正确：使用项目提供的提供者包装器，重新注入必要的上下文
import { ToolProviderWrapper } from '../toolbox-drawer/ToolProviderWrapper';

const root = createRoot(container);
root.render(
  <ToolProviderWrapper board={board}>
    <MyComponent />
  </ToolProviderWrapper>
);
```

**原因**: 独立的 React 树不会继承父级树的 Context。在 Aitu 中，画布元素是通过 SVG `foreignObject` 独立挂载的，必须通过 `ToolProviderWrapper` 显式重新提供 `I18nProvider`、`AssetProvider`、`WorkflowProvider` 和 `DrawnixContext` 等核心上下文，才能保证内部组件功能正常。

### 错误 11: 获取第三方组件位置使用其内部属性而非 DOM API

**场景**: 需要获取第三方弹窗/组件的屏幕位置进行坐标转换时（如 WinBox、Modal 等）

❌ **错误示例**:
```typescript
// 错误：使用 WinBox 的内部属性，可能与实际视口坐标不一致
const wb = winboxRef.current;
const rect = {
  x: wb.x,      // 可能是相对于 root 容器的坐标
  y: wb.y,      // 不一定等于视口坐标
  width: wb.width,
  height: wb.height,
};
// 与 getBoundingClientRect() 的坐标系不匹配，导致位置计算偏差
```

✅ **正确示例**:
```typescript
// 正确：使用 DOM 的 getBoundingClientRect() 获取准确的视口坐标
const wbWindow = wb.window as HTMLElement;
const domRect = wbWindow.getBoundingClientRect();
const rect = {
  x: domRect.left,   // 相对于视口的 X 坐标
  y: domRect.top,    // 相对于视口的 Y 坐标
  width: domRect.width,
  height: domRect.height,
};
// 与其他元素的 getBoundingClientRect() 使用相同坐标系，计算准确
```

**原因**: 第三方组件库（如 WinBox、Dialog 等）的内部位置属性可能使用不同的坐标系统（相对于 root 容器、相对于父元素等），与浏览器的视口坐标不一致。而 `getBoundingClientRect()` 始终返回元素相对于视口的准确位置，是进行坐标转换的可靠来源。当需要将一个元素的位置映射到另一个坐标系（如画布坐标）时，应统一使用 `getBoundingClientRect()` 获取两者的视口坐标，再进行转换。

### 错误 12: CustomEvent 传递硬编码占位符而非实际值

**场景**: 使用 CustomEvent 在组件/模块间传递数据时

❌ **错误示例**:
```typescript
// 错误：使用硬编码占位符，UI 会显示 "vnew" 而非实际版本号
window.dispatchEvent(new CustomEvent('sw-update-available', { 
  detail: { version: 'new' }  // ❌ 硬编码的占位符
}));

// 结果：UI 显示 "新版本 vnew 已就绪"
```

✅ **正确示例**:
```typescript
// 正确：先获取实际值再传递
fetch(`/version.json?t=${Date.now()}`)
  .then(res => res.ok ? res.json() : null)
  .then(data => {
    window.dispatchEvent(new CustomEvent('sw-update-available', { 
      detail: { version: data?.version || 'unknown' }  // ✅ 实际版本号
    }));
  })
  .catch(() => {
    window.dispatchEvent(new CustomEvent('sw-update-available', { 
      detail: { version: 'unknown' }  // ✅ 明确的回退值
    }));
  });

// 结果：UI 显示 "新版本 v0.5.35 已就绪"
```

**原因**: CustomEvent 的 `detail` 数据会直接被消费者使用。如果传递硬编码的占位符（如 `'new'`、`'loading'`），接收方无法区分这是占位符还是真实数据，导致 UI 显示错误。应该先获取实际数据再发送事件，或使用明确的回退值（如 `'unknown'`）并在 UI 中特殊处理。

### 错误 13: 嵌套滚动容器中 scroll 事件绑定错误的元素

**场景**: 在有多层可滚动容器（如 SideDrawer > VirtualTaskList）的嵌套布局中实现滚动相关功能（如回到顶部按钮）

❌ **错误示例**:
```typescript
// 错误：直接在组件自身的容器上监听 scroll，但实际滚动可能发生在外层容器
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const container = containerRef.current;
  container?.addEventListener('scroll', handleScroll); // 可能永远不触发！
}, []);

// 问题：
// - 外层容器 (.side-drawer__content) 设置了 overflow-y: auto
// - 内层容器 (.virtual-task-list-scrollarea) 也设置了 overflow: auto
// - 实际滚动可能发生在外层，内层的 scroll 事件永远不触发
```

✅ **正确示例**:
```typescript
// 正确：向上查找实际的滚动容器
const findScrollContainer = (element: HTMLElement | null): HTMLElement | null => {
  let current = element;
  while (current) {
    const style = getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && 
        current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

useEffect(() => {
  const container = containerRef.current;
  const actualScrollContainer = findScrollContainer(container);
  actualScrollContainer?.addEventListener('scroll', handleScroll); // ✅ 正确的容器
}, []);
```

**原因**: 当存在嵌套的 `overflow: auto/scroll` 容器时，滚动行为取决于哪个容器的内容先溢出。如果外层容器先溢出，滚动事件会在外层触发，内层容器上的监听器永远不会被调用。必须动态查找实际发生滚动的容器。

### 错误 14: 在动态高度容器中使用 absolute 定位固定元素

**场景**: 在可滚动列表底部放置固定按钮（如回到顶部、加载更多）

❌ **错误示例**:
```tsx
// 错误：使用 position: absolute，按钮会被推到内容底部产生空白
<div style={{ height: '100%', position: 'relative' }}>
  <div style={{ overflow: 'auto' }}>
    {/* 长列表内容 */}
  </div>
  <Button 
    style={{ position: 'absolute', bottom: 16 }} // ❌ 会被推到内容底部！
  />
</div>
// 问题：如果父容器的 height: 100% 没有生效（嵌套 flex 布局常见），
// 容器高度会被内容撑开，按钮定位在这个很高的容器底部，产生大量空白
```

✅ **正确示例**:
```tsx
// 正确：使用 position: fixed + 动态计算位置
const [buttonPosition, setButtonPosition] = useState<{ left: number; bottom: number } | null>(null);

const updateButtonPosition = (scrollContainer: HTMLElement) => {
  const rect = scrollContainer.getBoundingClientRect();
  setButtonPosition({
    left: rect.left + scrollContainer.clientWidth / 2,
    bottom: window.innerHeight - rect.bottom + 16,
  });
};

<Button 
  style={{
    position: 'fixed',
    left: buttonPosition.left,
    bottom: buttonPosition.bottom,
    transform: 'translateX(-50%)',
  }}
/>
```

**原因**: `position: absolute; bottom: X` 是相对于最近的定位父元素的底部。如果该父元素的高度被内容撑开（而非受限于视口），按钮会出现在内容底部而非视口底部。使用 `position: fixed` 相对于视口定位，配合动态计算可以正确放置按钮。

### 错误 15: ResizeObserver 监听错误的容器宽度

**场景**: 在嵌套组件（如弹窗内的任务列表）中使用 ResizeObserver 检测宽度以切换响应式布局

❌ **错误示例**:
```typescript
// 错误：只监听组件自身容器，但实际宽度由外层容器决定
useEffect(() => {
  const container = containerRef.current;
  const resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0].contentRect.width;
    setIsCompact(width < 500); // 可能检测到错误的宽度！
  });
  resizeObserver.observe(container);
}, []);
// 问题：组件容器可能设置了 flex: 1 或 100%，
// 实际宽度由外层的抽屉/弹窗决定，应该监听外层容器
```

✅ **正确示例**:
```typescript
// 正确：查找并监听正确的父容器
useEffect(() => {
  const container = containerRef.current;
  if (!container) return;

  // 查找合适的父容器（优先级：抽屉 > 弹窗 > 自身）
  const drawerContent = container.closest('.side-drawer__content') as HTMLElement;
  const dialogTaskList = container.closest('.dialog-task-list') as HTMLElement;
  const dialogBody = container.closest('.t-dialog__body') as HTMLElement;
  const targetElement = drawerContent || dialogTaskList || dialogBody || container;

  const resizeObserver = new ResizeObserver((entries) => {
    const width = entries[0].contentRect.width;
    setIsCompact(width < 500); // ✅ 监听正确的容器
  });
  resizeObserver.observe(targetElement);
}, []);
```

**原因**: 在嵌套布局中，组件自身的容器宽度可能由 CSS（如 `flex: 1`、`width: 100%`）动态计算。ResizeObserver 应该监听决定实际可视宽度的外层容器（如抽屉内容区域、弹窗主体），才能正确触发响应式布局切换。

---

### 错误 16: 垂直按钮列表中的 Tooltip 遮挡相邻元素

**场景**: 当多个按钮垂直紧密排列时，默认的上方气泡（Tooltip）会遮挡上方的按钮。

❌ **错误示例**:
```tsx
<div className="actions-list">
  <Tooltip content="操作1">
    <Button icon={<Icon1 />} />
  </Tooltip>
  <Tooltip content="操作2">
    <Button icon={<Icon2 />} />
  </Tooltip>
</div>
```

✅ **正确示例**:
```tsx
<div className="actions-list">
  <Tooltip content="操作1" placement="left" theme="light">
    <Button icon={<Icon1 />} />
  </Tooltip>
  <Tooltip content="操作2" placement="left" theme="light">
    <Button icon={<Icon2 />} />
  </Tooltip>
</div>
```

**原因**: 默认的 `top` 弹出位置会覆盖紧邻上方的交互元素。改用 `left` 或 `right` 弹出可以避开按钮排列轴向，确保所有按钮都可被顺畅点击。

### 错误 17: 基于过滤结果动态生成筛选按钮

**场景**: 实现分类筛选功能时，分类列表不应随当前选择而缩小。

❌ **错误示例**:
```typescript
// 错误：分类按钮列表随 filteredTools 变化
const categories = useMemo(() => {
  return Array.from(new Set(filteredTools.map(t => t.category)));
}, [filteredTools]);
```

✅ **正确示例**:
```typescript
// 正确：分类按钮始终包含所有可用选项
const allCategories = useMemo(() => {
  return Array.from(new Set(allAvailableTools.map(t => t.category)));
}, [allAvailableTools]);
```

**原因**: 如果筛选按钮是根据当前显示的结果动态生成的，一旦用户选定了一个分类，其它分类按钮就会因为结果中不存在而消失，导致用户无法直接切换到其它分类。

### 错误 18: 抽屉组件 z-index 硬编码过低导致被工具栏遮挡

**场景**: 侧边抽屉开启后，左边缘被工具栏覆盖，导致内边距看起来不对称或部分内容不可见。

❌ **错误示例**:
```tsx
<BaseDrawer zIndex={12} ... /> // z-index 太低，会被 2000 级的工具栏挡住
```

✅ **正确示例**:
```tsx
<BaseDrawer ... /> // 使用默认规范定义的 z-index (4030)
```

**原因**: 项目中的 `z-index` 有严格的分层规范（参见 `docs/Z_INDEX_GUIDE.md`）。工具栏位于 2000 层，而抽屉应该位于 4000 层及以上。硬编码低层级会破坏预留宽度的视觉预期。

### 错误 19: 初始化时重要元素不可见未自动滚动

**场景**: 在高度受限的可滚动容器中，重要的操作按钮（如 AI 生成按钮）可能位于可视区域外，用户不知道功能存在。

❌ **错误示例**:
```tsx
// 错误：不检查重要元素是否可见
const ToolbarContainer = () => {
  return (
    <div className="scrollable-toolbar">
      <HandButton />
      <SelectButton />
      {/* ... 更多按钮 */}
      <AIImageButton /> {/* 屏幕小时可能不可见 */}
      <AIVideoButton />
    </div>
  );
};
```

✅ **正确示例**:
```tsx
const ToolbarContainer = () => {
  const scrollableRef = useRef<HTMLDivElement>(null);
  const hasScrolledToAI = useRef(false); // 防止重复执行

  useEffect(() => {
    // 只执行一次，避免死循环
    if (hasScrolledToAI.current) return;
    
    const scrollable = scrollableRef.current;
    if (!scrollable) return;

    const checkAndScroll = () => {
      hasScrolledToAI.current = true; // 标记为已执行
      
      // 查找目标按钮
      const targetButton = scrollable.querySelector<HTMLElement>('[data-button-id="ai-image"]');
      if (!targetButton) return;

      // 检测是否可见
      const scrollableRect = scrollable.getBoundingClientRect();
      const buttonRect = targetButton.getBoundingClientRect();
      const isVisible = buttonRect.bottom <= scrollableRect.bottom && 
                        buttonRect.top >= scrollableRect.top;

      // 不可见时滚动（检查高度 > 0 避免极端情况）
      if (!isVisible && scrollableRect.height > 0) {
        scrollable.scrollTop += buttonRect.top - scrollableRect.top;
      }
    };

    // 延迟执行，确保 DOM 渲染完成
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(checkAndScroll);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div ref={scrollableRef} className="scrollable-toolbar">
      {/* 按钮需要添加 data-button-id 属性以便定位 */}
      <HandButton />
      <SelectButton />
      <AIImageButton data-button-id="ai-image" />
      <AIVideoButton data-button-id="ai-video" />
    </div>
  );
};
```

**防止死循环的关键点**:
1. 使用 `ref` 标志确保只执行一次
2. 在执行前立即设置标志，而非执行后
3. 检查容器高度 > 0，避免容器未渲染时的极端情况
4. 不在滚动失败时重试

**原因**: 屏幕尺寸多样化，重要功能按钮可能因容器高度不足而不可见。初始化时自动滚动到这些元素可以提升功能发现率，但必须确保只执行一次以避免死循环。

### 交互规范: 三段式循环排序模式

**场景**: 实现包含正序、逆序且需要支持恢复默认状态的排序按钮时。

❌ **错误示例**:
使用多个独立按钮分别代表正序和逆序，或者简单的二段式切换（无法方便地回到默认排序）。

✅ **正确示例**:
使用单个按钮循环切换：`正序 -> 逆序 -> 恢复默认排序（如日期降序）`。
```typescript
const handleSortClick = () => {
  if (currentSort === group.options.asc) {
    setFilters({ sortBy: group.options.desc }); // 切换到逆序
  } else if (currentSort === group.options.desc) {
    setFilters({ sortBy: 'DATE_DESC' }); // 恢复默认
  } else {
    setFilters({ sortBy: group.options.asc }); // 切换到正序
  }
};
```

**原因**: 这种模式在节省 UI 空间的同时，能让用户在有限的点击次数内触达所有排序状态，且逻辑闭环。

### 样式规范: 筛选岛（Island）组件的间距与对齐

**场景**: 在紧凑的水平排列筛选组中显示图标和计数标签时。

❌ **错误示例**:
```scss
.filter-option {
  width: 32px; // 固定宽度在数字变长时会溢出
  .count {
    position: absolute; // 绝对定位容易导致与图标重叠
    right: 2px;
  }
}
```

✅ **正确示例**:
```scss
.filter-option {
  padding: 0 8px; // 使用 padding 适应不同宽度的数字
  display: flex;
  align-items: center;
  gap: 4px; // 为图标和计数预留固定间距
  .count {
    font-size: 11px; // 保持精致感
  }
}
```

**原因**: 筛选组通常包含数量反馈，个位数和多位数占用的空间不同。使用弹性布局（Flex + gap）能确保在任何数据状态下 UI 都是对齐且易读的。

### UI 设计原则: 以影代框（Shadows Over Borders）

**场景**: 为面板、卡片或容器定义边界时。

❌ **错误示例**:
```scss
.container {
  border: 1px solid var(--td-component-border);
}
```

✅ **正确示例**:
```scss
.container {
  border: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
```

**原因**: 过多的物理线条（Border）会增加页面的视觉复杂度和“噪音”，产生生硬的切割感。改用弥散的弱阴影（Shadow）可以自然地体现层级关系，使界面显得更加通透、轻量且具有现代感。

### 样式规范: 消除容器与首个子元素边距叠加

**场景**: 容器有内边距（Padding）且首个子元素有上外边距（Margin-top）时，会导致顶部间距过大。

❌ **错误示例**:
```scss
.container { padding: 16px; }
.title { margin-top: 16px; } // 结果顶部间距变成了 32px
```

✅ **正确示例**:
```scss
.container { padding: 16px; }
.title { margin-top: 16px; }
.title:first-child { margin-top: 0; } // 或在容器内指定首个标题 margin-top: 4px
```

**原因**: 避免 Padding 与 Margin 的视觉累加，确保界面排版符合设计的网格预期。

### UI 设计原则: 批量操作按钮视觉层级

**场景**: 设计包含多个操作按钮的批量操作栏（如任务队列、文件管理器）时。

❌ **错误示例**:
```tsx
// 所有按钮都使用主题色，视觉噪音过大
<div className="batch-actions">
  <Button theme="primary">重试 (3)</Button>
  <Button theme="primary">删除 (6)</Button>
  <Button theme="primary">导出 (6)</Button>
</div>
```

✅ **正确示例**:
```tsx
// 主要正向操作使用主题色，危险/次要操作弱化
<div className="batch-actions">
  <Button theme="primary">重试 (3)</Button>           {/* 主要正向操作 - 主题色实心 */}
  <Button variant="text" theme="default">删除 (6)</Button>  {/* 危险操作 - 弱化为文字按钮 */}
</div>
```

**原因**: 
- 过多的主题色按钮会造成视觉疲劳，用户难以快速识别主要操作
- 危险操作（如删除）应该弱化，避免用户误操作
- 按钮层级建议：主要正向操作 > 次要操作 > 危险操作
- 视觉层级：`theme="primary"` 实心 > `variant="outline"` 描边 > `variant="text"` 文字

### 性能指南
- 使用 `React.lazy` 对大型组件进行代码分割
- 对图片实现懒加载和预加载
- 避免在 render 中创建新对象/函数
- 对长列表考虑使用虚拟化

#### 预缓存配置规范

**场景**: 使用 Service Worker 预缓存静态资源时，需要合理配置排除列表

❌ **错误示例**:
```typescript
// vite.config.ts - 错误：没有排除调试工具和大型资源
function precacheManifestPlugin(): Plugin {
  const EXCLUDE_PATTERNS = [
    /stats\.html$/,
    /\.map$/,
  ];
  // 扫描所有目录，包括 sw-debug/、product_showcase/ 等
  scanDir(outDir);  // ❌ 会将所有文件加入预缓存
}
```

✅ **正确示例**:
```typescript
// vite.config.ts - 正确：明确排除非核心资源
function precacheManifestPlugin(): Plugin {
  const EXCLUDE_PATTERNS = [
    /stats\.html$/,
    /\.map$/,
    /sw-debug\.html$/,  // ✅ 排除调试面板入口
  ];
  
  // 跳过不需要预缓存的目录
  const SKIP_DIRECTORIES = [
    'product_showcase',  // 大型展示资源
    'help_tooltips',     // 帮助提示图片
    'sw-debug',          // 调试面板（仅在访问时加载）
  ];
  
  if (entry.isDirectory()) {
    if (!SKIP_DIRECTORIES.includes(entry.name)) {
      scanDir(fullPath, relativePath);
    }
  }
}
```

**应该排除的资源类型**:
1. **调试工具** - 如 `sw-debug/`，仅开发/排查时访问
2. **大型展示资源** - 如 `product_showcase/`，非核心功能
3. **帮助/文档资源** - 如 `help_tooltips/`，按需加载即可
4. **Source Maps** - 生产环境不需要预缓存

**原因**: 预缓存会在主应用启动时由 Service Worker 下载所有列表中的文件。如果包含非核心资源，会：
- 增加首次加载时间和带宽消耗
- 占用用户设备存储空间
- 影响主应用的启动性能和用户体验

### 安全指南
- 验证和清理所有用户输入
- 永远不要硬编码敏感信息（API keys 等）
- 对 API 调用使用适当的错误处理
- 在日志中过滤敏感信息

#### 上报工具敏感信息过滤

**场景**: 使用 PostHog、Sentry 等上报工具时，需要确保不泄露 API Key 等敏感信息

❌ **错误示例**:
```typescript
// Sentry: 启用自动 PII 收集
Sentry.init({
  sendDefaultPii: true, // 会收集 IP 地址等
  // 没有 beforeSend 过滤
});

// PostHog: 直接传递未过滤的数据
window.posthog.capture(eventName, eventData); // eventData 可能包含敏感信息
```

✅ **正确示例**:
```typescript
// Sentry: 禁用 PII，添加 beforeSend 过滤
import { sanitizeObject, sanitizeUrl } from '@drawnix/drawnix';

Sentry.init({
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.extra) event.extra = sanitizeObject(event.extra);
    if (event.request?.url) event.request.url = sanitizeUrl(event.request.url);
    return event;
  },
});

// PostHog: 使用 sanitizeObject 过滤敏感字段
const sanitizedData = sanitizeObject(eventData);
window.posthog.capture(eventName, sanitizedData);
```

**敏感字段列表**: `apikey`, `api_key`, `password`, `token`, `secret`, `authorization`, `bearer`, `credential`

**相关工具模块**:
- 主线程: `packages/drawnix/src/utils/sanitize-utils.ts`
- Service Worker: `apps/web/src/sw/task-queue/utils/sanitize-utils.ts`

#### Console 日志安全打印

**场景**: 使用 console.error/warn 记录错误时

❌ **错误示例**:
```typescript
// 错误：直接打印完整 error 对象，可能包含敏感信息
try {
  await loadConfig();
} catch (error) {
  console.error('Failed to load config:', error); // error 可能包含 API Key
}
```

✅ **正确示例**:
```typescript
import { getSafeErrorMessage } from '@drawnix/drawnix';

try {
  await loadConfig();
} catch (error) {
  // 只记录错误类型，不记录详细信息
  console.error('Failed to load config:', getSafeErrorMessage(error));
}

// getSafeErrorMessage 实现：
function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name || 'Error';
  }
  return 'Unknown error';
}
```

**原因**: 
- 错误对象可能包含敏感的请求/响应数据
- API 错误可能在 message 中包含 API Key 或其他敏感信息
- 生产环境的 console 日志可能被监控工具收集

#### 敏感信息模板变量安全处理

**场景**: 工具 URL 或配置中包含敏感信息（如 apiKey）时

❌ **错误示例**:
```typescript
// 错误：在插入画布时就替换模板变量，导致实际 apiKey 被存储
const executeToolInsert = (tool: ToolDefinition) => {
  const { url } = processToolUrl(tool.url); // 替换 ${apiKey} 为实际值
  ToolTransforms.insertTool(board, tool.id, url, ...); // 存储了实际 apiKey！
};
// 问题：导出/备份时会泄露敏感信息
```

✅ **正确示例**:
```typescript
// 正确：存储原始模板 URL，渲染时才替换
const executeToolInsert = (tool: ToolDefinition) => {
  // 存储原始模板 URL（如 https://api.com?key=${apiKey}）
  ToolTransforms.insertTool(board, tool.id, tool.url, ...);
};

// 在渲染 iframe 时动态替换
private createIframe(element: PlaitTool): HTMLIFrameElement {
  const { url: processedUrl } = processToolUrl(element.url);
  iframe.src = processedUrl;
  // 保存原始模板 URL，用于设置变化时重新替换
  (iframe as any).__templateUrl = element.url;
}

// 监听设置变化，动态刷新 iframe
window.addEventListener('gemini-settings-changed', () => {
  this.refreshTemplateIframes();
});
```

**原因**: 
- 敏感信息（如 apiKey）应该使用模板变量形式（如 `${apiKey}`）存储在数据中
- 只在渲染时动态替换为实际值
- 这样可以确保导出/备份时不会泄露敏感信息
- 用户更新设置后，已打开的工具可以自动刷新使用新的配置

#### 部署脚本安全实践

**场景**: 创建部署脚本（上传文件、执行远程命令等）时

❌ **错误示例**:
```javascript
// 错误：在代码中硬编码密码
const password = 'my-secret-password';
const sshCommand = `sshpass -p "${password}" ssh user@host`;

// 错误：.env 文件未在 .gitignore 中，可能被提交到 Git
// .env 文件包含敏感信息但被提交了

// 错误：使用密码认证，密码会出现在进程列表中
const scpCommand = `sshpass -p "${config.DEPLOY_SSH_PASSWORD}" scp ...`;
```

✅ **正确示例**:
```javascript
// 正确：从 .env 文件读取配置（确保 .env 在 .gitignore 中）
const config = loadEnvConfig(); // 从 .env 读取

// 正确：优先使用 SSH 密钥认证
if (config.DEPLOY_SSH_KEY) {
  sshCommand = `ssh -i "${sshKeyPath}" ...`;
} else if (config.DEPLOY_SSH_PASSWORD) {
  // 如果必须使用密码，使用环境变量而不是命令行参数
  process.env.SSHPASS = config.DEPLOY_SSH_PASSWORD;
  sshCommand = 'sshpass -e ssh ...'; // -e 从环境变量读取
}

// 正确：配置免密 sudo，而不是在脚本中传递 sudo 密码
// 在服务器上：sudo visudo
// 添加：username ALL=(ALL) NOPASSWD: /bin/cp, /usr/sbin/nginx
```

**安全最佳实践**:
1. **SSH 密钥认证**（强烈推荐）：
   - 生成密钥对：`ssh-keygen -t ed25519`
   - 将公钥添加到服务器：`ssh-copy-id user@host`
   - 在 `.env` 中配置：`DEPLOY_SSH_KEY=~/.ssh/id_ed25519`

2. **.env 文件管理**：
   - ✅ 确保 `.env` 在 `.gitignore` 中
   - ✅ 创建 `.env.example` 作为模板（不包含真实密码）
   - ❌ 永远不要将 `.env` 提交到版本控制

3. **Sudo 权限**：
   - ✅ 配置免密 sudo（更安全）：`sudo visudo` 添加 `NOPASSWD` 规则
   - ⚠️ 如果必须使用密码，使用 `sudo -S` 从标准输入读取（但仍不安全）

4. **密码传递**：
   - ❌ 避免在命令行中传递密码（`sshpass -p "password"`）
   - ✅ 使用环境变量：`sshpass -e` 从 `SSHPASS` 环境变量读取
   - ✅ 优先使用 SSH 密钥，完全避免密码

**原因**:
- 密码在命令行参数中会出现在进程列表中（`ps aux`），容易被其他用户看到
- `.env` 文件如果被提交到 Git，所有敏感信息都会泄露
- 使用 SSH 密钥认证更安全，且不需要每次输入密码
- 免密 sudo 避免了在脚本中存储 sudo 密码的风险

**检查清单**:
- [ ] `.env` 文件在 `.gitignore` 中
- [ ] 创建了 `.env.example` 模板文件
- [ ] 脚本中没有硬编码的密码或服务器地址
- [ ] 优先使用 SSH 密钥认证
- [ ] 配置了免密 sudo（如果需要）

---


### API 轮询与任务恢复规则

**场景**: 视频生成等需要轮询的 API 调用，以及页面刷新后的任务恢复

#### 错误 1: 轮询时不区分业务失败和网络错误

❌ **错误示例**:
```typescript
// 所有错误都重试 - 错误！业务失败不应重试
while (attempts < maxAttempts) {
  try {
    const response = await fetch(`${baseUrl}/videos/${videoId}`);
    const data = await response.json();
    
    if (data.status === 'failed') {
      throw new Error(data.error.message);  // 这个错误会被 catch 重试
    }
  } catch (err) {
    // 所有错误都重试 - 业务失败也会重试！
    consecutiveErrors++;
    await sleep(backoffInterval);
  }
}
```

✅ **正确示例**:
```typescript
// 区分业务失败和网络错误
class VideoGenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoGenerationFailedError';
  }
}

while (attempts < maxAttempts) {
  try {
    const response = await fetch(`${baseUrl}/videos/${videoId}`);
    const data = await response.json();
    
    if (data.status === 'failed') {
      // 使用特殊错误类型，不应重试
      throw new VideoGenerationFailedError(data.error.message);
    }
  } catch (err) {
    // 业务失败直接抛出，不重试
    if (err instanceof VideoGenerationFailedError) {
      throw err;
    }
    // 只有网络错误才重试
    consecutiveErrors++;
    await sleep(backoffInterval);
  }
}
```

**原因**: 业务失败（如 `generation_failed`、`INVALID_ARGUMENT`）是 API 明确返回的错误，重试也不会成功，只会浪费时间。网络错误是临时的，重试可能成功。

---

#### 错误 2: 页面刷新后自动恢复所有失败任务

❌ **错误示例**:
```typescript
// 恢复所有有 remoteId 的失败任务 - 错误！
const failedTasks = storedTasks.filter(task =>
  task.status === 'failed' && task.remoteId
);
failedTasks.forEach(task => {
  // 所有失败任务都恢复
  taskService.updateStatus(task.id, 'processing');
});
```

✅ **正确示例**:
```typescript
// 只恢复网络错误导致的失败任务
const isNetworkError = (task: Task): boolean => {
  const errorMsg = `${task.error?.message || ''} ${task.error?.details?.originalError || ''}`.toLowerCase();
  
  // 排除业务失败 - 这些不应该自动恢复
  const isBusinessFailure = (
    errorMsg.includes('generation_failed') ||
    errorMsg.includes('invalid_argument') ||
    errorMsg.includes('prohibited') ||
    errorMsg.includes('content policy')
  );
  if (isBusinessFailure) {
    // 429 限流属于可恢复的临时业务错误
    return errorMsg.includes('429') || errorMsg.includes('too many requests');
  }
  
  // 只有网络错误才恢复
  return (
    errorMsg.includes('failed to fetch') ||
    errorMsg.includes('network') ||
    errorMsg.includes('timeout')
  );
};

// 只恢复视频/角色任务（图片任务不恢复，因为每次调用都扣费）
const failedVideoTasks = storedTasks.filter(task =>
  task.type === TaskType.VIDEO &&
  task.status === 'failed' &&
  task.remoteId &&
  isNetworkError(task)
);
```

**原因**:
1. **业务失败不恢复**：API 返回的明确失败（如内容违规）重试也不会成功
2. **图片任务不恢复**：图片生成是同步调用，每次重试都会扣费
3. **视频任务可恢复**：视频有 `remoteId`，重新查询状态不会产生额外费用

---

#### 错误 3: 计费任务重试时重复调用生成接口

**场景**: 视频生成、角色提取等长耗时且按次计费的异步任务。

❌ **错误示例**:
```typescript
// 错误：无论是否已有 remoteId，重试都重新提交生成请求
async retryTask(task) {
  task.status = 'pending';
  // 重新进入流程，导致重新调用 POST /videos
  this.processQueue(); 
}
```

✅ **正确示例**:
```typescript
// 正确：如果已有 remoteId，直接进入轮询阶段，跳过提交
async executeTask(task) {
  if (task.remoteId && (task.type === 'video' || task.type === 'character')) {
    task.executionPhase = 'polling';
    return this.executeResume(task, task.remoteId);
  }
  // 正常提交逻辑...
}
```

**原因**: AI 厂商的生成接口通常较贵。一旦任务 ID (`remoteId`) 已成功返回，该任务就在云端排队生成。此时任何重试或恢复操作都应仅限于查询进度，严禁再次点击生成接口导致重复扣费和资源浪费。

---

#### 错误 4: 异步任务 ID 找回逻辑不完整

**场景**: 任务提交成功但在 `remoteId` 保存到数据库前发生页面刷新或 Service Worker 重启。

❌ **错误示例**:
```typescript
// 错误：仅检查已完成的任务结果
async resumeTask(task) {
  if (!task.remoteId) {
    // 如果还没完成，就直接报错提示无法恢复
    const successLog = await findSuccessLog(task.id);
    if (!successLog) throw new Error('无法恢复');
  }
}
```

✅ **正确示例**:
```typescript
// 正确：通过 API 日志系统尝试找回丢失的任务 ID（哪怕任务还没完成）
async resumeTask(task) {
  if (!task.remoteId) {
    // 从日志中找回 remoteId 或解析响应体
    const latestLog = await findLatestLogByTaskId(task.id);
    const recoveredId = latestLog?.remoteId || parseIdFromBody(latestLog?.responseBody);
    if (recoveredId) {
      task.remoteId = recoveredId;
      return this.resumePolling(task); // 继续轮询进度
    }
  }
}
```

**原因**: 状态更新的持久化可能因崩溃而丢失。利用独立的日志系统记录每一次 API 响应，可以在主状态丢失时找回关键的任务 ID，实现任务进度的无缝衔接。

---

#### 任务恢复决策表

| 任务类型 | 错误类型 | 是否自动恢复 | 原因 |
|---------|---------|-------------|------|
| 视频/角色 | 网络/限流错误 | ✅ 是 | 查询状态不扣费 |
| 视频/角色 | 业务失败 | ❌ 否 | 重试也不会成功 |
| 图片 | 任何错误 | ❌ 否 | 每次调用都扣费 |

---

### 生产代码禁止保留调试日志

**场景**: 开发调试时添加的 `console.log` 语句未在提交前清理

❌ **错误示例**:
```typescript
// 调试日志遗留在生产代码中
const handleZoomPercentClick = useCallback(() => {
  console.log('[ViewNavigation] Zoom percent clicked, current state:', zoomMenuOpen);
  setZoomMenuOpen((prev) => !prev);
}, [zoomMenuOpen]);

// Popover 中的调试日志
<Popover
  onOpenChange={(open) => {
    console.log('[Popover] onOpenChange:', open);
    setZoomMenuOpen(open);
  }}
>
```

✅ **正确示例**:
```typescript
// 清理调试日志，保持代码简洁
const handleZoomPercentClick = useCallback(() => {
  setZoomMenuOpen((prev) => !prev);
}, []);

// 直接传递 setter 函数
<Popover onOpenChange={setZoomMenuOpen}>
```

**原因**:
1. 调试日志会污染用户控制台，影响体验
2. 暴露内部实现细节，存在安全隐患
3. 增加打包体积和运行时开销
4. 代码 Review 时容易被忽略，形成技术债

**例外情况**:
- `console.error` / `console.warn` 用于记录真正的错误/警告是允许的
- 带有 `[DEBUG]` 前缀且通过环境变量控制的日志可以保留

---

### 组件空状态不应简单返回 null

**场景**: 组件在没有数据时需要决定是否渲染

❌ **错误示例**:
```tsx
// 错误：没有历史记录时直接隐藏整个组件，用户看不到预设提示词
const PromptHistoryPopover = () => {
  const { history } = usePromptHistory();
  
  // 没有历史记录就不显示按钮
  if (history.length === 0) {
    return null;
  }
  
  return (
    <button>提示词</button>
    // ...
  );
};
```

✅ **正确示例**:
```tsx
// 正确：即使没有历史记录也显示按钮，展示预设提示词
const PromptHistoryPopover = () => {
  const { history } = usePromptHistory();
  const presetPrompts = getPresetPrompts();
  
  // 合并历史记录和预设提示词
  const allPrompts = [...history, ...presetPrompts];
  
  // 按钮始终显示
  return (
    <button>提示词</button>
    // 面板中显示历史 + 预设
  );
};
```

**原因**: 
1. 组件的核心功能（如提示词选择）不应该依赖于是否有历史数据
2. 预设内容为新用户提供了引导，提升首次使用体验
3. 隐藏入口会让用户不知道功能存在

---

### 文案应考虑所有使用场景

**场景**: 为组件、按钮、标题等编写文案时

❌ **错误示例**:
```tsx
// 错误：标题"历史提示词"在没有历史记录时不贴切
<PromptListPanel
  title={language === 'zh' ? '历史提示词' : 'Prompt History'}
  items={promptItems}  // 可能包含历史记录 + 预设提示词
/>
```

✅ **正确示例**:
```tsx
// 正确：使用更通用的标题"提示词"
<PromptListPanel
  title={language === 'zh' ? '提示词' : 'Prompts'}
  items={promptItems}
/>
```

**原因**:
1. 文案过于具体会在某些场景下显得不准确
2. 通用的文案能适应更多使用场景（有/无历史记录）
3. 避免后续因场景变化而频繁修改文案

---

### UI 重构时必须保持信息完整性

**场景**: 重构 UI 样式（如简化布局、统一风格）时

❌ **错误示例**:
```typescript
// 重构前：显示完整的性能信息
entry.innerHTML = `
  <span class="log-perf">⚡ 任务时长: ${duration}ms | FPS: ${fps}</span>
  <span class="log-memory">📊 ${usedMB} MB / ${limitMB} MB (${percent}%)</span>
`;

// 重构后：为了"简化"只显示时长徽章，丢失了 FPS 和内存信息
let perfBadge = '';
if (log.performance?.longTaskDuration) {
  perfBadge = `<span class="log-duration">${duration}ms</span>`;
}
// ❌ FPS、内存信息没有了！
```

✅ **正确示例**:
```typescript
// 重构后：样式简化但信息完整
let perfText = '';
if (log.performance) {
  const parts = [];
  if (log.performance.longTaskDuration) {
    parts.push(`任务时长: ${log.performance.longTaskDuration.toFixed(0)}ms`);
  }
  if (log.performance.fps !== undefined) {
    parts.push(`FPS: ${log.performance.fps}`);
  }
  perfText = parts.join(' | ');
}
// ✅ 所有原有信息都保留
```

**检查清单**:
- 重构前列出所有显示的信息项
- 重构后逐一核对是否都有展示
- 用真实数据测试，确认信息完整

**原因**: 样式重构的目的是优化视觉呈现，而不是删减功能。用户依赖这些信息进行问题诊断，丢失信息会影响使用体验。

---

### 日志/数据保留应优先保留问题记录

**场景**: 实现日志、任务历史等有容量上限的列表时

❌ **错误示例**:
```typescript
// 简单 FIFO，新日志进来就删除最旧的
state.logs.unshift(newLog);
if (state.logs.length > MAX_LOGS) {
  state.logs.pop();  // ❌ 可能删掉重要的错误日志
}
```

✅ **正确示例**:
```typescript
// 优先保留问题记录
function isProblemLog(log) {
  if (log.status >= 400 || log.error) return true;  // 错误请求
  if (log.duration >= 1000) return true;  // 慢请求
  return false;
}

function trimLogsWithPriority(maxLogs) {
  // 分类
  const bookmarked = logs.filter(l => isBookmarked(l.id));
  const problems = logs.filter(l => !isBookmarked(l.id) && isProblemLog(l));
  const normal = logs.filter(l => !isBookmarked(l.id) && !isProblemLog(l));
  
  // 优先保留：收藏 > 问题 > 正常
  const mustKeep = bookmarked.length + problems.length;
  if (mustKeep >= maxLogs) {
    state.logs = [...bookmarked, ...problems.slice(0, maxLogs - bookmarked.length)];
  } else {
    state.logs = [...bookmarked, ...problems, ...normal.slice(0, maxLogs - mustKeep)];
  }
}
```

**保留优先级**:
1. 用户收藏/标记的记录
2. 错误记录（状态码 >= 400、有 error 字段）
3. 慢请求（耗时 >= 1s）
4. 正常记录

**原因**: 正常请求通常不需要回溯，而问题请求是排查问题的关键依据。如果问题请求被正常请求挤掉，会大大增加问题定位难度。

---

### 批量加载与单个加载方法必须保持逻辑一致

**场景**: 存在 `loadAll*()` 和 `load*()` 两种加载方法时

❌ **错误示例**:
```typescript
// loadBoard 有迁移逻辑
async loadBoard(id: string): Promise<Board | null> {
  const board = await this.getBoardsStore().getItem(id);
  if (board?.elements) {
    await migrateElementsBase64Urls(board.elements);  // ✅ 有迁移
  }
  return board;
}

// loadAllBoards 缺少迁移逻辑
async loadAllBoards(): Promise<Board[]> {
  const boards: Board[] = [];
  await this.getBoardsStore().iterate((value) => {
    boards.push(value);  // ❌ 没有迁移！
  });
  return boards;
}
// 问题：应用初始化用 loadAllBoards()，迁移逻辑永远不会执行
```

✅ **正确示例**:
```typescript
async loadAllBoards(): Promise<Board[]> {
  const boards: Board[] = [];
  await this.getBoardsStore().iterate((value) => {
    if (value.elements) {
      value.elements = migrateElementsFillData(value.elements);
    }
    boards.push(value);
  });
  
  // 迁移 Base64 图片 URL（与 loadBoard 保持一致）
  for (const board of boards) {
    if (board.elements) {
      const migrated = await migrateElementsBase64Urls(board.elements);
      if (migrated) await this.saveBoard(board);
    }
  }
  
  return boards;
}
```

**原因**: 应用初始化通常使用批量加载方法（`loadAll*`），而开发时可能只在单个加载方法中添加新逻辑。这会导致新逻辑在实际运行时永远不会执行。

---

### IndexedDB 元数据必须验证 Cache Storage 实际数据

**场景**: IndexedDB 存储元数据，Cache Storage 存储实际 Blob 数据

❌ **错误示例**:
```typescript
// 只从 IndexedDB 读取元数据，不验证 Cache Storage
async getAllAssets(): Promise<Asset[]> {
  const keys = await this.store.keys();
  return Promise.all(keys.map(async key => {
    const stored = await this.store.getItem(key);
    return storedAssetToAsset(stored);  // ❌ 不验证实际数据是否存在
  }));
}
// 问题：IndexedDB 有记录但 Cache Storage 数据被清理，导致 404
```

✅ **正确示例**:
```typescript
async getAllAssets(): Promise<Asset[]> {
  // 先获取 Cache Storage 中的有效 URL
  const cache = await caches.open('drawnix-images');
  const validUrls = new Set(
    (await cache.keys()).map(req => new URL(req.url).pathname)
  );
  
  const keys = await this.store.keys();
  return Promise.all(keys.map(async key => {
    const stored = await this.store.getItem(key);
    
    // 验证 Cache Storage 中有实际数据
    if (stored.url.startsWith('/asset-library/')) {
      if (!validUrls.has(stored.url)) {
        console.warn('Asset not in Cache Storage, skipping:', stored.url);
        return null;  // ✅ 跳过无效资源
      }
    }
    
    return storedAssetToAsset(stored);
  }));
}
```

**原因**: 
- IndexedDB 和 Cache Storage 是独立的存储机制
- Cache Storage 可能被浏览器清理（存储压力时）
- 如果不验证，会显示实际无法加载的资源，导致 404 错误

---

### 本地缓存图片只存 Cache Storage，不存 IndexedDB

**场景**: 缓存本地生成的图片（如分割图片、Base64 迁移、合并图片）

❌ **错误示例**:
```typescript
// 本地图片也存入 IndexedDB 元数据
const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
await unifiedCacheService.cacheMediaFromBlob(stableUrl, blob, 'image', { taskId });
// 问题：IndexedDB 会堆积大量不需要的元数据
```

✅ **正确示例**:
```typescript
// 本地图片只存 Cache Storage
const stableUrl = `/__aitu_cache__/image/${taskId}.png`;
await unifiedCacheService.cacheToCacheStorageOnly(stableUrl, blob);
// ✅ 只存实际数据，不存元数据
```

**适用场景**:
- ✅ 只存 Cache Storage：分割图片、Base64 迁移图片、合并图片
- ✅ 同时存 Cache Storage + IndexedDB：AI 生成图片、本地上传素材

**原因**: 
- 本地图片不需要在素材库单独显示（它们只是画布元素的缓存）
- 减少 IndexedDB 存储压力
- 避免 IndexedDB 和 Cache Storage 数据不一致

---

### 错误: 将图标组件作为 React 子元素直接渲染

**场景**: 在 `ToolButton` 或类似组件的 `icon` 属性中传递图标时，或在 JSX 中使用三元表达式选择图标时。

❌ **错误示例**:
```tsx
// 报错：Functions are not valid as a React child
<ToolButton icon={MediaLibraryIcon} />

// 三元表达式中也是错误的
<button>{locked ? LockIcon : UnlockIcon}</button>
```

✅ **正确示例**:
```tsx
// 正确：实例化组件为 React 元素
<ToolButton icon={<MediaLibraryIcon />} />

// 三元表达式中也要实例化
<button>{locked ? <LockIcon /> : <UnlockIcon />}</button>
```

**原因**: `icon` 属性通常被直接渲染（如 `{props.icon}`）。在 React 中，你可以渲染元素（Element），但不能直接渲染组件函数（Component Function）。将组件改为函数式组件（`React.FC`）后，必须使用 JSX 语法 `<Icon />` 来实例化。

**常见出错位置**: `popup-toolbar.tsx`、`size-input.tsx`、`link-button.tsx`、`app-menu-items.tsx` 等使用图标的组件。

---

### 图标组件规范: 使用 React.FC 支持 size 属性

**场景**: 定义或更新 `icons.tsx` 中的图标时。

❌ **错误示例**:
```tsx
export const MyIcon = createIcon(<svg>...</svg>);
```

✅ **正确示例**:
```tsx
export const MyIcon: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({ size = 24, ...props }) => (
  <svg width={size} height={size} {...props}>...</svg>
);
```

**原因**: 统一使用 `React.FC` 定义图标组件，可以方便地通过 `size` 属性控制尺寸，同时通过解构 `{...props}` 支持透传 `className`、`style` 等 SVG 标准属性，增强了图标的灵活性和一致性。

---

### 错误: CSS 全局规则覆盖 SVG 特定颜色

**场景**: 为图标设置特定品牌色（如 AI 工具的玫红/橙色）时。

❌ **错误示例**:
```scss
// scss 文件中
.tool-icon svg {
  stroke: currentColor !important; // 覆盖了所有内联 stroke 属性
}
```

✅ **正确示例**:
```tsx
// icons.tsx 中
<path d="..." stroke="#E91E63" /> // 在路径级别设置颜色，避免被全局 CSS 轻易覆盖
```

**原因**: 全局的 `stroke: currentColor` 规则会强制图标跟随文字颜色，导致 AI 生成等需要强调色的图标变成灰色。应移除这类过于激进的全局样式，或在图标内部路径上显式指定颜色。

---

### 错误: 筛选逻辑中“全部 (ALL)”选项导致结果为空

**场景**: 实现带有“全部 (ALL)”选项的素材库筛选逻辑时。

❌ **错误示例**:
```typescript
const matchesSource = filters.activeSource === 'ALL' || asset.source === filters.activeSource;
// 如果 filters.activeSource 初始值为 undefined，(undefined === 'ALL') 为 false，结果为空
```

✅ **正确示例**:
```typescript
const matchesSource = !filters.activeSource || filters.activeSource === 'ALL' || asset.source === filters.activeSource;
```

**原因**: 初始状态下筛选变量可能为 `undefined`。进行逻辑判断时，必须同时考虑 `undefined`、`null` 和 `'ALL'` 这几种代表“不筛选”的情况，否则会导致筛选结果意外为空。

---


## UI 交互规范

#### 媒体预览统一使用公共组件

**场景**: 需要实现图片/视频预览功能时（如任务列表、生成结果预览等）。

❌ **错误示例**:
```tsx
// 自定义 Dialog 实现预览
<Dialog visible={previewVisible} header="图片预览" width="90vw">
  <div className="preview-container">
    <Button icon={<ChevronLeftIcon />} onClick={handlePrevious} />
    <img src={previewUrl} />
    <Button icon={<ChevronRightIcon />} onClick={handleNext} />
  </div>
</Dialog>
```

✅ **正确示例**:
```tsx
import { UnifiedMediaViewer, type MediaItem } from '../shared/media-preview';

<UnifiedMediaViewer
  visible={previewVisible}
  items={mediaItems}
  initialIndex={previewIndex}
  onClose={handleClose}
  showThumbnails={true}
/>
```

**原因**: 项目已有功能完善的 `UnifiedMediaViewer` 公共组件，支持：
- 单图预览、对比预览、编辑模式
- 缩略图导航栏
- 键盘快捷键（左右箭头、Escape）
- 缩放、拖拽、全屏
- 视频同步播放

自定义实现会导致功能不一致、代码重复，且缺失公共组件已有的增强功能。

---

#### 生成结果缩略图使用 contain 完整展示

**场景**: 展示 AI 生成的图片/视频缩略图时（任务队列、生成历史、预览缩略图等）。

❌ **错误示例**:
```scss
.thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover; // 裁切图片，可能丢失重要内容
}
```

✅ **正确示例**:
```scss
.thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: contain; // 完整展示图片
}
```

**原因**: AI 生成的图片内容完整性很重要，用户需要看到完整的生成结果才能判断质量。使用 `cover` 会裁切图片边缘，可能导致：
- 宫格图部分格子被裁切
- 竖版/横版图片重要内容被裁切
- 用户无法准确评估生成效果

**例外情况**: 以下场景可以使用 `cover`：
- 用户上传的参考图片（用户已知图片内容）
- 角色头像（圆形需要填充）
- 聊天消息中的图片

---

#### 小图应提供 hover 大图预览

**场景**: 展示缩略图（尤其是 AI 生成结果的小图）时。

❌ **错误示例**:
```tsx
// 只有小图，没有预览
<div className="thumbnail">
  <img src={image.url} alt={image.name} />
</div>
```

✅ **正确示例**:
```tsx
const [hoveredImage, setHoveredImage] = useState<{ url: string; x: number; y: number } | null>(null);

<div
  className="thumbnail"
  onMouseEnter={(e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredImage({ url: image.url, x: rect.left + rect.width / 2, y: rect.top - 10 });
  }}
  onMouseLeave={() => setHoveredImage(null)}
>
  <img src={image.url} alt={image.name} />
</div>

{/* Hover 预览通过 Portal 渲染到 body */}
{hoveredImage && ReactDOM.createPortal(
  <div
    className="hover-preview"
    style={{ left: hoveredImage.x, top: hoveredImage.y, transform: 'translate(-50%, -100%)' }}
  >
    <img src={hoveredImage.url} alt="Preview" />
  </div>,
  document.body
)}
```

**原因**: 缩略图尺寸较小，用户难以判断图片细节。提供 hover 大图预览可以：
- 快速查看图片细节，无需点击打开预览弹窗
- 提升用户体验，减少操作步骤
- 方便用户快速对比多张图片

---

#### Tooltip 样式统一规范

**场景**: 在项目中使用 TDesign 的 `Tooltip` 组件时。

❌ **错误示例**:
```tsx
<Tooltip content="提示文字">
  <Button icon={<Icon />} />
</Tooltip>
```

✅ **正确示例**:
```tsx
<Tooltip content="提示文字" theme="light" showArrow={false}>
  <Button icon={<Icon />} />
</Tooltip>
```

**原因**: 为了保持项目视觉风格的高度统一，所有 Tooltip 必须使用 `theme="light"`（白底黑字）。同时，为了界面更简洁，推荐在图标按钮或紧凑列表项上使用 `showArrow={false}` 隐藏箭头。

#### 高层级容器中的 Tooltip 遮挡问题

**场景**: 在使用 `createPortal` 渲染的弹窗、下拉菜单或设置了极高 `zIndex` 的容器内部使用 `Tooltip` 时。

❌ **错误示例**:
```tsx
// 在 zIndex: 10000 的下拉菜单中
<Tooltip content="状态提示">
  <div className="status-dot" />
</Tooltip>
// 结果：Tooltip 被挡在下拉菜单下面，看不见
```

✅ **正确示例**:
```tsx
<Tooltip content="状态提示" theme="light" zIndex={20000}>
  <div className="status-dot" />
</Tooltip>
```

**原因**: 项目中部分浮层（如模型选择下拉）使用了 `createPortal` 且 `zIndex` 达到 10000。默认层级的 `Tooltip` 会被遮挡。在这种情况下，必须显式将 `Tooltip` 的 `zIndex` 提升到更高（如 20000）以确保可见。

#### 信号/状态展示的量化表意

**场景**: 展示模型健康度、网络信号等需要量化感知的状态时。

❌ **错误示例**:
使用单一圆点或方块，仅靠颜色区分。用户难以感知“程度”的差异。

✅ **正确示例**:
使用“信号格”或“进度条”设计，配合颜色变化。
- 3 格绿色：极佳
- 2 格橙色：一般
- 1 格红色：极差

**原因**: 相比单一的圆点，信号格能更直观地传达“量”的概念，符合用户的直觉认知（如手机信号、WiFi 强度）。

### 可点击容器模式：扩大交互区域

**场景**: 当 checkbox、按钮等小型交互元素嵌套在容器中时，用户期望点击整个容器都能触发操作。

❌ **错误示例**:
```tsx
// 只有点击 checkbox 本身才能触发
<div className="selection-info">
  <Checkbox checked={isAllSelected} onChange={toggleSelectAll} />
  <span>{selectedCount}</span>
</div>
```

```scss
.selection-info {
  // 没有任何点击相关样式
}
```

✅ **正确示例**:
```tsx
// 点击整个容器都能触发
<div
  className="selection-info"
  onClick={toggleSelectAll}
  role="button"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSelectAll();
    }
  }}
>
  <Checkbox checked={isAllSelected} />  {/* 移除 onChange，由父容器处理 */}
  <span>{selectedCount}</span>
</div>
```

```scss
.selection-info {
  cursor: pointer;
  user-select: none;
  
  &:active {
    background: #cbd5e1;  // 按压反馈
  }
  
  .t-checkbox {
    pointer-events: none;  // 禁用子元素直接点击，让父容器统一处理
  }
}
```

**关键点**:
- 父容器添加 `onClick`、`role="button"`、`tabIndex={0}` 和键盘支持
- 子元素使用 `pointer-events: none` 禁用直接点击
- 添加 `cursor: pointer` 和 `:active` 反馈

---

### Shift 连选时防止文本被选中

**场景**: 实现列表/网格的多选功能时，用户使用 Shift 键连选会触发浏览器默认的文本选择行为。

❌ **错误示例**:
```scss
.list-item {
  cursor: pointer;
  // 没有禁用文本选择，Shift+Click 时文字会被选中高亮
}
```

```tsx
// 用户 Shift+Click 连选时，列表项的文字被蓝色高亮选中
const handleClick = (id: string, event: React.MouseEvent) => {
  if (event.shiftKey) {
    // 执行连选逻辑
    selectRange(lastSelectedId, id);
  }
};
```

✅ **正确示例**:
```scss
.list-item {
  cursor: pointer;
  user-select: none; // 防止 Shift 连选时文本被选中
}
```

```tsx
// Shift+Click 时只执行连选逻辑，不会选中文字
const handleClick = (id: string, event: React.MouseEvent) => {
  if (event.shiftKey && lastSelectedId) {
    selectRange(lastSelectedId, id);
    return;
  }
  toggleSelection(id);
  lastSelectedIdRef.current = id;
};
```

**原因**: 浏览器默认行为是 Shift+Click 选中两次点击之间的所有文本。在实现自定义多选功能时，需要通过 `user-select: none` 禁用这一行为，否则用户会看到文本被选中的蓝色高亮，影响交互体验。

---

### 筛选与选中状态联动

**场景**: 实现带筛选功能的列表选择时，选中状态应与筛选结果联动。

❌ **错误示例**:
```tsx
// 选中数量始终显示总选中数，不考虑筛选
<span>{selectedAssetIds.size}</span>

// 删除按钮也基于总选中数
<Button disabled={selectedAssetIds.size === 0} />

// 删除操作删除所有选中项，包括不在当前筛选结果中的
const handleDelete = () => {
  deleteAssets(Array.from(selectedAssetIds));
};
```

✅ **正确示例**:
```tsx
// 计算当前筛选结果中被选中的数量
const filteredSelectedCount = useMemo(() => {
  return filteredResult.assets.filter(asset => selectedAssetIds.has(asset.id)).length;
}, [filteredResult.assets, selectedAssetIds]);

// 显示筛选后的选中数量
<span>{filteredSelectedCount}</span>

// 按钮状态基于筛选后的选中数量
<Button disabled={filteredSelectedCount === 0} />

// 操作只影响当前筛选结果中被选中的项
const handleDelete = () => {
  const filteredSelectedAssets = filteredResult.assets.filter(a => selectedAssetIds.has(a.id));
  deleteAssets(filteredSelectedAssets.map(a => a.id));
};
```

**核心原则**:
- **显示**：选中计数基于筛选后的结果
- **全选**：只选中/取消当前筛选结果
- **操作**：删除、下载等只影响筛选后被选中的项
- **按钮状态**：disabled 基于筛选后的选中数量

---

### 全局组件配色统一

**场景**: 项目使用第三方 UI 库（如 TDesign）时，需要统一覆盖组件样式以符合品牌规范。

❌ **错误示例**:
```scss
// 在多个组件文件中分散覆盖
// AssetItem.scss
.asset-item .t-checkbox.t-is-checked .t-checkbox__input {
  background: $brand-orange;
}

// MediaLibraryGrid.scss
.media-library-grid .t-checkbox.t-is-checked .t-checkbox__input {
  background: $brand-orange;
}

// OtherComponent.scss
.other .t-checkbox.t-is-checked .t-checkbox__input {
  background: $brand-orange;  // 重复代码，且容易遗漏
}
```

✅ **正确示例**:
```scss
// 在 tdesign-theme.scss 中集中覆盖
/* 全局 Checkbox 样式覆盖 - 橙色背景 + 白色勾选图标 */
.t-checkbox {
  &.t-is-checked,
  &.t-is-indeterminate {
    .t-checkbox__input {
      background-color: var(--td-brand-color) !important;
      border-color: var(--td-brand-color) !important;
    }
  }

  .t-checkbox__input {
    &::after {
      border-color: #fff !important;  // 确保勾选图标为白色
    }
  }
}
```

**最佳实践**:
- 在 `styles/tdesign-theme.scss` 中集中管理所有第三方组件的品牌色覆盖
- 使用 CSS 变量（如 `--td-brand-color`）保持一致性
- 组件级别的样式文件只处理布局和特殊场景，不重复颜色定义
- 确保 checked、indeterminate、hover、active 等所有状态都被覆盖

---

### React 加载状态规范

#### 避免 Suspense 导致的布局抖动

**场景**: 使用 `React.lazy` 和 `Suspense` 加载组件时，如果 fallback 占位符的高度与加载后的真实内容差异巨大，会导致页面布局发生剧烈的跳动。

❌ **错误示例**:
```tsx
// 错误：fallback 只有 16px 高，加载后内容有 500px 高
<Suspense fallback={<div className="spinner" />}>
  <ChatMessagesArea />
</Suspense>
```

✅ **正确示例**:
```tsx
// 正确：使用撑满容器或固定高度的 fallback
<Suspense fallback={
  <div className="loading-container--full">
    <div className="spinner" />
  </div>
}>
  <ChatMessagesArea />
</Suspense>

// SCSS
.loading-container--full {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**原因**: 布局抖动（Layout Shift）严重影响用户体验和视觉稳定性。Fallback 应尽可能模拟加载后的布局尺寸。

---

### API 与任务处理规范

#### 优先使用结构化数据而非字符串解析

**场景**: 在 UI 组件中展示复杂的业务数据（如 AI 生成消息中的模型、参数、上下文）时。

❌ **错误示例**:
```typescript
// 错误：通过解析拼接后的字符串来提取参数
const metaTags = textContent.split('\n').filter(line => line.startsWith('模型:'));
```

✅ **正确示例**:
```typescript
// 正确：在数据模型中直接存储结构化对象
interface ChatMessage {
  id: string;
  content: string;
  aiContext?: {
    model: string;
    params: Record<string, any>;
  };
}

// UI 渲染时优先读取结构化数据
const model = message.aiContext?.model || parseFallback(message.content);
```

**原因**: 字符串解析极其脆弱，容易因文案微调、语言切换或历史数据格式不一而失效。结构化数据是唯一可靠的真相来源。

#### 日志记录应反映实际发送的数据

**场景**: 在调用外部 API 前记录请求参数用于调试（如 `/sw-debug.html` 的 LLM API 日志），数据在发送前经过了处理（如图片裁剪、压缩）。

❌ **错误示例**:
```typescript
// 错误：在数据处理前收集日志信息
const referenceImageInfos = await Promise.all(
  refUrls.map(url => getImageInfo(url))  // 获取原始图片信息
);

// 后续处理会改变图片
for (const url of refUrls) {
  let blob = await fetchImage(url);
  blob = await cropImageToAspectRatio(blob, targetWidth, targetHeight);  // 裁剪
  formData.append('input_reference', blob);
}

// 日志记录的是裁剪前的尺寸，与实际发送的不符！
startLLMApiLog({ referenceImages: referenceImageInfos });
```

✅ **正确示例**:
```typescript
// 正确：在数据处理后收集日志信息
const referenceImageInfos: ImageInfo[] = [];

for (const url of refUrls) {
  let blob = await fetchImage(url);
  blob = await cropImageToAspectRatio(blob, targetWidth, targetHeight);  // 裁剪
  
  // 获取处理后的图片信息用于日志
  const info = await getImageInfo(blob);
  referenceImageInfos.push(info);
  
  formData.append('input_reference', blob);
}

// 日志记录的是实际发送的数据
startLLMApiLog({ referenceImages: referenceImageInfos });
```

**原因**: 调试日志的价值在于准确记录实际发送给 API 的数据。如果日志记录的是处理前的数据，当 API 返回错误（如"图片尺寸不匹配"）时，日志显示的尺寸与实际不符，会严重误导排查方向。

#### 外部 API 调用频率控制

**场景**: 调用外部服务的低频刷新接口（如每 5 分钟刷新一次的状态接口），多个组件可能同时触发请求。

❌ **错误示例**:
```typescript
// 错误：直接导出函数，每次调用都发起请求
export async function fetchHealthData(): Promise<Data[]> {
  const response = await fetch(API_URL);
  return response.json();
}

// 多个组件同时调用会产生重复请求
// ComponentA: fetchHealthData()
// ComponentB: fetchHealthData()  // 同时发起第二个请求
```

✅ **正确示例**:
```typescript
// 正确：使用单例控制调用频率和并发
class HealthDataFetcher {
  private static instance: HealthDataFetcher;
  private cachedData: Data[] = [];
  private lastFetchTime = 0;
  private pendingFetch: Promise<Data[]> | null = null;
  
  static getInstance() {
    if (!this.instance) this.instance = new HealthDataFetcher();
    return this.instance;
  }

  async fetch(force = false): Promise<Data[]> {
    // 1. 检查最小调用间隔（如 1 分钟）
    if (!force && Date.now() - this.lastFetchTime < 60_000) {
      return this.cachedData;
    }
    // 2. 复用进行中的请求（防并发）
    if (this.pendingFetch) return this.pendingFetch;
    // 3. 发起新请求
    this.pendingFetch = this.doFetch();
    try { return await this.pendingFetch; }
    finally { this.pendingFetch = null; }
  }
}

export const healthDataFetcher = HealthDataFetcher.getInstance();
```

**原因**: 外部接口数据通常有刷新周期（如 5 分钟），在刷新周期内重复请求是浪费。单例模式可以：1) 设置最小调用间隔避免频繁请求；2) 复用进行中的 Promise 防止并发请求；3) 统一管理缓存，所有调用方共享数据。

#### 无效配置下的数据不应被持久化或执行

**场景**: 用户在未配置 API Key 时创建了任务，后来配置了 API Key，这些旧任务不应被执行。

❌ **错误示例**:
```typescript
// 错误：initialize 时直接恢复所有 PENDING 任务
async initialize(config: Config): Promise<void> {
  this.config = config;
  this.initialized = true;
  
  // 恢复并执行所有 PENDING 任务（包括无效配置时创建的）
  for (const task of this.tasks.values()) {
    if (task.status === TaskStatus.PENDING) {
      this.executeTask(task);  // ❌ 执行了"孤儿任务"
    }
  }
}
```

✅ **正确示例**:
```typescript
// 正确：首次初始化时清除无效配置下创建的任务
private hadSavedConfig = false;

async restoreFromStorage(): Promise<void> {
  const { config } = await storage.loadConfig();
  if (config) {
    this.hadSavedConfig = true;  // 标记有保存的配置
  }
}

async initialize(config: Config): Promise<void> {
  // 首次初始化时清除"孤儿任务"
  if (!this.hadSavedConfig) {
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.PENDING) {
        await storage.deleteTask(task.id);  // ✅ 清除无效任务
      }
    }
  }
  this.hadSavedConfig = true;
  // ... 继续正常初始化
}
```

**原因**: 无效配置（如缺少 API Key）下创建的任务是"孤儿数据"，不应在后续有效配置时被执行。通过 `hadSavedConfig` 标志区分"首次初始化"和"恢复已有配置"，确保只有在有效配置下创建的任务才会被执行。

---

### 模块导入规范

#### 同名模块的全局状态隔离问题

**场景**: 项目中存在多个同名模块（如 `canvas-insertion.ts`），各自维护独立的全局变量（如 `boardRef`）。

❌ **错误示例**:
```typescript
// MediaViewport.tsx - 错误：从 mcp/tools 导入
import { quickInsert } from '../../../mcp/tools/canvas-insertion';
// 但 boardRef 是在 services/canvas-operations 版本中被设置的
// 导致 "画布未初始化" 错误
```

✅ **正确示例**:
```typescript
// MediaViewport.tsx - 正确：从 services/canvas-operations 导入
import { quickInsert } from '../../../services/canvas-operations';
// 与 AIInputBar.tsx 中 setCanvasBoard 设置的是同一个 boardRef
```

**原因**: 项目中 `mcp/tools/canvas-insertion.ts` 和 `services/canvas-operations/canvas-insertion.ts` 是两个独立模块，各自有独立的 `boardRef` 变量。`AIInputBar` 只设置了 `services` 版本的 `boardRef`，所以必须从 `services/canvas-operations` 导入才能正确访问已初始化的 board。

---

### 坐标变换场景的一致性处理

#### 翻转状态下的鼠标交互

**场景**: 当元素支持翻转（flipH/flipV）或旋转时，基于鼠标位移计算的逻辑（如拖拽裁剪框、调整大小）需要根据变换状态调整方向。

❌ **错误示例**:
```typescript
// 错误：未考虑翻转状态，翻转后拖拽方向和鼠标移动方向相反
const handleMouseMove = (e: MouseEvent) => {
  const deltaX = (e.clientX - dragStart.x) / scale;
  const deltaY = (e.clientY - dragStart.y) / scale;
  
  // 直接使用 delta，翻转后方向错误
  newCrop.x = initialCrop.x + deltaX;
  newCrop.y = initialCrop.y + deltaY;
};
```

✅ **正确示例**:
```typescript
// 正确：根据翻转状态调整 delta 方向
const handleMouseMove = (e: MouseEvent) => {
  let deltaX = (e.clientX - dragStart.x) / scale;
  let deltaY = (e.clientY - dragStart.y) / scale;
  
  // 翻转后需要反转 delta 方向
  if (flipH) deltaX = -deltaX;
  if (flipV) deltaY = -deltaY;
  
  newCrop.x = initialCrop.x + deltaX;
  newCrop.y = initialCrop.y + deltaY;
};
```

**原因**: 图片翻转后，视觉上的坐标系发生了变化。水平翻转后鼠标向右移动在视觉上是向左，垂直翻转后鼠标向下移动在视觉上是向上。

#### 翻转状态下的 cursor 样式

**场景**: 调整大小的控制点需要显示正确的 cursor 方向指示。

❌ **错误示例**:
```tsx
// 错误：cursor 样式写死在 CSS 中，翻转后方向不对
<div className="handle--nw" /> // cursor: nw-resize（固定）
```

✅ **正确示例**:
```tsx
// 正确：根据翻转状态动态计算 cursor
const getCursorForHandle = (handle: string): string => {
  let adjusted = handle;
  if (flipH) adjusted = adjusted.replace('w', 'e').replace('e', 'w');
  if (flipV) adjusted = adjusted.replace('n', 's').replace('s', 'n');
  return `${adjusted}-resize`;
};

<div 
  className="handle--nw" 
  style={{ cursor: getCursorForHandle('nw') }}
/>
```

**原因**: 翻转后控制点的视觉位置改变了，例如原本在左上角的 nw 控制点，水平翻转后在视觉上变成了右上角，cursor 应该显示为 `ne-resize` 而非 `nw-resize`。

---

### UI 图标库规范

#### 验证 TDesign 图标库导出名称

**场景**: 使用 `tdesign-icons-react` 库中的图标时。

❌ **错误示例**:
```typescript
import { RobotIcon, NumberIcon } from 'tdesign-icons-react'; 
// 错误：这两个图标在库中并不存在，会导致运行时报错
```

✅ **正确示例**:
```typescript
import { ServiceIcon, BulletpointIcon } from 'tdesign-icons-react';
// 正确：使用库中实际存在的相近图标
```

**原因**: `tdesign-icons-react` 的图标导出名称有时与直觉不符（例如没有 `RobotIcon` 而是 `ServiceIcon`）。在引入新图标前务必通过 IDE 补全功能验证其存在。

---

---

### React 加载状态规范

#### 避免 Suspense 导致的布局抖动

**场景**: 使用 `React.lazy` 和 `Suspense` 加载组件时，如果 fallback 高度与实际内容差异巨大，会导致页面跳动。

❌ **错误示例**:
```tsx
// 错误：fallback 只有一行文字高度，加载后容器瞬间撑开
<Suspense fallback={<div>加载中...</div>}>
  <ChatMessagesArea />
</Suspense>
```

✅ **正确示例**:
```tsx
// 正确：fallback 撑满容器或具有固定高度
<Suspense fallback={<div className="chat-loading--full"><Spinner /></div>}>
  <ChatMessagesArea />
</Suspense>

// CSS
.chat-loading--full {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**原因**: 布局抖动（Layout Shift）严重影响用户体验，通过为加载状态预留空间可以保持视觉稳定性。

---

### API 与任务处理规范

#### 优先使用结构化数据而非字符串解析

**场景**: 在 UI 层展示复杂信息（如 AI 生成参数）时。

❌ **错误示例**:
```typescript
// 错误：通过正则或 split 解析拼接好的显示文本
const parts = textContent.split(' 模型: ');
const modelId = parts[1]?.trim();
```

✅ **正确示例**:
```typescript
// 正确：在数据源头保留结构化 Context
const userChatMsg = {
  role: 'user',
  textContent: '...',
  aiContext: context, // 存储原始对象
};

// UI 直接读取
const modelId = chatMessage.aiContext?.model?.id;
```

**原因**: 字符串解析极其脆弱，格式微调会导致解析失败；结构化数据提供类型安全且更易维护。

---

### UI 图标库规范

#### 验证 TDesign 图标库导出名称

**场景**: 使用 `tdesign-icons-react` 引入新图标时。

❌ **错误示例**:
```tsx
import { NumberIcon, RobotIcon } from 'tdesign-icons-react'; 
// ❌ 报错：这些名称在库中不存在，导致应用崩溃
```

✅ **正确示例**:
```tsx
import { BulletpointIcon, ServiceIcon } from 'tdesign-icons-react';
// ✅ 使用前先验证库中实际存在的导出名称
```

**原因**: TDesign 图标库命名不一定符合直觉，使用不存在的导出名会触发 `SyntaxError` 导致白屏。

---

## E2E 测试规范

### Playwright 元素选择器精度

**场景**: 选择工具栏按钮时，需要获取完整的可点击区域而非内部小元素。

❌ **错误示例**:
```typescript
// 错误：getByRole('radio') 选择 13x13px 的 input 元素
const toolBtn = toolbar.locator('div').filter({ 
  has: page.getByRole('radio', { name: /画笔/ }) 
});
// 实际选中的是内部的 radio input，而非外层按钮容器
```

✅ **正确示例**:
```typescript
// 正确：使用 label 选择器获取完整的按钮容器 (40x36px)
const toolBtn = toolbar.locator('label').filter({ 
  has: page.getByRole('radio', { name: /画笔/ }) 
});
```

**原因**: `getByRole('radio')` 会匹配到隐藏的 input 元素，其尺寸通常很小。使用 `label` 选择器可以获取实际的可点击区域。

### CSS 定位避免内容截断

**场景**: 为元素添加标签/提示文字时，定位方式可能导致内容被截断。

❌ **错误示例**:
```css
/* 错误：使用 right + transform 定位，容易被父容器截断 */
.label {
  position: absolute;
  right: -10px;
  transform: translate(100%, -50%);
}
```

✅ **正确示例**:
```css
/* 正确：使用 left: 100% + margin，内容不会被截断 */
.label {
  position: absolute;
  left: 100%;
  margin-left: 8px;
  transform: translateY(-50%);
}
```

**原因**: `right` 配合 `transform: translate(100%)` 会使元素超出父容器边界，如果父容器有 `overflow: hidden` 则内容被截断。

### 避免过度复杂的自动化系统

**场景**: 设计自动化工具（如 GIF 录制、截图生成）时的架构决策。

❌ **错误做法**:
- 设计复杂的 DSL 系统（JSON 定义 + 执行器 + 时间戳裁剪）
- 录制一个长视频然后按时间点裁剪多个 GIF
- 尝试用一套配置生成所有内容

✅ **正确做法**:
- 每个 GIF 使用独立的测试录制
- 简单的命令行参数控制（如 `--trim 2.4`）
- 一个命令完成一个任务（如 `pnpm manual:gif:mindmap`）

**原因**: 
1. 长视频裁剪会带来"旧信息污染"（前一个操作残留影响后一个）
2. DSL 元素选择器难以处理动态 UI 的时序问题
3. 简单方案更易调试和维护，复杂系统的调试成本远超收益

### 定期清理未使用代码

**场景**: 功能开发过程中会产生实验性代码和辅助文件。

**检查项**:
```bash
# 查看未跟踪文件
git status --short | grep "^??"

# 检查文件是否被导入
grep -r "from.*filename" apps/ packages/
```

**常见可清理的文件**:
- 未使用的 fixture 文件（如 `test-data.ts`）
- 重复功能的测试文件（如多个 visual spec 覆盖相同功能）
- 错误创建的目录结构
- 过时的文档（引用已删除代码的 md 文件）

**原因**: 未清理的代码会增加维护负担，误导后续开发者，也会增加 CI 执行时间。

### Clipper 布尔运算结果处理

**场景**: 使用 clipper-lib 进行多边形布尔运算（合并、减去、相交等）后，需要区分外环和孔洞。

❌ **错误做法**:
```typescript
// 错误：依赖面积符号判断外环/孔洞
const outerRing = pathsWithArea.find(p => p.signedArea > 0);
const holes = pathsWithArea.filter(p => p.signedArea < 0);
```

✅ **正确做法**:
```typescript
// 正确：用面积大小判断，最大的是外环，其他是孔洞
const sortedByArea = [...pathsWithArea].sort((a, b) => b.absArea - a.absArea);
const outerRing = sortedByArea[0]; // 面积最大的是外环
const holes = sortedByArea.slice(1); // 其他都是孔洞
```

**原因**: 
1. Clipper 返回的路径方向（顺时针/逆时针）取决于坐标系（Y 轴向上还是向下）
2. 在不同环境下，面积符号可能相反，导致孔洞被错误识别为外环
3. 面积大小是稳定的判断依据：外环总是包含所有孔洞，因此面积最大

**相关文件**: `packages/drawnix/src/transforms/precise-erase.ts`, `packages/drawnix/src/transforms/boolean.ts`

### Slate-React Leaf 组件 DOM 结构必须保持稳定

**场景**: 在 Slate-React 的 Leaf 组件中实现文本样式（如下划线、删除线）时

❌ **错误做法**:
```tsx
// 错误：根据条件动态切换 HTML 标签和 CSS 实现方式
const Leaf = ({ children, leaf, attributes }) => {
  const hasCustomStyle = leaf['text-decoration-style'];
  
  // 当样式变化时，DOM 结构会从 <u>...</u> 变成 <span style={...}>...</span>
  if (leaf.underlined && !hasCustomStyle) {
    children = <u>{children}</u>;  // 有时用标签
  }
  
  const style = {};
  if (leaf.underlined && hasCustomStyle) {
    style.textDecoration = 'underline';  // 有时用 CSS
  }
  
  return <span style={style} {...attributes}>{children}</span>;
};
// 报错：Cannot resolve a DOM node from Slate node
```

✅ **正确做法**:
```tsx
// 正确：始终使用同一种方式实现，保持 DOM 结构稳定
const Leaf = ({ children, leaf, attributes }) => {
  const style: CSSProperties = {};
  
  // 统一使用 CSS 实现，不使用 <u>、<s> 等标签
  if (leaf.underlined || leaf.strikethrough) {
    const decorations: string[] = [];
    if (leaf.underlined) decorations.push('underline');
    if (leaf.strikethrough) decorations.push('line-through');
    
    style.textDecoration = decorations.join(' ');
    if (leaf['text-decoration-style']) {
      style.textDecorationStyle = leaf['text-decoration-style'];
    }
  }
  
  return <span style={style} {...attributes}>{children}</span>;
};
```

**原因**: 
1. Slate-React 依赖稳定的 DOM 结构来追踪编辑器节点与 DOM 节点的映射关系
2. 当根据样式条件动态切换 HTML 标签（`<u>`）和 CSS（`text-decoration`）时，DOM 结构会发生变化
3. 这会导致 Slate 无法找到对应的 DOM 节点，抛出 "Cannot resolve a DOM node from Slate node" 错误
4. 解决方案是选择一种实现方式并始终使用，推荐使用 CSS 因为它更灵活（支持自定义样式和颜色）

**相关文件**: `packages/react-text/src/text.tsx`
