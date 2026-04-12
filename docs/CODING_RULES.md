# Opentu 编码规则详解

本文档包含项目中积累的具体编码规则和常见错误案例。这是 `CLAUDE.md` 的详细补充，当需要具体的实现指导时参考本文档。

> **注意**：本文档由 CLAUDE.md 拆分而来，包含详细的错误示例和解决方案。基础编码规范请参考 `docs/CODING_STANDARDS.md`。

---

## 目录

- [架构与重构规范](#架构与重构规范)
- [文件命名规范](#文件命名规范)
- [TypeScript 规范](#typescript-规范)
- [React 组件规范](#react-组件规范)
- [CSS/SCSS 规范](#cssscss-规范)
- [Service Worker 规范](#service-worker-规范)
- [缓存与存储规范](#缓存与存储规范)
- [API 与任务处理规范](#api-与任务处理规范)
- [Plait 插件规范](#plait-插件规范)
- [UI 交互规范](#ui-交互规范)
- [E2E 测试规范](#e2e-测试规范)
- [数据安全规范](#数据安全规范)

---

## 架构与重构规范

### 避免过度设计和不必要的抽象层

**场景**: 在重构或添加新功能时，避免引入不必要的架构模式

**核心原则**:
- 优先使用简单的 interface + service 模式
- 只在有明确需求时才添加抽象层
- 遵循 YAGNI 原则（You Aren't Gonna Need It）

❌ **错误示例 - 过度使用 DDD 模式**:
```typescript
// 错误：为简单的任务管理引入过多抽象层

// domain/task/task.ts (487 行)
export class Task {
  private constructor(...) {}  // 私有构造函数
  static create(...) {}         // 工厂方法
  start() {}                    // 状态转换方法
  complete() {}
  fail() {}
  // ... 50+ 个方法
}

// domain/task/task-repository.ts
interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  save(task: Task): Promise<void>;
}

// infrastructure/persistence/indexeddb-task-repository.ts
class IndexedDBTaskRepository implements TaskRepository {
  // 只是包装了现有的 taskStorageReader/Writer
}

// infrastructure/execution/execution-strategy.ts
interface TaskExecutionStrategy {
  execute(task: Task): Promise<TaskResult>;
}

// infrastructure/execution/sw-execution-strategy.ts
class SWExecutionStrategy implements TaskExecutionStrategy {
  // 包装了一个简单的条件判断
}

// 结果：30 个新文件，3000+ 行代码，但没有解决实际问题
```

✅ **正确示例 - 保持简单**:
```typescript
// types/task.types.ts - 简单的接口定义
export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  params: GenerationParams;
  // ... 其他字段
}

// services/task-queue-service.ts - 直接的服务实现
export class TaskQueueService {
  async createTask(params: GenerationParams): Promise<Task> {
    const task = { /* ... */ };
    await taskStorageWriter.saveTask(task);
    return task;
  }

  async executeTask(task: Task): Promise<void> {
    // 简单的条件判断，不需要 Strategy 模式
    if (shouldUseSWTaskQueue()) {
      await swTaskQueueService.createTask(task.type, task.params);
    } else {
      await taskQueueService.createTask(task.type, task.params);
    }
  }
}

// 结果：清晰、简单、易维护
```

**判断是否需要抽象层的标准**:

1. **Repository 模式**：
   - ❌ 不需要：只有一种存储实现（如只用 IndexedDB）
   - ✅ 需要：需要支持多种存储后端（IndexedDB、LocalStorage、远程 API）

2. **Strategy 模式**：
   - ❌ 不需要：只是简单的 if/else 判断（如 `if (shouldUseSW)`）
   - ✅ 需要：有 3+ 种算法需要动态切换，且逻辑复杂

3. **Factory 模式**：
   - ❌ 不需要：对象创建逻辑简单（如 `{ id, type, status }`）
   - ✅ 需要：创建逻辑复杂，需要根据类型创建不同的对象

4. **Aggregate Root**：
   - ❌ 不需要：简单的数据结构，状态转换逻辑简单
   - ✅ 需要：复杂的业务规则，需要保证不变性约束

**原因**:
- 过度设计会增加代码量和维护成本
- 抽象层会增加理解难度和调试复杂度
- 简单的问题应该用简单的方案解决
- 只在有明确需求时才引入复杂模式

---

### 删除未使用的"基础设施"代码

**场景**: 创建了"为未来准备"的代码，但实际上没有被使用

**核心原则**:
- 代码应该解决当前的实际问题
- 未使用的代码应该删除，不要"为未来预留"
- 如果未来真的需要，可以从 Git 历史恢复

❌ **错误示例 - 创建未使用的事件系统**:
```typescript
// services/app-events.ts - 创建了统一事件总线
export function publishEvent(event: AppEvent): void { }
export function subscribeToEventType<T>(type: T, handler: Function) { }

// types/events.types.ts - 定义了完整的事件类型
export interface TaskCreatedEvent extends BaseEvent { }
export interface TaskCompletedEvent extends BaseEvent { }
// ... 10+ 个事件类型

// 问题：没有任何代码使用这些文件
// grep -r "from.*app-events" 返回 0 个结果
```

✅ **正确做法 - 删除未使用的代码**:
```bash
# 检查是否有代码使用
grep -r "from.*app-events" packages/drawnix/src

# 如果没有使用，直接删除
rm src/services/app-events.ts
rm src/types/shared/events.types.ts

# 如果未来需要，可以从 Git 历史恢复
git log --all --full-history -- "**/app-events.ts"
```

**判断是否应该保留代码的标准**:

1. **有实际使用**：
   - ✅ 保留：至少有 1 处代码导入并使用
   - ❌ 删除：没有任何地方使用

2. **解决实际问题**：
   - ✅ 保留：解决了当前存在的问题
   - ❌ 删除：只是"可能有用"的基础设施

3. **维护成本**：
   - ✅ 保留：维护成本低，不会成为负担
   - ❌ 删除：需要持续维护，但没有实际价值

**原因**:
- 未使用的代码会增加维护负担
- 会让新开发者困惑（"这个是干什么的？"）
- Git 历史可以保存所有删除的代码
- YAGNI 原则：不要为未来可能的需求编写代码

---

### 重构前先问"解决什么问题"

**场景**: 在进行架构重构时，应该先明确要解决的实际问题

**核心原则**:
- 重构应该解决具体的痛点，而不是追求"更好的架构"
- 先列出当前的实际问题，再设计解决方案
- 验证重构是否真的解决了问题

❌ **错误示例 - 为了架构而重构**:
```typescript
// 问题描述："代码不够优雅，需要引入 DDD"
// 实际情况：代码工作正常，没有明确的痛点

// 重构方案：
// - 添加 domain 层（18 个文件）
// - 添加 application 层（3 个文件）
// - 添加 infrastructure 层（9 个文件）

// 结果：
// - 新增 30 个文件，3000+ 行代码
// - 原有问题没有解决
// - 引入了新的复杂度
```

✅ **正确示例 - 针对问题重构**:
```typescript
// 问题 1：类型定义在 3 处重复，需要手动同步
// 解决方案：创建共享类型文件
// 结果：删除 2 处重复定义，统一到 1 个文件

// 问题 2：DDD 层增加了 30 个文件但没有解决实际问题
// 解决方案：删除 DDD 层，回归简单的 interface + service
// 结果：删除 30 个文件，减少 3000 行代码

// 验证：
// - 类型定义只有 1 处 ✓
// - 代码量减少 ✓
// - 构建和测试通过 ✓
```

**重构前的检查清单**:

1. **明确问题**：
   - [ ] 列出当前存在的具体问题
   - [ ] 问题是否真的影响开发效率或代码质量
   - [ ] 问题是否频繁出现

2. **评估方案**：
   - [ ] 方案是否直接解决问题
   - [ ] 方案是否引入新的复杂度
   - [ ] 方案的成本是否合理

3. **验证结果**：
   - [ ] 原有问题是否解决
   - [ ] 是否引入新问题
   - [ ] 代码是否更简单（文件数、行数）

**原因**:
- 架构模式不是目的，解决问题才是
- 好的架构应该让代码更简单，而不是更复杂
- 重构应该有明确的收益，而不是"看起来更好"

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

#### 枚举（enum）不能使用 import type 导入

**场景**: 当枚举既作为类型又作为运行时值使用时

❌ **错误示例**:
```typescript
// 错误：使用 type-only import 导入枚举
import type { TaskType, TaskStatus } from './types';

// 运行时错误：TaskType is not defined
const config = {
  [TaskType.IMAGE]: 10000,  // ❌ TaskType 在运行时不存在
  [TaskType.VIDEO]: 20000,
};
```

✅ **正确示例**:
```typescript
// 正确：枚举作为值使用时，必须使用普通 import
import { TaskType } from './types';

// 纯类型可以继续使用 import type
import type { TaskStatus, TaskError } from './types';

const config = {
  [TaskType.IMAGE]: 10000,  // ✅ TaskType 在运行时可用
  [TaskType.VIDEO]: 20000,
};
```

**原因**: TypeScript 的 `import type` 在编译时会被完全移除，不会产生任何运行时代码。而 `enum` 在 TypeScript 中既是类型也是值（会编译为 JavaScript 对象），当代码中使用枚举成员作为对象键或进行比较时，需要运行时存在该值。如果使用 `import type` 导入枚举，运行时会抛出 `ReferenceError: xxx is not defined`。

#### 禁止空 catch 块（必须有日志）

**场景**: 捕获异常后需要记录或处理

❌ **错误示例**:
```typescript
// 错误：静默吞掉错误，调试困难
try {
  await swChannelClient.getTask(taskId);
} catch {
  return;  // 什么都不做
}

// 错误：catch 块为空
try {
  await someOperation();
} catch {
  // 静默忽略错误
}
```

✅ **正确示例**:
```typescript
// 正确：至少记录 debug 级别日志
try {
  await swChannelClient.getTask(taskId);
} catch (error) {
  console.debug('[SWTaskQueue] getTask failed for', taskId, error);
  return;
}

// 正确：预期的错误用 warn，严重错误用 error
try {
  await criticalOperation();
} catch (error) {
  console.warn('[ModuleName] Operation failed:', error);
  return fallbackValue;
}
```

**原因**: 空 catch 块会静默吞掉错误，导致问题难以排查。即使是预期的错误（如网络超时），也应记录 debug 级别日志，便于调试。使用 `console.debug` 可在生产环境中隐藏，但开发时能看到。

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

#### 模块循环依赖导致 TDZ 错误

**场景**: 多个服务模块相互导入，形成循环依赖链，导致 ES 模块初始化时的 TDZ (Temporal Dead Zone) 错误

❌ **错误示例**:
```typescript
// task-queue/index.ts - 导入 sw-task-queue-service
import { swTaskQueueService } from '../sw-task-queue-service';
export function shouldUseSWTaskQueue() { ... }
export { swTaskQueueService };

// sw-task-queue-service.ts - 导入 sw-channel/client
import { swChannelClient } from './sw-channel';
export const swTaskQueueService = SWTaskQueueService.getInstance();

// sw-channel/client.ts - 导入 task-queue（循环！）
import { shouldUseSWTaskQueue } from '../task-queue';  // ❌ 循环依赖
export const swChannelClient = SWChannelClient.getInstance();

// 结果：Uncaught ReferenceError: Cannot access 'swChannelClient' before initialization
```

```typescript
// chat-workflow-client.ts
const checkAndSubscribe = () => {
  // ❌ ES 模块环境不支持 CommonJS require
  const { swChannelClient: client } = require('./client');
};
// 结果：Uncaught ReferenceError: require is not defined
```

✅ **正确示例**:
```typescript
// 1. 将共享函数提取到独立的隔离模块
// task-queue/sw-detection.ts - 不导入任何服务模块
export function shouldUseSWTaskQueue(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  return true;
}

// 2. 服务文件从隔离模块导入
// sw-channel/client.ts
import { shouldUseSWTaskQueue } from '../task-queue/sw-detection';  // ✅ 无循环

// 3. 使用服务注册表延迟服务访问
// task-queue/service-registry.ts - 不导入任何服务模块
export const serviceRegistry = {
  swTaskQueueService: null,
  legacyTaskQueueService: null,
};
export function registerService(name, service) {
  serviceRegistry[name] = service;
}

// 4. 服务创建后注册到注册表
// sw-task-queue-service.ts
export const swTaskQueueService = SWTaskQueueService.getInstance();
import { registerService } from './task-queue/service-registry';
registerService('swTaskQueueService', swTaskQueueService);

// 5. 入口文件使用 Proxy 延迟访问
// task-queue/index.ts
import { serviceRegistry } from './service-registry';
export const taskQueueService = new Proxy({}, {
  get(_target, prop) {
    const service = shouldUseSWTaskQueue() 
      ? serviceRegistry.swTaskQueueService 
      : serviceRegistry.legacyTaskQueueService;
    return service[prop];
  },
});

// 6. 单例构造函数中延迟访问其他模块
// sw-task-queue-service.ts
private constructor() {
  // ✅ 使用 queueMicrotask 延迟，等待其他模块初始化完成
  queueMicrotask(() => {
    this.setupSWClientHandlers();  // swChannelClient 此时已初始化
  });
}
```

**原因**: ES 模块是静态解析的，循环依赖会导致某些模块在被访问时尚未完成初始化。解决方案是将共享代码提取到独立模块（打破依赖链），并使用延迟访问模式（Proxy、queueMicrotask）。

**相关文件**:
- `packages/drawnix/src/services/task-queue/sw-detection.ts` - 隔离的检测函数
- `packages/drawnix/src/services/task-queue/service-registry.ts` - 服务注册表
- `packages/drawnix/src/services/task-queue/index.ts` - 使用 Proxy 的入口

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

#### 工具函数组织与导入

**场景**: 项目中有通用工具函数需要在多个包之间共享

❌ **错误示例**:
```typescript
// packages/drawnix/src/utils/common.ts
// 错误：在业务包中二次导出通用函数
import { generateId, sanitizeObject } from '@aitu/utils';
export { generateId, sanitizeObject };  // ❌ 二次导出

// packages/drawnix/src/services/some-service.ts
// 错误：从业务包导入通用函数
import { generateId } from '../utils/common';  // ❌ 间接导入
```

✅ **正确示例**:
```typescript
// packages/drawnix/src/services/some-service.ts
// 正确：直接从 @aitu/utils 导入
import { generateId, sanitizeObject } from '@aitu/utils';  // ✅ 直接导入

// packages/drawnix/src/utils/common.ts
// 正确：只保留业务特有的函数
import { IS_APPLE, PlaitBoard, toImage } from '@plait/core';

export const boardToImage = (board: PlaitBoard) => {  // ✅ Plait 特有
  return toImage(board, { fillStyle: 'transparent' });
};
```

**原因**:
- 二次导出会造成依赖链混乱，增加包体积
- 修改工具函数时难以追踪所有使用位置
- 直接导入语义更清晰，IDE 跳转更准确

**`@aitu/utils` 包含的通用函数**:
- ID 生成：`generateId()`, `generateUUID()`
- 日期格式化：`formatDate()`, `formatDuration()`, `formatFileSize()`
- DOM 操作：`download()`, `copyToClipboard()`
- 安全工具：`sanitizeObject()`, `sanitizeUrl()`, `sanitizeRequestBody()`, `getSafeErrorMessage()`
- 字符串处理：`truncate()`, `capitalize()`, `toKebabCase()`
- 异步工具：`debounce()`, `throttle()`
- Blob 转换：`blobToBase64()`, `pureBase64ToBlob()`, `dataUrlToBlob()`, `blobToDataUrl()`
- 设备信息：`getDeviceId()`, `getDeviceName()`, `getDeviceType()`
- 格式化：`formatSize()`, `formatDurationMs()`, `formatPercent()`, `formatRelativeTime()`
- IndexedDB：`openIndexedDB()`, `getById()`, `getAll()`, `getAllWithCursor()`, `put()`, `deleteById()`

#### 避免不必要的函数包装/别名

**场景**: 导入工具函数后，创建了一个简单包装函数

❌ **错误示例**:
```typescript
import { truncate, sanitizeRequestBody as sanitizeBody } from '@aitu/utils';

// 错误：不必要的包装，没有添加任何功能
const truncateText = (text: string, maxLength: number) => truncate(text, maxLength);
const sanitizeRequestBody = sanitizeBody;

// 使用
log.prompt = truncateText(prompt, 2000);
log.body = sanitizeRequestBody(body);
```

✅ **正确示例**:
```typescript
import { truncate, sanitizeRequestBody } from '@aitu/utils';

// 正确：直接使用导入的函数
log.prompt = truncate(prompt, 2000);
log.body = sanitizeRequestBody(body);
```

**原因**:
- 不必要的包装增加了代码量和阅读负担
- 在调用链中增加了一层，调试时更难追踪
- 如果确实需要别名，使用 `import { x as y }` 语法即可

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

#### 跨 React Root 状态共享：useSyncExternalStore

**场景**: 需要从主应用向 Plait 文本组件（`react-text` 的 `Text`）传递状态时（如搜索高亮关键词）

Plait 框架通过 `createRoot` 将每个文本组件渲染在独立的 React 树中（见 `react-board/src/plugins/with-react.tsx`），React Context 无法穿透这些独立 Root。

❌ **错误示例**:
```typescript
// ❌ 错误：在主应用提供 Context，期望 Text 组件能消费
// 主应用
<SearchContext.Provider value={query}>
  <Board /> {/* Board 内的文本通过 createRoot 渲染，无法访问此 Context */}
</SearchContext.Provider>

// react-text/text.tsx
const query = useContext(SearchContext); // 永远是 undefined
```

✅ **正确示例**:
```typescript
// ✅ 正确：使用 useSyncExternalStore + 模块级 store 实现跨 Root 状态共享
// search-highlight.ts
let searchQuery = '';
const listeners = new Set<() => void>();

export function setSearchHighlightQuery(query: string) {
  if (searchQuery === query) return;
  searchQuery = query;
  listeners.forEach(listener => listener());
}

export function useSearchHighlightQuery(): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => searchQuery,
    () => searchQuery,
  );
}

// text.tsx - 在独立 React Root 中也能正确订阅
const query = useSearchHighlightQuery(); // ✅ 正常工作
```

**原因**: `createRoot` 创建的 React 树是完全独立的，不共享父级 Context。`useSyncExternalStore` 订阅模块级全局 store，不依赖 React 树结构，因此能跨 Root 工作。此模式适用于所有需要从主应用向 Plait 文本组件传递状态的场景。

### RxJS 事件传递对象引用导致 React.memo 失效

**场景**: Service 层通过 RxJS Subject 推送任务更新事件，多个 React 组件通过不同方式消费（增量替换 vs 全量快照），但 `TaskItem` 共用同一个 `React.memo` 自定义比较

❌ **错误示例**:
```typescript
// Service: 原地修改对象再 emit
onProgress: (progress) => {
  const localTask = this.tasks.get(taskId);
  localTask.progress = progress;         // 原地修改
  localTask.updatedAt = Date.now();
  this.emitEvent('taskUpdated', localTask); // 传递同一引用
}

// Hook A（增量替换）：event.task 与数组中旧对象是同一引用
setTasks(prev => prev.map(t => t.id === event.task.id ? event.task : t));
// React.memo: prev.task === next.task（同一对象）→ 不渲染

// Hook B（全量快照）：getAllTasks() 返回 Map 中的原始对象
setTasks(taskQueueService.getAllTasks());
// React.memo: prev.task.progress === next.task.progress（同一对象，值已被改过）→ 不渲染
```

✅ **正确示例**:
```typescript
// Service: 创建新对象存入 Map 再 emit
onProgress: (progress) => {
  const localTask = this.tasks.get(taskId);
  const updatedTask = { ...localTask, progress, updatedAt: Date.now() };
  this.tasks.set(taskId, updatedTask);         // 新对象存入 Map
  this.emitEvent('taskUpdated', updatedTask);  // 新引用
}

// emitEvent 中额外浅拷贝（双保险）
private emitEvent(type, task) {
  this.taskUpdates$.next({ type, task: { ...task }, timestamp: Date.now() });
}
```

**原因**: React.memo 的自定义比较函数比较的是属性值，但如果 `prev.task` 和 `next.task` 指向同一个被原地修改的对象，所有属性比较都会返回 `true`（值已经被改过了）。必须确保每次更新都产生新的对象引用，让 `prev.task.progress !== next.task.progress` 成立。

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

#### TDesign CSS 变量优先级问题

**场景**: 在组件样式中使用 TDesign CSS 变量（如 `--td-brand-color-light`）时，发现颜色不生效或显示为默认颜色。

❌ **错误示例**:
```scss
// 在组件 scss 中使用 CSS 变量
.project-drawer-node__row {
  &--selected {
    background: var(--td-brand-color-light);  // 可能被 TDesign 内部样式覆盖
    
    &:hover {
      background: var(--td-brand-color-light-hover);  // 不生效
    }
  }
}
```

✅ **正确示例**:
```scss
// 直接使用具体颜色值
.project-drawer-node__row {
  &--selected {
    background: rgba(243, 156, 18, 0.12);  // 品牌橙金色 12% 透明度
    
    &:hover {
      background: rgba(243, 156, 18, 0.18);  // 18% 透明度
    }
  }
}
```

**原因**: TDesign 组件内部可能在更具体的选择器中定义了同名 CSS 变量的值，导致 `:root` 中的全局定义被覆盖。在组件级样式中直接使用具体颜色值可以确保样式正确生效。

**适用场景**:
- 组件内的选中/高亮/激活状态背景色
- 需要使用品牌色变体的场景（如透明度变化）
- 任何发现 CSS 变量不生效的情况

#### 弹出菜单被父容器 overflow 截断

**场景**: 在设置了 `overflow: hidden/auto` 的容器内渲染右键菜单、下拉菜单等弹出层时，菜单被截断。

❌ **错误示例**:
```tsx
// 菜单直接渲染在组件内部，被父容器 overflow 截断
return (
  <div className="drawer-content" style={{ overflow: 'auto' }}>
    {/* 内容 */}
    {contextMenu && (
      <div 
        className="context-menu"
        style={{ position: 'fixed', left: x, top: y }}
      >
        {/* 菜单项 */}
      </div>
    )}
  </div>
);
```

✅ **正确示例**:
```tsx
import { createPortal } from 'react-dom';

return (
  <div className="drawer-content" style={{ overflow: 'auto' }}>
    {/* 内容 */}
    {/* 使用 Portal 渲染到 body，避免被截断 */}
    {contextMenu && createPortal(
      <div 
        className="context-menu"
        style={{ position: 'fixed', left: x, top: y, zIndex: 10000 }}
      >
        {/* 菜单项 */}
      </div>,
      document.body
    )}
  </div>
);
```

**原因**: 即使使用 `position: fixed`，如果元素在 DOM 树中位于设置了 `overflow: hidden` 的容器内部，该容器仍然会裁切超出其边界的内容。使用 `createPortal` 将弹出层渲染到 `document.body`，使其脱离原有容器的裁切上下文。

**适用场景**:
- 右键菜单
- 自定义下拉菜单
- 悬浮预览框
- 任何需要显示在容器边界外的浮层

### Git 提交规范
- 格式: `<type>(<scope>): <subject>`
- 类型: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`

### 重要规则
- **UI 框架**: 使用 TDesign React，配置浅色主题
- **Tooltips**: 始终使用 `theme='light'`
- **品牌色一致性**: 覆盖第三方组件（如 TDesign Tag）的默认颜色以符合 Opentu 品牌视觉
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

### Service Worker 初始化统一入口

**场景**: 需要确保 SW 客户端已初始化并配置好后再进行 API 调用

❌ **错误示例**:
```typescript
// 错误：在各处重复 SW 初始化逻辑
async function callSWApi() {
  if (shouldUseSWTaskQueue()) {
    if (!swChannelClient.isInitialized()) {
      const settings = geminiSettings.get();
      if (settings.apiKey && settings.baseUrl) {
        await settingsManager.waitForInitialization();
        await swChannelClient.initialize();
        await swChannelClient.init({
          geminiConfig: { apiKey: settings.apiKey, baseUrl: settings.baseUrl },
          videoConfig: { baseUrl: settings.baseUrl },
        });
      }
    }
    // 使用 SW...
  }
}
```

✅ **正确示例**:
```typescript
// 正确：使用统一入口
async function callSWApi() {
  const useSW = await swChannelClient.ensureReady();
  
  if (useSW) {
    // 使用 SW...
  } else {
    // 降级到主线程...
  }
}
```

**统一入口说明**:
- `swChannelClient.ensureReady()`: 统一的异步初始化入口，内部处理 URL 参数检查、设置验证、初始化和配置
- `swTaskQueueService.initialize()`: 任务队列服务初始化，内部调用 `ensureReady()` + 设置 visibility 监听器
- `shouldUseSWTaskQueue()`: 同步检查函数，仅用于判断模式，不进行初始化

**原因**: 分散的 SW 初始化逻辑会导致代码重复、维护困难，且容易遗漏某些检查步骤。使用统一入口可以确保所有初始化逻辑集中管理，便于维护和调试。

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

### SW RPC Handler 必须等待数据恢复完成

**场景**: Service Worker 中的 RPC handler 需要访问从 IndexedDB 恢复的数据（如任务列表）

❌ **错误示例**:
```typescript
// 错误：RPC handler 直接访问数据，可能在 IndexedDB 恢复完成前被调用
private handleTaskListPaginated(data: { page: number; pageSize: number }) {
  const allTasks = this.taskQueue?.getAllTasks() || [];
  // 如果 restoreFromStorage() 还在执行，allTasks 可能是空的或不完整的
  return { tasks: allTasks.slice(start, end), total: allTasks.length };
}
```

✅ **正确示例**:
```typescript
// 正确：先等待 IndexedDB 数据恢复完成
private async handleTaskListPaginated(data: { page: number; pageSize: number }) {
  // 确保 IndexedDB 数据已恢复
  await this.taskQueue?.waitForStorageRestore();
  
  const allTasks = this.taskQueue?.getAllTasks() || [];
  return { tasks: allTasks.slice(start, end), total: allTasks.length };
}

// SWTaskQueue 中提供等待方法
class SWTaskQueue {
  private storageRestorePromise: Promise<void> | null = null;
  
  async waitForStorageRestore(): Promise<void> {
    if (this.storageRestorePromise) {
      await this.storageRestorePromise;
    }
  }
}
```

**现象**: 页面刷新后，任务列表显示不完整（如 67 条任务只显示 2 条），因为 RPC 响应在数据恢复完成前就返回了。

### 配置同步到 IndexedDB 供 SW 读取

**场景**: Service Worker 需要读取用户配置（如 API Key、baseUrl），但 SW 无法访问 localStorage

**问题**: 之前的架构依赖 postMessage 传递配置给 SW，当通信不畅时 SW 可能拿不到配置导致任务失败。

❌ **错误示例**:
```typescript
// 错误：SW 依赖 postMessage 获取配置
// 主线程
await swChannelClient.init({
  geminiConfig: { apiKey, baseUrl },
  videoConfig: { baseUrl },
});

// SW 中
private async handleInit(data: { geminiConfig; videoConfig }) {
  this.geminiConfig = data.geminiConfig;
  // 如果 postMessage 失败，SW 就没有配置
}
```

✅ **正确示例**:
```typescript
// 正确：配置同步到 IndexedDB，SW 直接读取

// 1. 主线程 SettingsManager 同步配置到 IndexedDB
private async saveToStorage(): Promise<void> {
  localStorage.setItem(DRAWNIX_SETTINGS_KEY, settingsJson);
  
  // 必须 await：首次输入 API Key 后若立即提交工作流，SW 需能读到最新配置
  await this.syncToIndexedDB();
}

private async syncToIndexedDB(): Promise<void> {
  const geminiConfig = {
    apiKey: this.settings.gemini.apiKey,
    baseUrl: this.settings.gemini.baseUrl,
    // ...
  };
  await configIndexedDBWriter.saveConfig(geminiConfig, videoConfig);
}

// 2. SW 从 IndexedDB 读取配置
const geminiConfig = await taskQueueStorage.getConfig<GeminiConfig>('gemini');
const videoConfig = await taskQueueStorage.getConfig<VideoAPIConfig>('video');
```

**数据流**:
```
用户修改设置 → localStorage + IndexedDB（同时写入）
SW 需要配置 → 直接读取 IndexedDB → 始终可用
```

**关键点**:
- `configIndexedDBWriter` 使用与 SW 相同的数据库名 (`sw-task-queue`) 和存储名 (`config`)
- 初始化时自动同步，老用户的 localStorage 配置会自动迁移到 IndexedDB
- RPC `init()` 不再需要传递配置参数（可选，用于兼容旧版本）
- 任务/工作流仍保留配置快照，用于恢复场景

**原因**: Service Worker 启动后会异步从 IndexedDB 恢复数据（`restoreFromStorage()`），这个过程可能需要一定时间。如果 RPC handler 在恢复完成前被调用，访问的数据是不完整的。需要通过 Promise 机制确保数据恢复完成后再返回响应。

### SW 可用性检测需统一（channel + ping）

**场景**: 决定是否使用 SW 执行工作流时，需与 WorkflowSubmissionService 使用相同的检测逻辑

**问题**: 仅检查 `navigator.serviceWorker.controller` 会误判。controller 存在不代表 duplex channel 已就绪，提交时会超时后降级，WorkZone 卡在「待开始」。

❌ **错误示例**:
```typescript
// 错误：仅检查 controller
function checkSWAvailable(): boolean {
  return !!(navigator.serviceWorker?.controller);
}
// 若 channel 未初始化，submitWorkflow 会超时，降级路径可能仍用 SW 执行器导致二次超时
```

✅ **正确示例**:
```typescript
// 正确：检查 swChannelClient.isInitialized() 且 ping 成功
async function checkSWChannelAvailable(): Promise<boolean> {
  if (!swChannelClient.isInitialized()) return false;
  return await Promise.race([
    swChannelClient.ping(),
    new Promise<boolean>((r) => setTimeout(() => r(false), 1500)),
  ]);
}
```

**原因**: controller 存在时 duplex channel 可能仍在初始化或 SW 正在修复 IndexedDB。需统一使用 channel + ping 检测，避免走 SW 路径后超时降级。

### 降级路径强制使用主线程执行器

**场景**: workflow 提交到 SW 超时后，使用 MainThreadWorkflowEngine 降级执行时

**问题**: WorkflowEngine 内部用 `executorFactory.getExecutor()`，当 ping 仍成功时会返回 SW 执行器，导致 `generate_image`/`generate_video` 再次走 SW 并超时，WorkZone 一直「待开始」。

❌ **错误示例**:
```typescript
// 错误：降级时仍用 executorFactory（可能返回 SW 执行器）
this.fallbackEngine = new MainThreadWorkflowEngine({
  onEvent: (e) => this.handleFallbackEngineEvent(e),
  executeMainThreadTool: async (name, args) => { /* ... */ },
});
// WorkflowEngine 内部: const executor = await executorFactory.getExecutor();
// → 返回 SW 执行器 → 再次超时
```

✅ **正确示例**:
```typescript
// 正确：强制使用主线程执行器
this.fallbackEngine = new MainThreadWorkflowEngine({
  onEvent: (e) => this.handleFallbackEngineEvent(e),
  forceFallbackExecutor: true,
  executeMainThreadTool: async (name, args) => { /* ... */ },
});
// WorkflowEngine 内部: const executor = this.options.forceFallbackExecutor
//   ? executorFactory.getFallbackExecutor()
//   : await executorFactory.getExecutor();
```

**原因**: 降级路径应完全在主线程执行，直接调用 API，不依赖 SW 或 IndexedDB 就绪。

### 降级路径工作流工具集一致性

**场景**: 工作流降级到主线程执行时，WorkflowEngine 的 `executeToolStep` 用 switch 按 `step.mcp` 分发。SW 侧（如 workflow-executor、swCapabilitiesHandler）支持的工具，主线程分支也必须能路由，否则会落入 default 抛出 `Unknown tool: xxx`。

❌ **错误示例**:
```typescript
// 错误：SW 的 handler 支持 generate_grid_image，但 engine 的 switch 没有对应 case
// sw-capabilities/handler.ts 有 case 'generate_grid_image'
// workflow-engine/engine.ts 只有 generate_image、generate_video、ai_analyze、insert_*...
// → generate_grid_image 落入 default，抛 Unknown tool: generate_grid_image
switch (step.mcp) {
  case 'generate_image': // ...
  case 'generate_video': // ...
  case 'ai_analyze': // ...
  case 'insert_mermaid':
  case 'canvas_insert': // ...
  default:
    throw new Error(`Unknown tool: ${step.mcp}`);
}
```

✅ **正确示例**:
```typescript
// 正确：与 DelegatedOperationType / swCapabilitiesHandler.execute 支持的工具集一致
// 凡由主线程 handler 执行的工具，都走 executeMainThreadTool 分支
case 'generate_grid_image':
case 'generate_inspiration_board':
case 'split_image':
case 'generate_long_video':
case 'insert_mermaid':
case 'insert_mindmap':
case 'insert_svg':
case 'canvas_insert':
case 'insert_to_canvas': {
  if (!this.options.executeMainThreadTool) {
    throw new Error(`No main thread tool executor configured for: ${step.mcp}`);
  }
  const toolResult = await this.options.executeMainThreadTool(step.mcp, step.args);
  // ...
}
```

**原因**: 降级路径功能一致性要求主线程与 SW 支持相同工具集。新增 DelegatedOperation 类型或在 handler 增加 case 时，需同步在 WorkflowEngine.executeToolStep 中增加对应 case 并路由到 executeMainThreadTool。

**相关文件**:
- `packages/drawnix/src/services/sw-capabilities/types.ts` - DelegatedOperationType
- `packages/drawnix/src/services/sw-capabilities/handler.ts` - execute switch
- `packages/drawnix/src/services/workflow-engine/engine.ts` - executeToolStep switch

### 同页面禁止创建多个 ServiceWorkerChannel

**场景**: 主线程需要与 SW 通信的多个模块（如 `swChannelClient`、`FetchRelayClient`）各自调用 `ServiceWorkerChannel.createFromPage()`。

**问题**: SW 端 `enableGlobalRouting` 按 `event.source.id`（SW client ID）路由消息。同一页面的所有 `createFromPage()` 共享同一个 `clientId`。SW 端 `ensureChannel(clientId)` 只为第一个连接创建 channel 和 subscribeMap，后续连接复用同一个 server-side channel。这导致 RPC 响应可能路由到错误的 client-side channel，`channel.call()` 永远不 resolve。

❌ **错误示例**:
```typescript
// FetchRelayClient 创建独立 channel — 与 swChannelClient 冲突！
class FetchRelayClient {
  private channel: ServiceWorkerChannel | null = null;

  async doInitialize(): Promise<boolean> {
    // 创建第二个 channel，但 SW 只有一个 server-side channel
    this.channel = await ServiceWorkerChannel.createFromPage({ timeout: 120000 });
    return true;
  }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    // channel.call() 永远不 resolve — 响应去了 swChannelClient 的 channel
    const response = await this.channel!.call('fetchRelay:start', { url, ...init });
    // ...
  }
}
```

✅ **正确示例**:
```typescript
// FetchRelayClient 复用 swChannelClient 的 channel
class FetchRelayClient {
  private swChannelClientRef: { getChannel: () => ServiceWorkerChannel | null } | null = null;

  private getChannel(): ServiceWorkerChannel | null {
    return this.swChannelClientRef?.getChannel() ?? null;
  }

  async initialize(): Promise<boolean> {
    const { swChannelClient } = await import('../sw-channel');
    this.swChannelClientRef = swChannelClient;
    if (!swChannelClient.isInitialized()) {
      await swChannelClient.initializeChannel();
    }
    return !!swChannelClient.getChannel();
  }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    const channel = this.getChannel();
    if (!channel) return this.directFetch(url, init); // 降级
    const response = await channel.call('fetchRelay:start', { url, ...init });
    // ...
  }
}
```

**原因**: `enableGlobalRouting` 按 `clientId` 路由。同一浏览器 tab 的所有 `createFromPage()` 共享同一个 clientId（来自 `event.source.id`）。SW 端只为每个 clientId 维护一个 server-side channel 和一套 subscribeMap。第二个 `createFromPage()` 的握手消息被已有 channel 处理，导致路由混乱。

**相关文件**：
- `packages/drawnix/src/services/sw-channel/client.ts` - swChannelClient（唯一的 createFromPage 调用点）
- `packages/drawnix/src/services/fetch-relay/client.ts` - FetchRelayClient（复用 swChannelClient.getChannel()）
- `apps/web/src/sw/task-queue/channel-manager.ts` - enableGlobalRouting + ensureChannel

### Fetch Relay 初始化超时保护

**场景**: `fetchRelayClient.initialize()` 在热路径中被调用（如 `FallbackMediaExecutor.generateImage()`、`swTaskQueueService.doInitialize()`）。内部 `ServiceWorkerChannel.createFromPage()` 默认超时 120 秒，如果 SW 存在但响应慢（如正在 activate），整个热路径会被阻塞 2 分钟。

❌ **错误示例**:
```typescript
// 错误：await 可能阻塞 120 秒
await fetchRelayClient.initialize();

const relayResponse = await fetchRelayClient.fetch(url, { ... });
```

✅ **正确示例**:
```typescript
// 正确：3 秒超时保护，超时后 isInitialized() 返回 false，
// fetchRelayClient.fetch() 内部自动降级到 directFetch
const relayReady = await Promise.race([
  fetchRelayClient.initialize(),
  new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
]);
console.debug('[XXX] Fetch Relay ready:', relayReady);

// fetch() 内部会检查 isInitialized()，不可用时自动降级
const relayResponse = await fetchRelayClient.fetch(url, { ... });
```

**原因**: `fetchRelayClient.initialize()` 创建的 `ServiceWorkerChannel` 需要与 SW 完成握手。SW 在 activating、更新或忙碌时可能延迟响应。在图片生成、任务初始化等热路径中，2 分钟阻塞会导致用户感知请求未发出。

**补充**：同理，`recoverFetchRelayResults()` 在 `doInitialize()` 中也需加超时，否则会阻塞任务恢复流程（`handleInterruptedTasks` 和 `startPolling` 无法执行）。

**相关文件**：
- `packages/drawnix/src/services/fetch-relay/client.ts` - FetchRelayClient
- `packages/drawnix/src/services/media-executor/fallback-executor.ts` - generateImage
- `packages/drawnix/src/services/sw-task-queue-service.ts` - doInitialize / recoverFetchRelayResults

### 模块迁移时接口定义必须逐字段对比

**场景**: 将模块从 SW 迁移到主线程（或反向迁移）时，在新模块中重新定义了 `interface`，但遗漏了某些字段。

❌ **错误示例**:
```typescript
// SW 版本的 llm-api-logger.ts 有完整定义
interface LLMApiLog {
  id: string;
  // ... 基础字段 ...
  hasReferenceImages?: boolean;
  referenceImageCount?: number;
  referenceImages?: LLMReferenceImage[];  // ← SW 版本有这个字段
}

// 主线程版本迁移时遗漏了 referenceImages
interface LLMApiLog {
  id: string;
  // ... 基础字段 ...
  hasReferenceImages?: boolean;
  referenceImageCount?: number;
  // ❌ referenceImages 字段丢失！类型定义缺失导致调用方无法传入数据
}
```

✅ **正确示例**:
```typescript
// 主线程版本必须与 SW 版本逐字段对比
interface LLMApiLog {
  id: string;
  // ... 基础字段 ...
  hasReferenceImages?: boolean;
  referenceImageCount?: number;
  referenceImages?: LLMReferenceImage[];  // ✅ 保留所有字段
}
```

**原因**: 模块迁移时，不仅调用方传参需要完整，**类型定义本身**也必须包含所有字段。如果 `interface` 缺少字段，即使调用方想传数据也无法传入（TypeScript 严格对象字面量检查会报错）。迁移后应逐字段对比新旧 `interface`，确保功能完整性。本次案例中，主线程 `LLMApiLog` 遗漏 `referenceImages` 导致 debug 面板参考图始终显示"加载中..."。

**相关文件**：
- `packages/drawnix/src/services/media-executor/llm-api-logger.ts` - 主线程版本
- `apps/web/src/sw/task-queue/llm-api-logger.ts` - SW 版本

### 模型参数偏好必须按模型作用域存储

**场景**: 图片、视频、音频生成表单需要记忆不同模型的用户参数偏好。

**核心原则**:
- 优先使用 `selectionKey` 作为偏好作用域键，缺失时再回退 `modelId`
- 不同供应商来源的同名模型不能共享参数
- 回填优先级必须是：任务参数 / 外部显式初始化 > 模型偏好 > 模型默认值
- 回填后必须重新做兼容性过滤，丢弃当前模型不支持的参数

❌ **错误示例**:
```typescript
const key = `prefs:${model.id}`;
localStorage.setItem(key, JSON.stringify(params));

// provider-a::gemini-2.5-flash
// provider-b::gemini-2.5-flash
// 最终会读写同一个 key，导致参数串用
```

✅ **正确示例**:
```typescript
const scopeKey = model.selectionKey || model.id;
scopedPreferences[scopeKey] = sanitizeSelectedParams(model.id, params);

const restored =
  explicitTaskParams ??
  scopedPreferences[scopeKey] ??
  getModelDefaultParams(model.id);
```

**原因**: 运行时模型发现后，同名模型可能来自不同供应商，参数能力并不完全相同。只按 `modelId` 记忆会让用户在切换供应商后看到错误回填，最终演变成隐蔽状态 bug。

### 中断任务延迟判定

**场景**: 页面刷新后，`handleInterruptedTasks()` 处理仍处于 `processing` 状态的任务。如果图片生成通过 Fetch Relay 代理，SW 可能仍在执行 fetch（尚未完成），此时 `recoverFetchRelayResults()` 找不到结果。

❌ **错误示例**:
```typescript
// 错误：立即标记失败，但 SW 可能几秒后就完成了
private async handleInterruptedTasks(): Promise<void> {
  for (const task of processingTasks) {
    if (!task.remoteId) {
      await taskStorageWriter.failTask(task.id, { code: 'INTERRUPTED', message: '...' });
    }
  }
}
```

✅ **正确示例**:
```typescript
// 正确：延迟 15 秒后再次尝试 Fetch Relay 恢复，仍无法恢复才标记失败
private async handleInterruptedTasks(): Promise<void> {
  for (const task of processingTasks) {
    if (!task.remoteId) {
      this.delayedInterruptCheck(task); // 15 秒后再检查
    }
  }
}

private delayedInterruptCheck(task: Task): void {
  setTimeout(async () => {
    const current = this.tasks.get(task.id);
    if (!current || current.status !== TaskStatus.PROCESSING) return;
    await this.recoverFetchRelayResults(); // 再试一次
    // 仍然 processing → 标记失败
  }, 15000);
}
```

**原因**: Fetch Relay 的 SW 端是异步执行的，图片生成 API 通常需要 5-30 秒。如果立即标记失败，SW 完成的结果会被丢弃，用户看到失败但实际上请求成功了。

### IndexedDB 主线程读取前检查 store 是否存在

**场景**: 主线程 StorageReader（如 WorkflowStorageReader）从 IndexedDB 读取数据时

**问题**: object store 由 SW 在 `onupgradeneeded` 中创建。首次加载或 SW 尚未初始化时 store 可能不存在，直接 `transaction(storeName)` 会抛 `NotFoundError`。

❌ **错误示例**:
```typescript
async getWorkflow(id: string): Promise<Workflow | null> {
  const db = await this.getDB();
  const swWorkflow = await this.getById(WORKFLOWS_STORE, id);  // store 不存在时抛 NotFoundError
  return swWorkflow ? convert(swWorkflow) : null;
}
```

✅ **正确示例**:
```typescript
async getWorkflow(id: string): Promise<Workflow | null> {
  const db = await this.getDB();
  if (!db.objectStoreNames.contains(WORKFLOWS_STORE)) return null;
  const swWorkflow = await this.getById(WORKFLOWS_STORE, id);
  return swWorkflow ? convert(swWorkflow) : null;
}
```

**原因**: 主线程用 `indexedDB.open(dbName)` 不加版本，不会触发 `onupgradeneeded`，无法创建 store。需在读取前检查 `db.objectStoreNames.contains(storeName)`。

### 降级模式持久化失败不阻塞执行

**场景**: MainThreadWorkflowEngine 或 workflowStorageWriter 在降级模式下写入 IndexedDB 时

**问题**: IndexedDB store 可能不存在，`saveWorkflow` 失败会 reject，导致工作流执行中断，用户看不到请求发出。

❌ **错误示例**:
```typescript
async saveWorkflow(workflow: Workflow): Promise<void> {
  const db = await this.getDB();
  if (!db.objectStoreNames.contains(WORKFLOWS_STORE)) {
    reject(new Error('Store not found'));  // 导致 WorkflowEngine 捕获异常并标记失败
  }
  // ...
}
```

✅ **正确示例**:
```typescript
async saveWorkflow(workflow: Workflow): Promise<void> {
  try {
    const db = await this.getDB();
    if (!db.objectStoreNames.contains(WORKFLOWS_STORE)) return;
    // ... 写入
  } catch {
    // 静默跳过：降级模式不依赖持久化，优先保证 API 调用执行
  }
}
```

**原因**: 降级模式下用户最关心的是请求能发出，持久化是次要的。失败时 resolve 而非 reject，不阻塞工作流执行。

### 主线程任务数据必须通过 RPC 持久化到 SW

**场景**: 从云端同步或恢复任务数据到本地时

❌ **错误示例**:
```typescript
// 错误：只添加到本地内存，页面刷新后数据丢失
async restoreTasks(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    this.tasks.set(task.id, task);  // 只存到内存
    this.emitEvent('taskCreated', task);
  }
}
```

✅ **正确示例**:
```typescript
// 正确：通过 RPC 调用 SW 的 importTasks 方法持久化到 IndexedDB
async restoreTasks(tasks: Task[]): Promise<void> {
  const tasksToRestore = tasks.filter(task => !this.tasks.has(task.id));
  if (tasksToRestore.length === 0) return;
  
  // 转换为 SWTask 格式
  const swTasks = tasksToRestore.map(task => this.convertTaskToSWTask(task));
  
  // 调用 SW 的 importTasks RPC 持久化到 IndexedDB
  const result = await swChannelClient.importTasks(swTasks);
  
  if (result.success) {
    // 持久化成功后才添加到本地内存
    for (const task of tasksToRestore) {
      this.tasks.set(task.id, task);
      this.emitEvent('taskCreated', task);
    }
  }
}
```

**现象**: 云端同步任务后显示成功，但页面刷新后任务列表为空。

**原因**: `swTaskQueueService` 的本地 `tasks` Map 只是内存状态，不会自动持久化。SW 的 IndexedDB 才是任务数据的持久化存储。必须通过 RPC 调用 SW 端的方法才能将数据保存到 IndexedDB。

**相关文件**:
- 主线程：`packages/drawnix/src/services/sw-task-queue-service.ts`
- SW 端：`apps/web/src/sw/task-queue/channel-manager.ts` (`TASK_IMPORT` RPC)
- SW 存储：`apps/web/src/sw/task-queue/storage.ts`

### 远程同步的任务不应恢复执行

**场景**: 多设备同步场景下，避免远程同步过来的任务被错误地恢复执行

❌ **错误示例**:
```typescript
// 错误：SW 重启后会恢复所有 PROCESSING/PENDING 状态的任务，包括远程同步的
private shouldResumeTask(task: SWTask): boolean {
  if (task.status === TaskStatus.PROCESSING) {
    return true; // 会恢复远程同步的任务，导致重复调用大模型接口
  }
  return false;
}
```

✅ **正确示例**:
```typescript
// 正确：检查 syncedFromRemote 标记，跳过远程同步的任务
private shouldResumeTask(task: SWTask): boolean {
  // 远程同步的任务不应恢复执行（避免多设备重复执行）
  if (task.syncedFromRemote) {
    return false;
  }
  
  if (task.status === TaskStatus.PROCESSING) {
    return true;
  }
  return false;
}
```

**现象**: 用户在设备 A 创建任务并同步到云端，设备 B 同步后页面刷新，任务被重新执行，导致重复调用大模型接口（产生额外费用）。

**原因**: SW 重启后会调用 `restoreFromStorage()` 恢复任务，并对 `PROCESSING`/`PENDING` 状态的任务调用 `resumeTaskExecution()`。远程同步的任务虽然通常是 `COMPLETED` 状态，但为了防止边界情况，需要通过 `syncedFromRemote` 标记明确区分本地创建和远程同步的任务。

**实现要点**:
1. `Task` 和 `SWTask` 接口添加 `syncedFromRemote?: boolean` 字段
2. `task-sync-service.ts` 的 `compactToTask()` 设置 `syncedFromRemote: true`
3. SW 的 `shouldResumeTask()` 检查此标记并返回 `false`
4. 数据转换函数（`convertTaskToStorageFormat`、`convertTaskToSWTask`）传递此字段

**相关文件**:
- 主线程类型：`packages/drawnix/src/types/shared/core.types.ts`
- SW 类型：`apps/web/src/sw/task-queue/types.ts`
- 任务恢复：`apps/web/src/sw/task-queue/queue.ts` (`shouldResumeTask`)
- 同步服务：`packages/drawnix/src/services/github-sync/task-sync-service.ts`

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

### 新画布功能必须作为 Plait 插件实现

**场景**: 需要在画布上添加新的交互功能（如激光笔、新画笔类型、标注工具等）

❌ **错误做法**：使用独立 React 组件 + SVG overlay

```typescript
// 错误：独立 React 组件，坐标系与画布不一致
const LaserPointer: React.FC = ({ active, board }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // 手动监听 pointer 事件，自己计算坐标
  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    // 屏幕坐标，未经过画布缩放/平移变换 → 笔迹位置错误
    trailRef.current.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  return <svg className="overlay" onPointerMove={handlePointerMove}>...</svg>;
};
```

✅ **正确做法**：实现为 `withXxx` 插件，复用框架基础设施

```typescript
// 正确：作为 Plait 插件，复用 Generator/Smoother/坐标变换
export const withLaserPointer = (board: PlaitBoard) => {
  const { pointerDown, pointerMove, pointerUp } = board;
  const generator = new FreehandGenerator(board);  // 复用已有渲染器
  const smoother = new FreehandSmoother();          // 复用已有平滑算法

  board.pointerMove = (event: PointerEvent) => {
    if (isDrawing) {
      const smoothed = smoother.process([event.x, event.y]);
      // 使用框架标准坐标变换，与画布缩放/平移一致
      const point = toViewBoxPoint(board, toHostPoint(board, smoothed[0], smoothed[1]));
      points.push(point);
      generator.processDrawing(element, PlaitBoard.getElementTopHost(board));
      return;
    }
    pointerMove(event);
  };
  return board;
};
```

**原因**:
1. 独立 SVG overlay 有自己的坐标系，不跟随画布缩放/平移，导致笔迹位置错误
2. overlay 需要 `stopPropagation` 拦截事件，与画布交互冲突
3. 无法复用 FreehandGenerator（SVG 渲染）、FreehandSmoother（点平滑）等已有能力
4. 插件方式通过 `board.pointerDown/Move/Up` 链自然融入事件流

### 工具互斥通过 board.pointer 管理

**场景**: 添加新的工具类型（如激光笔），需要与其他工具（选择、手型、画笔）互斥

❌ **错误做法**：使用独立布尔状态

```typescript
// 错误：独立状态，需要手动维护互斥
interface DrawnixState {
  laserPointerActive?: boolean;  // 独立状态
}

// 激活激光笔时，不会自动停用其他工具
updateAppState({ laserPointerActive: true });

// 需要额外逻辑处理互斥
const [laserActive, setLaserActive] = useState(false);
useEffect(() => {
  if (appState.laserPointerActive) {
    setLaserActive(true);
    updateState(prev => ({ ...prev, laserPointerActive: false }));
  }
}, [appState.laserPointerActive]);
```

✅ **正确做法**：加入枚举，使用 `board.pointer` 系统

```typescript
// 正确：加入 FreehandShape 枚举
export enum FreehandShape {
  feltTipPen = 'feltTipPen',
  eraser = 'eraser',
  laserPointer = 'laserPointer',  // 新增
}

// 切换工具时，通过框架统一管理
BoardTransforms.updatePointerType(board, FreehandShape.laserPointer);
updateAppState({ pointer: FreehandShape.laserPointer });

// board.pointer 是单值，自动与其他工具互斥
// 判断激活状态
const isActive = board.pointer === FreehandShape.laserPointer;
```

**原因**:
1. `board.pointer` 是单值，设置新工具自动停用旧工具，无需手动管理互斥
2. 工具栏 UI 通过 `board.pointer === xxx` 自动反映选中状态
3. 快捷键切换（V/H/L/E 等）只需更新 pointer 一处
4. 插件中通过 `PlaitBoard.isPointer(board, xxx)` 判断是否激活，逻辑清晰

### Pointer 双更新：board 和 React context 必须同步

**场景**: 切换或恢复工具 pointer 时，只更新了 Plait board 的 pointer 而忘记更新 React context（`appState.pointer`），导致 UI 状态残留（如橡皮擦工具栏在退出幻灯片后仍然显示）

❌ **错误示例**:
```typescript
// 退出幻灯片时只恢复了 board pointer
const handleClose = () => {
  BoardTransforms.updatePointerType(board, savedPointer);
  // 遗漏：React context 中的 appState.pointer 仍是 FreehandShape.eraser
  // 橡皮擦工具栏判断 appState.pointer === FreehandShape.eraser 仍为 true
};
```

✅ **正确示例**:
```typescript
// 同时更新 board 和 React context
const handleClose = () => {
  BoardTransforms.updatePointerType(board, savedPointer);
  setPointer(savedPointer);  // 同步更新 React context
};
```

**原因**: Pointer 状态存在于两层：Plait board（`board.pointer`）和 React context（`appState.pointer`）。UI 组件（如橡皮擦工具栏）依赖 React context 判断显隐，只更新 board 不会触发 React 重渲染，导致 UI 与实际状态不一致。任何修改 pointer 的地方都必须同时调用 `BoardTransforms.updatePointerType` 和 `setPointer`。

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

### 交互插件必须覆盖所有元素类型

**场景**: 橡皮擦、选择、拖拽等交互插件只处理了部分元素类型，新增元素类型后遗漏更新

❌ **错误示例**:
```typescript
// 橡皮擦只处理 Freehand 元素，Frame/Image/Video 完全无法擦除
const checkAndMarkFreehandElementsForDeletion = (point: Point) => {
    const freehandElements = board.children.filter((element) =>
        Freehand.isFreehand(element)
    ) as Freehand[];
    // 只遍历 freehand，其他元素类型被忽略
};
```

✅ **正确示例**:
```typescript
// 遍历所有 children，按类型分别做命中检测
const checkAndMarkElementsForDeletion = (point: Point) => {
    board.children.forEach((element) => {
        if (elementsToDelete.has(element.id)) return;
        let hit = false;
        if (Freehand.isFreehand(element)) {
            hit = isHitFreehandWithRadius(board, element, viewBoxPoint, hitRadius);
        } else if (isErasableRectElement(element)) {
            hit = isHitRectElement(element, viewBoxPoint, hitRadius);
        }
        if (hit) {
            PlaitElement.getElementG(element).style.opacity = '0.2';
            elementsToDelete.add(element.id);
        }
    });
};
```

**原因**: 新增元素类型（如 Frame、Video）后，所有交互插件（橡皮擦、选择、碰撞检测等）都需要更新以支持新类型。仅过滤特定类型会导致其他类型的元素无法被交互。

### createPortal 到 document.body 会脱离 Plait React Context

**场景**: 在 `createPortal(... document.body)` 渲染的组件中使用 `useBoard()` 等 Plait hooks

❌ **错误示例**:
```typescript
// FrameSlideshow 通过 createPortal 渲染到 document.body
// 内部使用 PencilSettingsToolbar，它调用 useBoard()
// 报错：The `useBoard` hook must be used inside the <Plait> component's context
return createPortal(
    <PencilSettingsToolbar />,  // 内部调用 useBoard() → 报错
    document.body
);
```

✅ **正确示例**:
```typescript
// 通过 props 传递 board，直接调用 Plait API
const FrameSlideshow: React.FC<{ board: PlaitBoard }> = ({ board }) => {
    const settings = getFreehandSettings(board);
    const handleColorChange = (color: string) => {
        setFreehandStrokeColor(board, color);
    };
    // 内联实现设置面板，不依赖 useBoard()
};
```

**原因**: `createPortal` 渲染到 `document.body` 会脱离 `<Plait>` 组件树，React Context 无法穿透。必须通过 props 传递 `board` 并直接调用 Plait API。

### 蒙层挖洞的 pointer-events 设置

**场景**: 全屏蒙层遮住画布，中间留出"窗口"区域允许交互（如幻灯片播放）

❌ **错误示例**:
```scss
// 蒙层容器设置 pointer-events: auto，阻挡了窗口区域的画布交互
.frame-slideshow__mask {
    pointer-events: auto;  // 整个容器拦截事件，画布无法交互
}
```

✅ **正确示例**:
```scss
// 容器透传事件，只有实际遮挡区域拦截
.frame-slideshow__mask {
    pointer-events: none;  // 容器不拦截
}
.frame-slideshow__mask-block {
    pointer-events: auto;  // 只有四块遮挡区域拦截事件
}
```

**原因**: 蒙层容器覆盖整个视口，如果设置 `pointer-events: auto` 会阻挡中间"窗口"区域的画布事件。正确做法是容器 `pointer-events: none`，仅四块实际遮挡的 div 设置 `pointer-events: auto`。

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

### 同步数据格式一致性

**场景**: 解析远程 Gist 中的同步数据文件时

❌ **错误示例**:
```typescript
// 错误：直接把 tasks.json 当数组解析
if (gist.files['tasks.json']) {
  const tasksData = await parseGistFile(gist.files['tasks.json']);
  if (Array.isArray(tasksData)) {
    remoteTasks = tasksData;  // 永远不会执行！
  }
}

// 错误：查找 .drawnix 文件
for (const [fileName] of Object.entries(gist.files)) {
  if (fileName.endsWith('.drawnix')) {  // 实际格式是 board_*.json
    remoteBoards.push(fileName);
  }
}
```

✅ **正确示例**:
```typescript
// 正确：tasks.json 结构是 { completedTasks: Task[] }
if (gist.files['tasks.json']) {
  const tasksData = await parseGistFile(gist.files['tasks.json']);
  if (tasksData && Array.isArray(tasksData.completedTasks)) {
    remoteTasks = tasksData.completedTasks;
  }
}

// 正确：画板文件格式是 board_{id}.json
for (const [fileName] of Object.entries(gist.files)) {
  if (fileName.startsWith('board_') && fileName.endsWith('.json')) {
    const boardId = fileName.replace('board_', '').replace('.json', '');
    remoteBoards.push({ id: boardId, fileName });
  }
}
```

**同步数据格式参考**:
| 文件名 | 结构 |
|--------|------|
| `tasks.json` | `{ completedTasks: Task[] }` |
| `board_{id}.json` | `Board` 对象 |
| `workspace.json` | `{ folders, boardMetadata, currentBoardId }` |
| `master-index.json` | `{ boards: Record<id, BoardSyncInfo>, devices, ... }` |
| `media_{hash}.json` | `{ url, mimeType, data, size }` |

**原因**: 同步数据有特定的结构，直接解析会导致数据无法正确读取。调试面板和应用代码必须使用相同的格式。

---

### 同步模块日志规范

**场景**: 在 `github-sync/*` 目录下的同步相关模块中记录日志

❌ **错误示例**:
```typescript
// sync-engine.ts
async pullFromRemote(): Promise<SyncResult> {
  console.log('[SyncEngine] pullFromRemote START');
  console.log('[SyncEngine] Downloading media 10/12:', url);
  console.error('[SyncEngine] Failed to download:', error);
}
```

✅ **正确示例**:
```typescript
// sync-engine.ts
import { logInfo, logDebug, logSuccess, logWarning, logError } from './sync-log-service';

async pullFromRemote(): Promise<SyncResult> {
  logInfo('pullFromRemote START');
  logDebug('Downloading media', { current: 10, total: 12, url });
  logError('Failed to download', error instanceof Error ? error : new Error(String(error)));
}
```

**统一日志 API**:
| 函数 | 用途 | 参数 |
|------|------|------|
| `logDebug(message, data?)` | 详细调试信息 | message: string, data?: object |
| `logInfo(message, data?)` | 一般流程信息 | message: string, data?: object |
| `logSuccess(message, data?)` | 操作成功 | message: string, data?: object |
| `logWarning(message, data?)` | 警告信息 | message: string, data?: object |
| `logError(message, error)` | 错误信息 | message: string, error: Error |

**原因**: 
1. 同步模块的日志需要在 `/sw-debug.html?tab=gist` 调试面板中查看，便于问题定位
2. `console.log` 会污染浏览器控制台，且无法持久化和结构化查询
3. 统一日志服务支持：内存缓存 + IndexedDB 持久化 + 结构化查询 + 自动清理

**注意事项**:
- `logError` 的第二个参数必须是 `Error` 对象，不能是字符串
- 使用结构化 `data` 对象而非字符串拼接，便于后续查询和分析
- `sync` 类别的日志始终记录（不受 debugMode 影响），便于问题诊断

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

### postmessage-duplex 库使用规范 (v1.1.0)

**场景**: 使用 `postmessage-duplex` 库实现主线程与 Service Worker 的双工通信时

#### 通信模式选择

| 模式 | 方法 | 用途 | 特点 |
|------|------|------|------|
| RPC | `call()` | 请求-响应 | 需要等待响应，有超时 |
| 广播 | `broadcast()` + `onBroadcast()` | 单向通知 | fire-and-forget，无响应 |

❌ **错误示例 1 - 单向通知使用 publish**:
```typescript
// 错误：publish 需要响应，用于单向通知会导致超时警告
channel.publish('task:status', { taskId, status });  // 等待响应超时
```

✅ **正确示例 1 - 使用 broadcast**:
```typescript
// 正确：单向通知使用 broadcast（fire-and-forget）
channel.broadcast('task:status', { taskId, status });  // 不等待响应
```

❌ **错误示例 2 - 接收广播使用 subscribe**:
```typescript
// 错误：subscribe 用于 RPC，接收广播应使用 onBroadcast
channel.subscribe('task:status', (response) => {
  handleStatus(response.data);  // 广播消息不会触发
  return { ack: true };
});
```

✅ **正确示例 2 - 使用 onBroadcast**:
```typescript
// 正确：使用 onBroadcast 接收广播消息
channel.onBroadcast('task:status', ({ data }) => {
  if (data) {
    handleStatus(data as TaskStatusEvent);  // data 直接是广播数据
  }
  // 不需要 return，这是单向的
});
```

#### 客户端初始化

❌ **错误示例 3 - 未启用自动重连**:
```typescript
// 错误：SW 更新后连接断开，需要手动处理
const channel = await ServiceWorkerChannel.createFromPage({
  timeout: 30000,
});
```

✅ **正确示例 3 - 启用 autoReconnect**:
```typescript
// 正确：启用自动重连，SW 更新时自动恢复连接
const channel = await ServiceWorkerChannel.createFromPage({
  timeout: 30000,
  autoReconnect: true,
  log: { log: () => {}, warn: () => {}, error: () => {} },  // 禁用内部日志
} as any);  // log 不在 PageChannelOptions 类型中，需要 as any
```

#### SW 端配置

❌ **错误示例 4 - 手动处理连接**:
```typescript
// 错误（v1.0.0 模式）：手动监听 SW_CHANNEL_CONNECT
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SW_CHANNEL_CONNECT') {
    // 手动创建 channel...
  }
});
```

✅ **正确示例 4 - 使用 enableGlobalRouting**:
```typescript
// 正确（v1.1.0）：使用 enableGlobalRouting 自动管理 channel
ServiceWorkerChannel.enableGlobalRouting((clientId, event) => {
  const channel = ensureChannel(clientId);  // 按需创建 channel
  channel.handleMessage(event);  // 处理消息
});

function ensureChannel(clientId: string) {
  if (!channels.has(clientId)) {
    const channel = ServiceWorkerChannel.createFromWorker(clientId, {
      timeout: 30000,
      subscribeMap: createRpcHandlers(),
      log: { log: () => {}, warn: () => {}, error: () => {} },
    });
    channels.set(clientId, channel);
  }
  return channels.get(clientId);
}
```

#### isReady 检查

❌ **错误示例 5 - isReady 布尔值检查**:
```typescript
// 错误：isReady 返回数字 0/1，不是布尔值
if (this.channel?.isReady === true) {  // 永远 false！isReady 是 1
  return true;
}
```

✅ **正确示例 5**:
```typescript
// 正确：使用 truthy 检查
if (!!this.channel?.isReady) {  // 0 → false, 1 → true
  return true;
}
```

**原因**:
1. **v1.1.0 引入 broadcast 模式**：`broadcast()` + `onBroadcast()` 用于单向通知，不需要响应，避免超时
2. **enableGlobalRouting 自动管理**：不再需要手动处理 `SW_CHANNEL_CONNECT`，库自动路由消息到正确的 channel
3. **autoReconnect 处理 SW 更新**：SW 更新时自动重新建立连接，无需页面刷新
4. **log 选项禁用日志**：`PageChannelOptions` 类型不含 `log`，需要 `as any` 绕过类型检查
5. **isReady 返回数字**：0/1 而非布尔值，使用 `!!` 转换

### 任务队列双服务同步

**场景**: 项目中有两个任务队列服务，需要正确同步数据

| 服务 | 位置 | 用途 |
|------|------|------|
| `taskQueueService` | 本地内存 | UI 组件状态（useTaskQueue hook） |
| `swTaskQueueService` | SW 通信 | 持久化任务数据 |

❌ **错误示例**:
```typescript
// 错误：只从本地服务读取，首次渲染时可能为空
export function useTaskQueue() {
  const [tasks, setTasks] = useState<Task[]>([]);
  
  useEffect(() => {
    setTasks(taskQueueService.getAllTasks());  // 可能为空！
  }, []);
}
```

✅ **正确示例**:
```typescript
// 正确：渲染时直接从 IndexedDB 加载数据
export function useTaskQueue() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const syncAttempted = useRef(false);
  
  useEffect(() => {
    setTasks(taskQueueService.getAllTasks());
  }, []);

  // 渲染时从 IndexedDB 加载
  useEffect(() => {
    if (syncAttempted.current) return;
    syncAttempted.current = true;

    const loadTasks = async () => {
      // 直接从 IndexedDB 读取任务
      const storedTasks = await taskStorageReader.getAllTasks();
      if (storedTasks.length > 0) {
        taskQueueService.restoreTasks(storedTasks);
      }
    };
    loadTasks();
  }, []);
}
```

**原因**:
- `taskQueueService` 是纯内存服务，页面刷新后数据丢失
- 任务数据持久化在 IndexedDB 中，直接通过 `taskStorageReader` 读取
- 避免 postMessage RPC 的 1MB 大小限制和通信不稳定性
6. **响应数据格式可能有多种嵌套结构**，需要灵活解析而非假设单一格式

**相关文件**:
- `packages/drawnix/src/services/sw-channel/client.ts` - 主应用的 SW 通道客户端
- `apps/web/src/sw/task-queue/channel-manager.ts` - SW 端的通道管理器
- `apps/web/public/sw-debug/duplex-client.js` - 调试页面的 duplex 客户端

### 降级模式（?sw=0）下任务必须自动执行

**场景**: 用户通过 `?sw=0` URL 参数禁用 Service Worker，使用降级模式

❌ **错误示例**:
```typescript
// 错误：降级模式下只创建任务，没有执行
class TaskQueueService {
  createTask(params: GenerationParams, type: TaskType): Task {
    const task = { id: generateTaskId(), type, status: TaskStatus.PROCESSING, ... };
    this.tasks.set(task.id, task);
    this.persistTask(task);  // 保存到 IndexedDB
    this.emitEvent('taskCreated', task);
    return task;  // 任务被创建但永远不会执行！
  }
}
```

✅ **正确示例**:
```typescript
// 正确：创建任务后自动触发执行
class TaskQueueService {
  createTask(params: GenerationParams, type: TaskType): Task {
    const task = { id: generateTaskId(), type, status: TaskStatus.PROCESSING, ... };
    this.tasks.set(task.id, task);
    this.persistTask(task);
    this.emitEvent('taskCreated', task);
    
    // 自动执行任务（fire-and-forget）
    this.executeTask(task).catch((error) => {
      console.error('[TaskQueueService] Task execution error:', error);
    });
    
    return task;
  }
  
  private async executeTask(task: Task): Promise<void> {
    const executor = await executorFactory.getExecutor();
    // 根据任务类型执行
    if (task.type === TaskType.IMAGE) {
      await executor.generateImage({ taskId: task.id, prompt: task.params.prompt, ... });
    } else if (task.type === TaskType.VIDEO) {
      await executor.generateVideo({ taskId: task.id, prompt: task.params.prompt, ... });
    }
    // 轮询等待完成
    const result = await waitForTaskCompletion(task.id, { timeout: 10 * 60 * 1000 });
    // 更新状态
    ...
  }
}
```

**原因**:
- SW 模式下，任务由 SW 自动执行（在 `submitToSW` 中）
- 降级模式下，任务只保存到 IndexedDB，没有后台进程执行它们
- `legacyTaskQueueService` 必须在 `createTask` 后自动调用 `executeTask`
- 同样，`retryTask` 也需要在重置状态后触发执行

**相关文件**:
- `packages/drawnix/src/services/task-queue-service.ts` - 降级模式任务服务
- `packages/drawnix/src/services/media-executor/factory.ts` - 执行器工厂
- `packages/drawnix/src/services/media-executor/fallback-executor.ts` - 降级执行器

### 创建图片/视频任务及执行时须传递 referenceImages

**场景**: MCP 工具（如 `image-generation.ts`、`video-generation.ts`）通过 `taskQueueService.createTask` 创建任务，降级模式下由 `executeTask` 调用 `executor.generateImage` / `generateVideo` 发起请求

❌ **错误示例**:
```typescript
// 错误：createTask 只传 uploadedImages，不传 referenceImages
const task = taskQueueService.createTask(
  {
    prompt,
    size: size || '1x1',
    uploadedImages: uploadedImages?.length ? uploadedImages : undefined,
    model,
    // 缺少 referenceImages → task.params.referenceImages 为空
  },
  TaskType.IMAGE
);

// 错误：executeTask 调用 executor 时不传 referenceImages
await executor.generateImage({
  taskId: task.id,
  prompt: task.params.prompt,
  model: task.params.model,
  size: task.params.size,
  // 缺少 referenceImages → 请求体不带参考图
});
```

✅ **正确示例**:
```typescript
// 正确：createTask 同时传入 referenceImages 与 uploadedImages
const task = taskQueueService.createTask(
  {
    prompt,
    size: size || '1x1',
    uploadedImages: uploadedImages?.length ? uploadedImages : undefined,
    referenceImages: referenceImages?.length ? referenceImages : undefined,
    model,
  },
  TaskType.IMAGE
);

// 正确：executeTask 从 task.params 取出 referenceImages 传给 executor
await executor.generateImage({
  taskId: task.id,
  prompt: task.params.prompt,
  model: task.params.model,
  size: task.params.size,
  referenceImages: task.params.referenceImages as string[] | undefined,
  uploadedImages: task.params.uploadedImages as Array<{ url?: string }> | undefined,
});
```

**原因**:
- 执行器（含 fallback）依赖 `params.referenceImages` 或 `params.inputReference` 构建请求体；仅传 `uploadedImages` 时，executor 可从 `uploadedImages` 提取 URL，但 `task.params` 中必须至少有一种来源（referenceImages 或 uploadedImages），且 createTask 与 executeTask 两处都要一致传递
- 视频任务同理：createTask 传 `referenceImages`，executeTask 传 `referenceImages` 或 `inputReference`，否则 sw=0 下 Form Data 不会包含 `input_reference`

**相关文件**:
- `packages/drawnix/src/mcp/tools/image-generation.ts` - 图片任务 createTask
- `packages/drawnix/src/mcp/tools/video-generation.ts` - 视频任务 createTask
- `packages/drawnix/src/services/task-queue-service.ts` - 降级 executeTask 调用 executor
- `packages/drawnix/src/services/sw-task-queue-service.ts` - SW 降级 executeWithFallback

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

### 工作流恢复时 UI 与 SW 状态不一致的处理

**场景**: 页面刷新后，UI 从 IndexedDB/本地存储恢复的状态可能与 SW 端的真实状态不一致

❌ **错误示例**:
```typescript
// 错误：检测到终态但有运行中步骤时，直接标记为失败
if (isTerminalStatus && hasRunningSteps) {
  hasClaimedRef.current = true;  // 标记为已 claim
  onWorkflowStateChange?.(workflowId, 'failed', '工作流已结束');
  return;  // 不再尝试从 SW 获取真实状态
}

// 后续即使 SW 更新了状态，也因为 hasClaimedRef.current = true 而跳过 claim
```

✅ **正确示例**:
```typescript
// 正确：不一致状态也触发 claim，从 SW 获取真实状态
const isInconsistentState = isTerminalStatus && hasRunningSteps;
const needsClaim = isActiveByStatus || isActiveBySteps || isInconsistentState;

if (isInconsistentState) {
  console.log('Inconsistent state detected, will claim from SW');
  // 不要在这里标记为 claimed，让 claim 逻辑去处理
}

// claim 逻辑会等待 swChannelClient 初始化，然后从 SW 获取真实状态
if (needsClaim && !hasClaimedRef.current) {
  hasClaimedRef.current = true;
  const result = await swChannelClient.claimWorkflow(workflowId);
  // 根据 SW 返回的真实状态更新 UI
}
```

**原因**:
- 页面刷新时，UI 状态可能来自旧的 IndexedDB 数据
- SW 端可能已经更新了工作流状态（如从 `failed` 变为 `running`）
- 如果直接根据本地状态判断，会导致用户看到错误的"失败"状态
- 正确做法是检测不一致状态后，从 SW 获取真实状态再更新 UI

### SW 重发 Tool Request 需延迟等待主线程 Handler 准备

**场景**: 页面刷新后，SW 在工作流 claim 时重发 pending tool request

❌ **错误示例**:
```typescript
// channel-manager.ts - handleWorkflowClaim 中
if ((workflow.status === 'running') && hasPendingToolRequest) {
  // 错误：立即重发，但主线程的 handler 可能还没注册
  this.resendPendingToolRequestsForWorkflow(workflowId);
}

// 结果：
// 1. SW 发送 publish('workflow:toolRequest', {...})
// 2. 主线程还没完成 registerToolRequestHandler()
// 3. publish 返回 undefined/null
// 4. SW 误判为"超时"，工作流失败
```

✅ **正确示例**:
```typescript
// 正确：延迟重发，等待主线程 handler 准备好
if ((workflow.status === 'running') && hasPendingToolRequest) {
  console.log(`Will resend pending tool requests after delay`);
  // 延迟 500ms，给主线程时间完成 registerToolRequestHandler
  setTimeout(() => {
    console.log(`Resending pending tool requests (delayed)`);
    this.resendPendingToolRequestsForWorkflow(workflowId);
  }, 500);
}
```

**原因**:
- 页面刷新后，组件挂载顺序不确定
- `WorkZoneContent` 的 claim 可能在 `WorkflowSubmissionService.registerToolRequestHandler()` 完成前执行
- SW 的 `publish()` 方法需要主线程已经 `subscribe()` 才能收到响应
- 500ms 延迟给主线程足够时间完成初始化（通常 200ms 内完成）

**初始化时序**:
```
页面刷新
    ↓
WorkflowSubmissionService.init()        WorkZoneContent.useEffect()
    ↓                                        ↓
registerToolRequestHandler()            swChannelClient.claimWorkflow()
(等待 swChannelClient 初始化)                ↓
    ↓                                   SW 收到 claim
swChannelClient.isInitialized()             ↓
    ↓                                   SW 重发 tool request ← 可能此时 handler 还没准备好！
subscribe('workflow:toolRequest')
```

### SW 错误处理链必须保持完整

**场景**: 在 SW 执行链中需要传递特殊错误属性（如 `isAwaitingClient`）时

❌ **错误示例**:
```typescript
// workflow-executor.ts - executeStep 中
try {
  await this.requestMainThreadTool(workflowId, stepId, toolName, args);
} catch (error) {
  // 错误：所有错误都标记为 failed
  step.status = 'failed';
  step.error = error.message;
}

// 然后在 executeWorkflow 循环中
if (step.status === 'failed') {
  // 错误：创建新的 Error 对象，丢失了 isAwaitingClient 属性
  throw new Error(`Step ${step.id} failed: ${step.error}`);
}

// 最后在 catch 块中
catch (error) {
  // error.message = "Step xxx failed: AWAITING_CLIENT:insert_mermaid"
  // 但 error.isAwaitingClient 是 undefined！
  if (error?.isAwaitingClient) {  // 永远为 false
    // 不会进入这个分支
  }
  workflow.status = 'failed';  // 错误地标记为失败
}
```

✅ **正确示例**:
```typescript
// workflow-executor.ts - executeStep 中
try {
  await this.requestMainThreadTool(workflowId, stepId, toolName, args);
} catch (error) {
  // 正确：检测特殊错误类型，保持原始属性
  if (error?.isAwaitingClient || error?.message?.startsWith('AWAITING_CLIENT:')) {
    // 保持 step 为 running 状态，重新抛出原始错误
    step.status = 'running';
    throw error;  // 保留 isAwaitingClient 属性
  }
  
  // 其他错误才标记为 failed
  step.status = 'failed';
  step.error = error.message;
}

// 在 catch 块中
catch (error) {
  // error.isAwaitingClient 现在是 true
  if (error?.isAwaitingClient) {
    console.log('Workflow waiting for client to reconnect');
    workflow.status = 'running';  // 保持 running 状态
    return;
  }
  workflow.status = 'failed';
}
```

**原因**:
- JavaScript 错误对象可以有自定义属性（如 `error.isAwaitingClient = true`）
- 在中间层创建新的 `Error` 对象会丢失这些属性
- 如果需要在上层检查特殊错误类型，必须重新抛出原始错误
- 或者在检查时同时检查 `error.message` 内容作为备选

### LLM API 日志必须记录异步任务的 remoteId

**场景**: 异步任务（视频生成、异步图片生成如 `nbp4k-async`）需要记录远程任务 ID 便于调试和任务恢复追踪

❌ **错误示例**:
```typescript
// failLLMApiLog 参数类型不支持 remoteId
export function failLLMApiLog(
  logId: string,
  params: {
    httpStatus?: number;
    duration: number;
    errorMessage: string;
    responseBody?: string;
    // 缺少 remoteId 字段
  }
): void { ... }

// 调用时 remoteId 被忽略或导致类型错误
failLLMApiLog(logId, {
  duration,
  errorMessage: msg,
  remoteId: taskRemoteId,  // ❌ 类型错误
});
```

✅ **正确示例**:
```typescript
// 参数类型支持 remoteId
export function failLLMApiLog(
  logId: string,
  params: {
    httpStatus?: number;
    duration: number;
    errorMessage: string;
    responseBody?: string;
    remoteId?: string;  // ✅ 支持异步任务 ID
  }
): void {
  const log = memoryLogs.find(l => l.id === logId);
  if (log) {
    // ... 其他字段
    if (params.remoteId) log.remoteId = params.remoteId;  // ✅ 记录 remoteId
    updateLogInDB(log);
  }
}

// completeLLMApiLog 同样需要支持
export function completeLLMApiLog(
  logId: string,
  params: {
    // ... 其他字段
    remoteId?: string;  // ✅ 成功时也记录 remoteId
  }
): void { ... }
```

**原因**:
- 异步任务通过 `remoteId` 标识后端任务，是恢复轮询的关键信息
- 调试时需要通过 `remoteId` 追踪任务在后端的状态
- `LLMApiLog` 接口已定义 `remoteId` 字段，日志函数参数也需要支持

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

**原因**: 独立的 React 树不会继承父级树的 Context。在 Opentu 中，画布元素是通过 SVG `foreignObject` 独立挂载的，必须通过 `ToolProviderWrapper` 显式重新提供 `I18nProvider`、`AssetProvider`、`WorkflowProvider` 和 `DrawnixContext` 等核心上下文，才能保证内部组件功能正常。

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

#### CPU 密集型循环需要 yield 让出主线程

**场景**: 在异步函数中执行大量同步操作（JSON.stringify、加密、checksum 计算等）时，即使函数是 async 的，循环内部如果没有 await 点，仍然会连续占用主线程，导致页面卡顿。

❌ **错误示例**:
```typescript
// 错误：虽然是 async 函数，但循环内部没有 yield 点
async function pushToRemote() {
  // 收集数据
  const localData = await collectSyncData();
  
  // 这个循环会连续执行，阻塞主线程
  for (const [boardId, board] of localData.boards) {
    const boardJson = JSON.stringify(board); // 同步操作
    const encrypted = await cryptoService.encrypt(boardJson); // 虽然有 await，但每次 await 之间的 JSON.stringify 会累积
    filesToUpdate[boardId] = encrypted;
  }
  // 用户可能看到页面卡顿、事件处理器超时警告
}
```

✅ **正确示例**:
```typescript
import { yieldToMain } from '@aitu/utils';

async function pushToRemote() {
  const localData = await collectSyncData();
  
  let processedCount = 0;
  for (const [boardId, board] of localData.boards) {
    const boardJson = JSON.stringify(board);
    const encrypted = await cryptoService.encrypt(boardJson);
    filesToUpdate[boardId] = encrypted;
    
    // 每处理 3 个画板让出主线程，避免 UI 阻塞
    processedCount++;
    if (processedCount % 3 === 0) {
      await yieldToMain();
    }
  }
}

// yieldToMain 的实现：
export const yieldToMain = (): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, 0));
};
```

**原因**:
- JavaScript 是单线程的，async/await 只是让代码看起来同步，但仍然在主线程执行
- 大量 `JSON.stringify()`、加密计算等同步操作会连续占用主线程
- 浏览器无法处理用户输入、渲染更新，导致 `[Violation] 'mouseup' handler took 606ms` 等警告
- `yieldToMain()` 通过 `setTimeout(0)` 将后续执行推迟到下一个事件循环，让浏览器有机会处理待处理事件

**最佳实践**:
- 每 3-5 个耗时操作后调用一次 `await yieldToMain()`
- 可以使用 `@aitu/utils` 中的 `processBatched()` 函数自动处理分批
- 适用场景：同步、备份、批量导入导出、大量数据处理

**参考文件**:
- `packages/utils/src/async/index.ts` - `yieldToMain` 和 `processBatched` 工具函数
- `packages/drawnix/src/services/github-sync/sync-engine.ts` - 同步引擎中的使用示例

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

#### 统计与监控上报旁路化

**场景**: 使用 PostHog、Sentry、Web Vitals、Page Report 等统计/监控上报时，若在首屏或用户操作路径上同步执行初始化、脱敏、capture，会抢主线程与网络，导致 LCP/INP 变差，甚至触发 413 等错误。

❌ **错误示例**:
```typescript
// 错误：首屏 1s 后同步初始化监控，与主流程抢 CPU
setTimeout(() => {
  initWebVitals();
  initPageReport();
}, 1000);

// 错误：在 track 内同步脱敏 + capture，阻塞调用方
track(eventName: string, eventData?: Record<string, any>) {
  const sanitized = sanitizeObject(eventData);
  window.posthog.capture(eventName, sanitized);
}

// 错误：在 Web Vitals 回调栈里直接上报，占用性能回调时间
function reportWebVitals(metric: Metric) {
  analytics.track('$web_vitals', eventProperties); // 同步
}
```

✅ **正确示例**:
```typescript
// 正确：用 requestIdleCallback 在空闲时初始化（无则 setTimeout 兜底）
const scheduleMonitoring = () => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(initMonitoring, { timeout: 3000 });
  } else {
    setTimeout(initMonitoring, 3000);
  }
};
scheduleMonitoring();

// 正确：脱敏与 capture 在 requestIdleCallback/setTimeout 中执行，调用方同步返回
track(eventName: string, eventData?: Record<string, any>) {
  const doTrack = () => {
    try {
      const sanitized = eventData ? sanitizeObject(eventData) : undefined;
      window.posthog!.capture(eventName, sanitized);
    } catch (e) {
      console.debug('[Analytics] track failed', e);
    }
  };
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(doTrack, { timeout: 2000 });
  } else {
    setTimeout(doTrack, 0);
  }
}

// 正确：先延后再上报，不阻塞 CWV 回调栈
function reportWebVitals(metric: Metric) {
  setTimeout(() => analytics.track('$web_vitals', eventProperties), 0);
}
```

**原因**:
- 统计上报是旁路逻辑，不得影响首屏与交互性能
- 初始化延后到空闲可避免与主流程争抢；track 内延后执行脱敏与网络请求，调用方不阻塞
- 失败只 log（如 console.debug），不向上 throw，避免影响主流程

**参考**: `apps/web/src/main.tsx`（统计 init）、`packages/drawnix/src/utils/posthog-analytics.ts`（track 旁路）、`packages/drawnix/src/services/web-vitals-service.ts`（CWV 延后上报）

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

#### 配置对象返回深拷贝防止意外修改

**场景**: 设置管理器返回配置对象后，外部代码（如脱敏函数）修改返回值

❌ **错误示例**:
```typescript
// 错误：getSetting 返回直接引用
class SettingsManager {
  private settings: Record<string, any> = {};
  
  public getSetting<T>(path: string): T {
    const keys = path.split('.');
    let value = this.settings;
    for (const key of keys) {
      value = value?.[key];
    }
    return value as T;  // 返回直接引用！
  }
}

// 使用时：外部代码修改了返回值
const config = settingsManager.getSetting('gemini');
sanitizeObject(config);  // sanitizeObject 修改了 config.apiKey 为 '[REDACTED]'
// 现在全局设置中的 apiKey 也变成了 '[REDACTED]'！
```

✅ **正确示例**:
```typescript
// 正确：返回深拷贝
class SettingsManager {
  private settings: Record<string, any> = {};
  
  public getSetting<T>(path: string): T {
    const keys = path.split('.');
    let value = this.settings;
    for (const key of keys) {
      value = value?.[key];
    }
    
    // 返回深拷贝，防止外部代码修改返回值影响原始设置
    if (value && typeof value === 'object') {
      return JSON.parse(JSON.stringify(value)) as T;
    }
    return value as T;
  }
}

// 使用时：外部代码修改的是副本，不影响原始设置
const config = settingsManager.getSetting('gemini');
sanitizeObject(config);  // 修改的是副本
// 全局设置中的 apiKey 保持不变
```

**原因**: 
- `sanitizeObject` 等脱敏函数会修改传入的对象（如将 `apiKey` 替换为 `[REDACTED]`）
- 如果返回直接引用，脱敏函数会意外修改全局配置
- 这会导致后续 API 调用使用被脱敏的值（如 `"[REDACTED]"` 或 `"{key}"`）而失败
- 返回深拷贝确保全局配置不会被外部代码意外修改

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

❌ **错误示例（黑名单 - 太宽松）**:
```typescript
// 排除少数已知失败，其余全部恢复 - 错误！
const isDefinitiveFailure = (task: Task): boolean => {
  const msg = task.error?.message?.toLowerCase() || '';
  return msg.includes('prohibited') || msg.includes('content policy');
};
failedTasks.forEach(task => {
  if (!isDefinitiveFailure(task)) {
    taskService.updateStatus(task.id, 'processing'); // 服务端真正失败的也被恢复了！
  }
});
```

✅ **正确示例（白名单 - 只恢复客户端中断）**:
```typescript
// 白名单：只恢复因页面刷新/客户端中断导致的失败
const RECOVERABLE_ERROR_CODES = new Set([
  'INTERRUPTED',                  // 页面刷新中断
  'INTERRUPTED_DURING_SUBMISSION', // 提交过程中中断
  'RESUME_FAILED',                // 上次恢复尝试失败
]);

failedTasks.forEach(task => {
  const errorCode = task.error?.code || '';
  if (!RECOVERABLE_ERROR_CODES.has(errorCode)) return; // 服务端失败不恢复
  taskService.updateStatus(task.id, 'processing');
});
```

**原因**:
1. **黑名单遗漏**：无法穷举所有服务端错误类型，新增的错误类型会被误恢复
2. **白名单安全**：只有我们自己设置的中断错误码才恢复，服务端返回的任何失败都保持终态
3. **failed 是终态**：用户看到失败后刷新页面，不应该看到任务又变成进行中

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

| 任务类型 | 错误码 | 是否自动恢复 | 原因 |
|---------|---------|-------------|------|
| 视频/异步图片 | `INTERRUPTED` | ✅ 是 | 页面刷新中断，查询状态不扣费 |
| 视频/异步图片 | `INTERRUPTED_DURING_SUBMISSION` | ✅ 是 | 提交中断，可能已在后台执行 |
| 视频/异步图片 | `RESUME_FAILED` | ✅ 是 | 上次恢复失败，值得重试 |
| 任何类型 | 服务端返回的错误 | ❌ 否 | 业务失败重试也不会成功 |
| 同步图片 | 任何错误 | ❌ 否 | 每次调用都扣费 |

---

#### 错误 5: fire-and-forget 写入后立即异步读取导致竞态

**场景**: 内存状态更新后通过 fire-and-forget 持久化到 IndexedDB，另一个模块随后从 IndexedDB 读取

❌ **错误示例**:
```typescript
// useTaskStorage: 恢复任务状态（内存同步更新 + IndexedDB 异步写入）
taskQueueService.updateTaskStatus(task.id, 'processing'); // 内存立即更新，persistTask() fire-and-forget

// fallback-executor: 从 IndexedDB 读取（可能读到旧状态！）
const tasks = await taskStorageReader.getAllTasks({ status: 'processing' });
// tasks 可能为空 — IndexedDB 写入尚未完成
```

✅ **正确示例**:
```typescript
// 从内存读取，始终是最新状态
const allTasks = taskQueueService.getAllTasks();
fallbackExecutor.resumePendingTasks(onUpdate, allTasks);

// resumePendingTasks 优先使用传入的内存数据
async resumePendingTasks(onUpdate, tasksFromMemory?: Task[]) {
  const tasks = tasksFromMemory
    ? tasksFromMemory.filter(t => t.status === 'processing')
    : await taskStorageReader.getAllTasks({ status: 'processing' }); // fallback
}
```

**原因**: `persistTask()` 是 fire-and-forget（不 await），IndexedDB 写入有延迟。如果另一个模块紧接着从 IndexedDB 读取，可能读到写入前的旧数据。内存中的状态是同步更新的，应优先使用。

---

#### 错误 6: useEffect 中初始对账遍历所有任务导致死循环

**场景**: useEffect 内遍历任务列表执行对账，对账触发状态更新，依赖项变化导致 useEffect 重跑

❌ **错误示例**:
```typescript
useEffect(() => {
  // 初始对账：处理所有终态任务
  const allTasks = taskQueueService.getAllTasks();
  for (const task of allTasks) {
    processTaskEvent(task); // 可能触发 workflowControl.updateStep → 状态更新 → 重渲染
  }

  const sub = taskQueueService.observe().subscribe(handleEvent);
  return () => sub.unsubscribe();
}, [workflowControl]); // workflowControl 每次渲染都是新引用 → 死循环！
```

✅ **正确示例**:
```typescript
const reconciliationDoneRef = useRef(false);

useEffect(() => {
  // 用 ref 确保初始对账只执行一次
  if (!reconciliationDoneRef.current) {
    reconciliationDoneRef.current = true;
    const allTasks = taskQueueService.getAllTasks();
    for (const task of allTasks) {
      processTaskEvent(task);
    }
  }

  const sub = taskQueueService.observe().subscribe(handleEvent);
  return () => sub.unsubscribe();
}, [workflowControl]);
```

**原因**: 初始对账中的 `processTaskEvent` 可能触发状态更新（如 `workflowControl.updateStep`），导致组件重渲染。如果 `workflowControl` 未被 useMemo 包裹，每次渲染都是新引用，useEffect 会重新执行，形成死循环。用 ref 守卫确保对账逻辑只跑一次。

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

**原因**: 初始状态下筛选变量可能为 `undefined`。进行逻辑判断时，必须同时考虑 `undefined`、`null` 和 `'ALL'` 这几种代表”不筛选”的情况，否则会导致筛选结果意外为空。

### API 错误字段类型安全

**场景**: 处理外部 API 返回的 error 字段时，`error` 可能是字符串也可能是对象

❌ **错误示例**:
```typescript
// API 返回：{ error: { code: “generation_failed”, message: “[403]...” } }
const data = await response.json();
throw new Error(data.error || data.message || 'Failed');
// data.error 是对象 → new Error({...}) → error.message = “[object Object]”
```

✅ **正确示例**:
```typescript
const data = await response.json();
const errMsg = typeof data.error === 'string'
  ? data.error
  : (data.error?.message || data.message || 'Failed');
const error = new Error(errMsg);
if (typeof data.error === 'object' && data.error?.code) {
  (error as any).code = data.error.code;
}
throw error;
```

**原因**: `new Error(value)` 内部调用 `String(value)`，对象会变成 `”[object Object]”`。API 的 `error` 字段格式不统一（有的返回字符串，有的返回 `{ code, message }` 对象），必须用 `typeof` 区分处理。

### 数值范围转换规则

**场景**: 回调链中传递进度/百分比等数值时，必须明确每一层的值域范围并保持一致

❌ **错误示例**:
```typescript
// pollVideoStatus 回调返回 0-1 范围
onProgress(apiProgress / 100); // 100 → 1.0

// 调用方误以为是 0-100 范围，乘以 0.8
options?.onProgress?.({ progress: 10 + progress * 0.8 });
// 结果：10 + 1.0 * 0.8 = 10.8，而非预期的 90
```

✅ **正确示例**:
```typescript
// 明确注释值域范围
onProgress(apiProgress / 100); // 输出 0-1

// 正确映射：0-1 → 10-90 需乘以 80
// progress 是 0-1 范围，映射到 10-90：10 + (0~1) * 80
options?.onProgress?.({ progress: 10 + progress * 80 });
// 结果：10 + 1.0 * 80 = 90 ✓
```

**原因**: 回调链跨多层传递数值时，0-1 和 0-100 两种范围容易混淆。每个回调的输入/输出值域必须用注释明确标注，映射公式应能通过边界值（0 和 max）验证正确性。

---


## Plait 插件规范

#### 自定义组件 onContextChanged 必须处理 viewport 变化

**场景**: 创建自定义 Plait 组件（继承 `PlaitPluginElementComponent`）时，选择框（蓝色虚线 + 控制点）在缩放/平移画布后与元素偏移。

❌ **错误示例**:
```typescript
// 错误：onContextChanged 没有处理 viewport 变化
onContextChanged(
  value: PlaitPluginElementContext<MyElement, PlaitBoard>,
  previous: PlaitPluginElementContext<MyElement, PlaitBoard>
): void {
  if (value.element !== previous.element || value.hasThemeChanged) {
    this.activeGenerator.processDrawing(this.element, PlaitBoard.getActiveHost(this.board), { selected: this.selected });
  } else {
    const needUpdate = value.selected !== previous.selected;
    if (needUpdate || value.selected) {
      this.activeGenerator.processDrawing(this.element, PlaitBoard.getActiveHost(this.board), { selected: this.selected });
    }
  }
  // 问题：缩放/平移画布后，选择框位置不更新，与元素产生偏移
}
```

✅ **正确示例**:
```typescript
// 正确：检测 viewport 变化并重绘选择框（参考 ToolComponent）
onContextChanged(
  value: PlaitPluginElementContext<MyElement, PlaitBoard>,
  previous: PlaitPluginElementContext<MyElement, PlaitBoard>
): void {
  const viewportChanged =
    value.board.viewport.zoom !== previous.board.viewport.zoom ||
    value.board.viewport.offsetX !== previous.board.viewport.offsetX ||
    value.board.viewport.offsetY !== previous.board.viewport.offsetY;

  if (value.element !== previous.element || value.hasThemeChanged) {
    this.activeGenerator.processDrawing(this.element, PlaitBoard.getActiveHost(this.board), { selected: this.selected });
  } else if (viewportChanged && value.selected) {
    // viewport 改变且元素被选中时，更新选择框位置
    this.activeGenerator.processDrawing(this.element, PlaitBoard.getActiveHost(this.board), { selected: this.selected });
  } else {
    const needUpdate = value.selected !== previous.selected;
    if (needUpdate || value.selected) {
      this.activeGenerator.processDrawing(this.element, PlaitBoard.getActiveHost(this.board), { selected: this.selected });
    }
  }
}
```

**原因**: 选择框渲染在 `board-active-svg`（独立 SVG，无 viewBox），坐标通过 `toActiveRectangleFromViewBoxRectangle` 实时计算。而元素渲染在 `board-host-svg`（有 viewBox 自动映射坐标）。当 viewport 变化时，host-svg 中的元素位置自动调整，但 active-svg 上的选择框必须手动重新计算坐标才能对齐。`ToolComponent` 已正确实现了此模式。

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

#### 媒体封面/占位统一使用公共组件

**场景**: 音频封面、音频缩略图、播放器封面等媒体入口需要处理无图、404 和加载失败。

❌ **错误示例**:
```tsx
{previewImageUrl && !loadFailed ? (
  <img src={previewImageUrl} onError={() => setLoadFailed(true)} />
) : (
  <div className="audio-fallback">
    <Music4 />
  </div>
)}
```

✅ **正确示例**:
```tsx
<AudioCover
  src={previewImageUrl}
  fallbackSrc={posterUrl}
  alt={title || 'Audio cover'}
  imageClassName="player__cover-image"
  fallbackClassName="player__cover-fallback"
/>
```

**规则**:
- 媒体封面加载失败兜底逻辑要收敛到公共组件，禁止在播放器、画布节点、预览器里重复维护一套 `onError + useState`
- 默认封面视觉必须统一，后续改默认图时只改一处
- 若存在 `thumbnailUrl -> 原图 URL` 的回退链路，应由公共组件统一支持
- 业务组件只负责尺寸、布局、圆角样式，不负责重复实现失败状态机

**原因**:
- 音频相关展示入口分散，重复实现很容易出现“有的地方有占位，有的地方白屏/裂图”
- 公共组件可以统一失败行为、减少重复代码，并降低后续视觉调整成本

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

#### 第三方统计与 Session Replay 对主线程与请求体的影响

**场景**: 接入第三方统计/监控（如 PostHog）或开启 Session Replay（如 rrweb）时。

**要点**:
- 开启 Session Replay 前需评估：主线程开销（wheel、mousemove、setInterval 等）、单次上报体体积（易触发 413 Content Too Large）。
- 默认建议关闭或按采样开启；若开启，需配置限流、单批大小与 413 错误处理（如 on_xhr_error / on_request_error 中识别 413 后丢弃或有限重试并打 debug 日志），避免无限重试加重主线程与网络负担。
- 统计上报须遵循「统计上报旁路化」：初始化与上报在 requestIdleCallback 或 setTimeout 中执行，不在主路径上做脱敏与网络请求；失败静默不向上抛。

❌ **错误示例**:
```javascript
// 错误：默认开启 Session Recording，导致 wheel/setInterval 卡顿与 413
posthog.init('phc_xxx', {
  api_host: 'https://us.i.posthog.com',
  // 未设置 disable_session_recording，rrweb 默认录制
});
```

✅ **正确示例**:
```javascript
// 正确：默认关闭 Session Recording，并处理 413 避免重试风暴
posthog.init('phc_xxx', {
  api_host: 'https://us.i.posthog.com',
  disable_session_recording: true,
  rate_limiting: { events_per_second: 10, events_burst_limit: 30 },
  on_xhr_error: function(err) {
    if (err && (err.statusCode ?? err.status) === 413) {
      console.debug('[PostHog] 413 Content Too Large, batch dropped');
    }
  },
});
```

**原因**: Session Replay（rrweb）在滚轮、鼠标移动和定时器中录制 DOM/输入，会直接占用主线程并产生大量数据，单次 flush 易超服务端限制导致 413；413 响应常不带 CORS 头，浏览器会先报 CORS。关闭或按采样开启、并处理 413 可消除卡顿与报错。

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

#### LLM 响应格式兼容性

**场景**: 解析 AI 模型返回的工作流 JSON 时，不同模型返回格式可能不同。

❌ **错误示例**:
```typescript
// 错误：只处理标准格式，忽略其他可能的格式
function parseToolCalls(response: string) {
  const parsed = JSON.parse(response);
  // 只处理 {"content": "...", "next": [...]} 格式
  return parsed.next.map(item => ({...}));
}
```

✅ **正确示例**:
```typescript
// 正确：支持多种 AI 返回格式
function parseToolCalls(response: string): ToolCall[] {
  // 格式 1: {"content": "分析完成", "next": [{"mcp": "...", "args": {...}}]}
  const workflowJson = parseWorkflowJson(response);
  if (workflowJson?.next.length > 0) {
    return workflowJson.next.map(...);
  }

  // 格式 2: {"content": "[{\"mcp\": \"...\", \"args\": {...}}]"}
  // content 字段本身是 JSON 数组字符串
  if (next.length === 0 && parsed.content?.trim().startsWith('[')) {
    const contentParsed = JSON.parse(parsed.content);
    if (Array.isArray(contentParsed)) next = contentParsed;
  }

  // 格式 3: [{"mcp": "...", "args": {...}}] 直接数组
  if (cleaned.trim().startsWith('[')) {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map(...);
  }

  // 格式 4: 支持 name/mcp 和 arguments/args 字段名
  const name = parsed.name || parsed.mcp;
  const args = parsed.arguments || parsed.args || parsed.params;
  
  return toolCalls;
}
```

**原因**: 不同 LLM 模型（GPT、Gemini、DeepSeek 等）对同一 prompt 可能返回不同格式的 JSON，必须兼容多种格式以确保工作流正确执行。

---

#### 工作流状态同步使用事件驱动 + 初始对账

**场景**: 在 UI 组件中同步工作流执行状态时。

❌ **错误示例**:
```typescript
// 错误：轮询 IndexedDB 同步状态（多条同步路径互相竞争导致状态闪烁）
class WorkflowStatusSyncService {
  subscribe(workflowId: string, callback: StatusChangeCallback): () => void {
    // 每秒从 IndexedDB 读取 → 与事件驱动路径竞争 → 状态覆盖
  }
}
```

✅ **正确示例**:
```typescript
// 正确：统一事件驱动路径 + 挂载时一次性对账
// TaskQueueService → RxJS → useTaskWorkflowSync → WorkflowContext + WorkZone + ChatDrawer
useEffect(() => {
  // 初始对账：处理挂载前已完成的终态任务
  const allTasks = taskQueueService.getAllTasks();
  for (const task of allTasks) {
    if (task.status === 'completed' || task.status === 'failed') {
      processTaskEvent({ type: 'taskUpdated', task, timestamp: Date.now() });
    }
  }
  // 订阅后续实时事件
  const sub = taskQueueService.observeTaskUpdates().subscribe(processTaskEvent);
  return () => sub.unsubscribe();
}, []);
```

**原因**:
1. 单一事件驱动路径消除多路径竞争导致的状态闪烁
2. 初始对账替代轮询，只执行一次，覆盖挂载前错过的终态事件
3. TaskQueueService 内存 Map 是唯一数据源，无需从 IndexedDB 拉取

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

### postmessage-duplex RPC 消息大小限制

**场景**: 使用 postmessage-duplex 进行 SW 与主线程通信，查询大量数据时

❌ **错误示例**:
```typescript
// 错误：一次性返回所有日志，可能超过 1MB 限制
async function getAllLogs() {
  const logs = await db.getAll(); // 可能有上千条，每条包含大字段
  return { logs }; // Message size exceeds limit (1048576 bytes)
}

// 错误：前端分页，但后端返回全量数据
async function getLogsPaginated(page, pageSize) {
  const allLogs = await db.getAll();
  return { logs: allLogs.slice((page-1)*pageSize, page*pageSize) };
}
```

✅ **正确示例**:
```typescript
// 正确：后端分页 + 精简数据
async function getLogsPaginated(page = 1, pageSize = 20, filter = {}) {
  let logs = await db.getAll();
  
  // 1. 先过滤（在分页前）
  if (filter.type) logs = logs.filter(l => l.type === filter.type);
  if (filter.status) logs = logs.filter(l => l.status === filter.status);
  
  // 2. 计算分页信息
  const total = logs.length;
  const totalPages = Math.ceil(total / pageSize);
  
  // 3. 分页
  const pagedLogs = logs.slice((page-1)*pageSize, page*pageSize);
  
  // 4. 精简数据，去掉大字段
  const compactLogs = pagedLogs.map(log => ({
    id: log.id,
    timestamp: log.timestamp,
    status: log.status,
    // 截断长文本
    prompt: log.prompt?.substring(0, 200),
    // 不传输 requestBody、responseBody 等大字段
  }));
  
  return { logs: compactLogs, total, page, pageSize, totalPages };
}
```

**原因**:
- postmessage-duplex 默认消息大小限制为 1MB（1048576 bytes）
- 日志数据通常包含大字段（请求体、响应体、图片 base64 等），100 条日志可能超过 10MB
- 解决方案：后端分页 + 精简数据，每页 20 条左右，去掉大字段
- 如需完整数据，提供单条查询接口，按需获取

**相关文件**: 
- `apps/web/src/sw/task-queue/llm-api-logger.ts` - `getLLMApiLogsPaginated`
- `apps/web/src/sw/task-queue/channel-manager.ts` - `handleDebugGetLLMApiLogs`

### 主线程直接读取 IndexedDB 优于 RPC

**场景**: 主线程需要从 Service Worker 读取存储在 IndexedDB 中的数据（任务列表、工作流状态等）

❌ **错误示例**:
```typescript
// 错误：通过 RPC 从 SW 读取 IndexedDB 数据
async function getAllTasks() {
  // 问题：
  // 1. postMessage 有 1MB 大小限制，大数据量会失败
  // 2. RPC 可能超时（SW 更新、连接断开等）
  // 3. 需要复杂的分页和重试逻辑
  return await swChannelClient.listTasksPaginated({ offset: 0, limit: 1000 });
}
```

✅ **正确示例**:
```typescript
// 正确：主线程直接读取 IndexedDB
// 创建专用的 storage reader（如 task-storage-reader.ts）
class TaskStorageReader {
  async getAllTasks(): Promise<Task[]> {
    const db = await this.getDB();
    const store = db.transaction('tasks', 'readonly').objectStore('tasks');
    const tasks = await store.getAll();
    return tasks.map(convertSWTaskToTask);
  }
}

// 使用时，RPC 作为 fallback
async function getAllTasks() {
  if (await taskStorageReader.isAvailable()) {
    return await taskStorageReader.getAllTasks();  // 直接读取
  }
  // Fallback to RPC（仅在 IndexedDB 不可用时）
  return await swChannelClient.listTasksPaginated(...);
}
```

**原因**:
- IndexedDB 是浏览器共享的，主线程和 SW 都可以直接访问
- 直接读取避免了 postMessage 的 1MB 大小限制
- 直接读取更稳定，不受 SW 连接状态影响
- 写操作仍需通过 SW，以保持数据一致性和触发业务逻辑

**适用场景**:
| 操作类型 | 推荐方式 | 原因 |
|---------|---------|------|
| 读取任务列表 | 直接读取 IndexedDB | 数据量大，避免 RPC 限制 |
| 读取工作流状态 | 直接读取 IndexedDB | 避免 RPC 超时问题 |
| 创建任务 | 通过 RPC | SW 需执行业务逻辑 |
| 提交工作流 | 通过 RPC | SW 需开始执行 |
| 读取内存状态 | 通过 RPC | 数据只存在于 SW 内存 |

**相关文件**:
- `packages/drawnix/src/services/task-storage-reader.ts`
- `packages/drawnix/src/services/workflow-storage-reader.ts`
- `packages/drawnix/src/services/base-storage-reader.ts`

### RPC 超时与重连策略

**场景**: 关键 RPC 调用（如工作流提交）可能因 SW 连接不稳定而超时

❌ **错误示例**:
```typescript
// 错误：直接调用 RPC，没有超时处理和重连逻辑
async submit(workflow: WorkflowDefinition): Promise<void> {
  if (!swChannelClient.isInitialized()) {
    throw new Error('SWChannelClient not initialized');
  }
  // 使用默认 120 秒超时，用户等待时间过长
  const result = await swChannelClient.submitWorkflow(workflow);
  if (!result.success) {
    throw new Error(result.error);
  }
}
```

✅ **正确示例**:
```typescript
// 正确：设置合理超时，超时时重连并重试
async submit(workflow: WorkflowDefinition): Promise<void> {
  const maxRetries = 2;
  const submitTimeout = 15000; // 15 秒超时
  
  const ensureSWReady = async (): Promise<boolean> => {
    if (!swChannelClient.isInitialized()) {
      try {
        await swChannelClient.initialize();
      } catch {
        return false;
      }
    }
    return true;
  };
  
  const submitWithTimeout = async () => {
    return Promise.race([
      swChannelClient.submitWorkflow(workflow),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), submitTimeout)
      )
    ]);
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await ensureSWReady();
      const result = await submitWithTimeout();
      if (result.success) return;
    } catch (error) {
      if (error.message === 'timeout' && attempt < maxRetries - 1) {
        // 超时时重新初始化连接
        await swChannelClient.initialize();
      }
    }
  }
  throw new Error('Submit failed after retries');
}
```

**原因**:
- SW 可能因更新、重启等原因暂时无法响应
- 默认 120 秒超时让用户等待时间过长
- 15-30 秒是更合理的超时时间
- 超时后主动重连可以解决临时的连接问题

**相关文件**:
- `packages/drawnix/src/services/workflow-submission-service.ts`

### 降级路径必须保持与 SW 模式相同的功能行为

**场景**: 当 Service Worker 不可用时，代码会降级到主线程直接调用 API。降级路径需要保持与 SW 模式相同的功能行为，包括日志记录、错误处理等。

❌ **错误示例**:
```typescript
// 错误：降级路径没有记录 LLM API 日志
async function generateImageDirect(prompt: string): Promise<any> {
  const response = await fetch('/images/generations', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
  return response.json();
  // ❌ 没有记录日志，调试面板看不到这次调用
}
```

✅ **正确示例**:
```typescript
// 正确：降级路径也要记录日志
import { startLLMApiLog, completeLLMApiLog, failLLMApiLog } from './llm-api-logger';

async function generateImageDirect(prompt: string): Promise<any> {
  const startTime = Date.now();
  
  // 开始记录
  const logId = startLLMApiLog({
    endpoint: '/images/generations',
    model: modelName,
    taskType: 'image',
    prompt,
  });
  
  try {
    const response = await fetch('/images/generations', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      failLLMApiLog(logId, {
        httpStatus: response.status,
        duration: Date.now() - startTime,
        errorMessage: error,
      });
      throw new Error(error);
    }
    
    const result = await response.json();
    completeLLMApiLog(logId, {
      httpStatus: response.status,
      duration: Date.now() - startTime,
      resultType: 'image',
    });
    return result;
  } catch (error) {
    failLLMApiLog(logId, {
      duration: Date.now() - startTime,
      errorMessage: error.message,
    });
    throw error;
  }
}
```

**原因**:
- SW 模式和降级模式都写入同一个 IndexedDB（`llm-api-logs`）
- 调试面板 `/sw-debug.html?tab=llmapi` 直接从 IndexedDB 读取日志
- 如果降级路径不记录日志，调试时会漏掉这些 API 调用
- 统一的日志记录有助于成本追踪和问题排查

**相关文件**:
- `packages/drawnix/src/services/media-executor/llm-api-logger.ts` - 主线程日志记录器
- `apps/web/src/sw/task-queue/llm-api-logger.ts` - SW 日志记录器
- `packages/drawnix/src/utils/gemini-api/services.ts` - `generateImageDirect`
- `packages/drawnix/src/services/video-api-service.ts` - `submitVideoGeneration`

### 分页查询必须在服务端过滤

**场景**: 实现带过滤条件的分页列表时

❌ **错误示例**:
```typescript
// 错误：后端分页，前端过滤
// 后端
async function getLogsPaginated(page, pageSize) {
  const allLogs = await db.getAll();
  return { 
    logs: allLogs.slice((page-1)*pageSize, page*pageSize),
    total: allLogs.length 
  };
}

// 前端
function getFilteredLogs() {
  // 只能过滤当前页，总数也不对
  return state.logs.filter(l => l.type === filter.type);
}
```

✅ **正确示例**:
```typescript
// 正确：过滤条件传到后端，先过滤再分页
// 后端
async function getLogsPaginated(page, pageSize, filter) {
  let logs = await db.getAll();
  
  // 先过滤
  if (filter.type) logs = logs.filter(l => l.type === filter.type);
  if (filter.status) logs = logs.filter(l => l.status === filter.status);
  
  // 再分页（基于过滤后的数据）
  const total = logs.length;
  const totalPages = Math.ceil(total / pageSize);
  const pagedLogs = logs.slice((page-1)*pageSize, page*pageSize);
  
  return { logs: pagedLogs, total, page, pageSize, totalPages };
}

// 前端
function onFilterChange() {
  // 过滤条件变化时重新加载第一页
  loadLogs(1);
}
```

**原因**:
- 前端过滤只能处理当前页数据，无法看到其他页符合条件的数据
- 分页信息（总数、总页数）会不准确
- 过滤条件变化时应回到第一页，避免显示空白页

### 云端同步恢复数据时保留原始 URL

**场景**: 从云端同步/恢复任务数据到本地时，处理媒体 URL

❌ **错误示例**:
```typescript
// 错误：修改任务的 result.url 为新格式
const processedTasks = tasksToRestore.map(task => {
  if (task.result?.url) {
    const cacheUrl = `/__aitu_cache__/${taskType}/synced-${task.id}.${extension}`;
    return {
      ...task,
      result: {
        ...task.result,
        url: cacheUrl,  // 修改了原始 URL
        originalUrl: task.result.url,
      },
    };
  }
  return task;
});
```

**问题**: 画布上引用原始 URL 的元素无法显示，因为 Cache Storage 中只有新 URL 的数据。

✅ **正确示例**:
```typescript
// 正确：保留原始 URL，将数据缓存到原始 URL 位置
const processedTasks = tasksToRestore.map(task => {
  if (task.result?.url?.startsWith("/__aitu_cache__/")) {
    return {
      ...task,
      result: {
        ...task.result,
        needsMediaDownload: true,  // 只添加标记，不修改 URL
      },
    };
  }
  return task;
});

// 下载媒体时，缓存到原始 URL 位置
async downloadAndCacheMediaForTask(task) {
  const cacheUrl = task.result?.url;  // 使用原始 URL
  const blob = await downloadFromGist(task.id);
  await unifiedCacheService.cacheToCacheStorageOnly(cacheUrl, blob);  // 缓存到原始位置
}
```

**原因**:
- 画布元素引用的是原始 URL（如 `/__aitu_cache__/image/xxx.png`）
- 修改 URL 会导致画布元素与缓存数据不匹配
- 正确做法是将下载的数据缓存到原始 URL 对应的位置

### 增量同步优化：使用 checksum 减少网络请求

**场景**: 实现云端数据同步功能时

❌ **错误示例**:
```typescript
// 错误：每次都上传/下载所有数据
async pushToRemote() {
  const localData = await collectSyncData();
  const encryptedFiles = await serialize(localData);  // 序列化所有数据
  await gitHubApiService.updateGistFiles(encryptedFiles);  // 上传所有文件
}
```

✅ **正确示例**:
```typescript
// 正确：增量同步，只传输有变化的数据
async pushToRemote() {
  const localData = await collectSyncData();
  
  // 1. 获取远程 manifest 比较
  const remoteManifest = await getRemoteManifest();
  
  // 2. 使用 checksum 比较，只上传有变化的画板
  const filesToUpdate = {};
  for (const [boardId, board] of localData.boards) {
    const localChecksum = calculateBoardChecksum(board);
    const remoteInfo = remoteManifest?.boards[boardId];
    
    if (!remoteInfo || remoteInfo.checksum !== localChecksum) {
      filesToUpdate[boardFile(boardId)] = await encrypt(board);
    }
  }
  
  // 3. 只更新有变化的文件
  if (Object.keys(filesToUpdate).length > 0) {
    await gitHubApiService.updateGistFiles(filesToUpdate);
  }
}
```

**原因**:
- 全量同步会产生大量不必要的网络请求
- 使用 checksum 可以精确识别哪些数据有变化
- 只传输变化的数据可以显著减少带宽和延迟
- manifest/workspace/prompts/tasks 等小文件可以始终更新

### 同步数据双向合并：下载后自动上传

**场景**: 从远程下载数据时，需要与本地数据合并，确保双向同步

❌ **错误示例**:
```typescript
// 错误：单向合并，只下载远程有但本地没有的数据
async pullFromRemote() {
  const remoteTasks = await fetchRemoteTasks();
  const localTaskIds = new Set(localTasks.map(t => t.id));
  
  // 只恢复本地不存在的任务
  const tasksToRestore = remoteTasks.filter(t => !localTaskIds.has(t.id));
  await restoreTasks(tasksToRestore);
  
  // 问题：本地有但远程没有的数据不会同步到远程
}
```

✅ **正确示例**:
```typescript
// 正确：双向合并，基于 ID 去重，合并后自动上传
async pullFromRemote() {
  const remoteTasks = await fetchRemoteTasks();
  const localTaskMap = new Map(localTasks.map(t => [t.id, t]));
  
  // 1. 基于 ID 去重合并，使用 updatedAt 判断保留哪个版本
  const tasksToRestore: Task[] = [];
  for (const remoteTask of remoteTasks) {
    const localTask = localTaskMap.get(remoteTask.id);
    
    if (!localTask) {
      // 本地不存在，需要恢复
      tasksToRestore.push(remoteTask);
    } else if (remoteTask.updatedAt > localTask.updatedAt) {
      // 远程更新，使用远程版本
      tasksToRestore.push(remoteTask);
    }
    // 本地版本更新或相同，保留本地版本
  }
  
  await restoreTasks(tasksToRestore);
  
  // 2. 合并完成后，自动上传合并后的数据到远程
  await uploadMergedTasksToRemote();
}

async uploadMergedTasksToRemote() {
  // 收集本地所有数据（包括刚合并的）
  const allLocalTasks = getAllCompletedTasks();
  const tasksData = { completedTasks: allLocalTasks };
  const encrypted = await encrypt(tasksData);
  await updateRemoteFile(SYNC_FILES.TASKS, encrypted);
}
```

**原因**:
- 单向合并会导致数据不一致：A 设备新增的数据不会同步到 B 设备的远程
- 基于 ID 去重避免重复数据
- 使用 `updatedAt` 时间戳判断保留更新的版本，避免覆盖新数据
- 合并后自动上传确保本地独有的数据也能同步到远程
- 这是实现"最终一致性"的关键步骤

---

## 数据安全规范

### 破坏性操作前必须进行安全检查

**场景**: 执行删除、覆盖、清空等可能导致数据丢失的操作时

❌ **错误示例**:
```typescript
// 错误：直接执行删除，没有安全检查
async applyRemoteDeletions(toDeleteLocally: string[]) {
  for (const boardId of toDeleteLocally) {
    await workspaceStorageService.deleteBoard(boardId);  // 直接删除
  }
}
```

✅ **正确示例**:
```typescript
// 正确：执行安全检查后再删除
async applyRemoteDeletions(toDeleteLocally: string[]) {
  // 1. 执行安全检查
  const safetyCheck = performSafetyCheck({
    localBoards,
    toDeleteLocally,
    currentBoardId,    // 当前正在编辑的画板
    isFirstSync,       // 是否首次同步
    remoteManifest,
  });
  
  // 2. 处理安全检查结果
  if (safetyCheck.blockedReason) {
    throw new Error(safetyCheck.blockedReason);  // 严重错误，阻止执行
  }
  
  if (safetyCheck.warnings.length > 0) {
    // 有警告，需要用户确认
    return { needsConfirmation: true, warnings: safetyCheck.warnings };
  }
  
  // 3. 排除被保护的项目后执行删除
  const skippedIds = new Set(safetyCheck.skippedItems.map(item => item.id));
  const safeToDelete = toDeleteLocally.filter(id => !skippedIds.has(id));
  
  for (const boardId of safeToDelete) {
    await workspaceStorageService.deleteBoard(boardId);
  }
}
```

**安全检查规则**:

| 检查项 | 规则 | 处理方式 |
|-------|------|---------|
| 当前画板保护 | 正在编辑的画板不能被删除 | 跳过该项，继续其他操作 |
| 新设备保护 | 首次同步不执行任何删除 | 跳过所有删除操作 |
| 批量删除阈值 | 删除超过 50% 数据时警告 | 暂停，要求用户确认 |
| 全部删除阻止 | 不允许删除所有数据 | 阻止执行，显示错误 |
| 空数据保护 | 远程数据异常时不执行删除 | 跳过所有删除操作 |

**原因**:
- 用户数据是核心资产，误删除可能导致不可恢复的损失
- 同步冲突可能导致意外的批量删除
- 安全检查提供多层保护，宁可同步失败也不能误删数据

### 不可逆操作需要用户输入确认文字

**场景**: 执行清空回收站、永久删除等不可恢复的操作时

❌ **错误示例**:
```tsx
// 错误：只用简单的确认对话框
<Button onClick={() => {
  if (confirm('确定要清空回收站吗？')) {
    emptyRecycleBin();
  }
}}>
  清空回收站
</Button>
```

✅ **正确示例**:
```tsx
// 正确：要求输入确认文字
function EmptyRecycleBinDialog({ onConfirm, onCancel }) {
  const [confirmText, setConfirmText] = useState('');
  const isValid = confirmText === '确认清空';
  
  return (
    <Dialog header="清空回收站">
      <p>此操作将永久删除回收站中的所有数据，无法恢复。</p>
      <ul>
        <li>{itemCount.boards} 个画板</li>
        <li>{itemCount.prompts} 条提示词</li>
      </ul>
      <p>请输入 <strong>确认清空</strong> 以继续：</p>
      <Input
        value={confirmText}
        onChange={setConfirmText}
        placeholder='输入"确认清空"'
      />
      <Button 
        theme="danger" 
        disabled={!isValid}  // 必须输入正确文字才能点击
        onClick={onConfirm}
      >
        永久删除
      </Button>
    </Dialog>
  );
}
```

**原因**:
- 简单的确认对话框容易被用户习惯性点击"确定"
- 输入确认文字强制用户阅读警告内容
- 对于不可恢复的数据操作，额外的确认步骤可以有效防止误操作

### 使用软删除（Tombstone）支持数据恢复

**场景**: 实现跨设备同步的删除功能时

❌ **错误示例**:
```typescript
// 错误：直接删除远程文件
async deleteBoard(boardId: string) {
  await gitHubApiService.deleteGistFiles([`board_${boardId}.json`]);  // 直接删除
  delete manifest.boards[boardId];  // 从 manifest 中移除
}
```

✅ **正确示例**:
```typescript
// 正确：使用 tombstone 标记，保留文件便于恢复
async deleteBoard(boardId: string) {
  // 1. 添加删除标记，但不删除文件
  manifest.boards[boardId] = {
    ...manifest.boards[boardId],
    deletedAt: Date.now(),      // 删除时间戳
    deletedBy: deviceId,        // 删除设备
  };
  
  // 2. 更新 manifest
  await updateManifest(manifest);
  
  // 3. 删除本地数据
  await workspaceStorageService.deleteBoard(boardId);
}

// 恢复时：移除 tombstone 标记，下载远程文件
async restoreBoard(boardId: string) {
  const { deletedAt, deletedBy, ...rest } = manifest.boards[boardId];
  manifest.boards[boardId] = rest;  // 移除删除标记
  
  const boardData = await downloadBoard(boardId);  // 远程文件仍在
  await workspaceStorageService.saveBoard(boardData);
}
```

**优势**:
- 删除可恢复：用户可以从回收站恢复误删的数据
- 跨设备同步：其他设备同步时能正确识别已删除的项目
- 永久删除可控：用户手动清空回收站时才真正删除远程文件

### 异步操作不应阻塞 UI 交互

**场景**: 删除、保存等操作需要同步到远程服务器时

❌ **错误示例**:
```typescript
// 错误：同步操作阻塞了 UI，弹窗要等网络请求完成才关闭
async deleteBoard(id: string): Promise<void> {
  // 用户点击确认后，弹窗卡住等待网络请求
  const result = await syncEngine.syncBoardDeletion(id);  // 阻塞 2-3 秒
  if (result.success) {
    console.log('Synced to remote');
  }
  
  // 本地删除
  this.boards.delete(id);
  await storage.deleteBoard(id);
}
```

✅ **正确示例**:
```typescript
// 正确：异步执行同步，不阻塞本地操作
async deleteBoard(id: string): Promise<void> {
  // 异步同步到远程（fire-and-forget）
  import('./github-sync').then(({ syncEngine }) => {
    syncEngine.syncBoardDeletion(id).then((result) => {
      if (result.success) {
        console.log('Board synced to remote recycle bin');
      } else {
        console.warn('Failed to sync deletion:', result.error);
      }
    }).catch(console.warn);
  }).catch(console.warn);

  // 本地删除立即执行，弹窗立即关闭
  this.boards.delete(id);
  await storage.deleteBoard(id);
}
```

**原因**:
- 用户期望点击"确认"后弹窗立即关闭
- 网络请求可能慢或失败，不应影响本地操作体验
- 远程同步失败时可以在下次同步时重试

### 关键操作应直接调用，不依赖事件订阅

**场景**: 需要在某个操作后触发另一个操作（如删除后同步到远程）

❌ **错误示例**:
```typescript
// 错误：依赖事件订阅来触发同步
// 问题：事件订阅可能有时序问题，订阅在事件触发后才建立

// 在 Context 中订阅事件
useEffect(() => {
  const subscription = workspaceService.observeEvents().subscribe({
    next: (event) => {
      if (event.type === 'boardDeleted') {
        // 可能收不到事件！因为订阅建立时机不确定
        syncEngine.syncBoardDeletion(event.payload.id);
      }
    }
  });
  return () => subscription.unsubscribe();
}, []);

// 在 Service 中发出事件
async deleteBoard(id: string) {
  this.boards.delete(id);
  this.emit('boardDeleted', { id });  // 事件可能没有订阅者
}
```

✅ **正确示例**:
```typescript
// 正确：在操作中直接调用，保证执行
async deleteBoard(id: string) {
  // 直接调用同步逻辑
  import('./github-sync').then(({ syncEngine }) => {
    syncEngine.syncBoardDeletion(id).catch(console.warn);
  });
  
  // 执行本地删除
  this.boards.delete(id);
  
  // 事件仅用于 UI 更新等非关键操作
  this.emit('boardDeleted', { id });
}
```

**原因**:
- RxJS Subject 的事件是同步分发的，但订阅者的建立是异步的
- React useEffect 中的订阅可能在组件渲染后才建立
- 热更新（HMR）可能导致旧的订阅被替换
- 关键业务逻辑不应依赖于"某处可能存在的订阅者"

### 自定义菜单/按钮组件的焦点样式和键盘导航

**场景**: 实现自定义菜单、下拉列表等交互组件时

❌ **错误示例**:
```scss
// 错误：没有处理焦点样式，浏览器会显示默认的蓝色边框
.menu-item {
  background-color: transparent;
  border: 1px solid transparent;
  // 缺少 outline 处理
}
```

```tsx
// 错误：菜单没有键盘导航支持
const Menu = ({ children }) => {
  return (
    <div className="menu">
      {children}
    </div>
  );
};
```

✅ **正确示例**:
```scss
// 正确：移除默认焦点边框，用 focus-visible 提供键盘导航反馈
.menu-item {
  background-color: transparent;
  border: 1px solid transparent;
  outline: none;  // 移除浏览器默认蓝色焦点边框

  &:hover {
    background-color: var(--color-surface-primary-container);
  }

  &:focus-visible {
    // 仅键盘导航时显示视觉反馈（鼠标点击不会触发）
    background-color: var(--color-surface-primary-container);
  }
}
```

```tsx
// 正确：完整的键盘导航和无障碍支持
const Menu = ({ children, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const getFocusableItems = useCallback(() => {
    return Array.from(
      containerRef.current?.querySelectorAll<HTMLButtonElement>(
        'button.menu-item:not([disabled])'
      ) || []
    );
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const items = getFocusableItems();
    const currentIndex = items.findIndex(item => item === document.activeElement);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        items[(currentIndex + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
        break;
      case 'Escape':
        event.preventDefault();
        onClose?.();
        break;
    }
  }, [getFocusableItems, onClose]);

  // 菜单打开时自动聚焦第一项
  useEffect(() => {
    requestAnimationFrame(() => {
      getFocusableItems()[0]?.focus();
    });
  }, []);

  return (
    <div ref={containerRef} role="menu" onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
};

// MenuItem 添加 role="menuitem"
const MenuItem = ({ onClick, children }) => (
  <button className="menu-item" onClick={onClick} role="menuitem">
    {children}
  </button>
);
```

**关键点**:
- `outline: none` 移除浏览器默认蓝色焦点边框
- `focus-visible` 仅在键盘导航时提供视觉反馈，鼠标点击不会触发
- 支持 ↑↓ 箭头键循环切换焦点
- 支持 Escape 关闭菜单
- 菜单打开时自动聚焦第一项
- 添加 `role="menu"` 和 `role="menuitem"` 支持无障碍


### Frame 拖动元素检测时机

**场景**: Frame 移动时会"吸附"路过的元素，导致不相关元素被一起移动

❌ **错误示例**:
```typescript
// 每次移动都重新检测相交元素
board.afterChange = () => {
  if (movingFrameId) {
    const frameRectBefore = RectangleClient.getRectangleByPoints(lastFramePoints);
    const intersectingElements = board.children.filter((el) => {
      return isElementIntersectingRect(el, frameRectBefore);
    });
    // 移动所有相交的元素
    // 问题：Frame 移动过程中会不断"吸附"路过的元素
  }
};
```

✅ **正确示例**:
```typescript
// 只在拖动开始时检测一次
let movingElementIds: Set<string> = new Set();

board.pointerDown = (event: PointerEvent) => {
  const selected = getSelectedElements(board);
  if (selected.length === 1 && isFrameElement(selected[0])) {
    movingFrameId = selected[0].id;
    lastFramePoints = [...(selected[0] as PlaitFrame).points];
    
    // 记录拖动开始时与 Frame 相交的元素 ID
    movingElementIds.clear();
    const frameRect = RectangleClient.getRectangleByPoints(lastFramePoints);
    board.children.forEach((el) => {
      if (el.id === movingFrameId) return;
      if (isFrameElement(el)) return;
      if (isElementIntersectingRect(el, frameRect)) {
        movingElementIds.add(el.id);
      }
    });
  }
};

board.afterChange = () => {
  if (movingFrameId) {
    // 只移动预先记录的元素
    const elementsToMove = board.children.filter((el) => {
      return movingElementIds.has(el.id);
    });
    // 移动这些元素...
  }
};

board.globalPointerUp = (event: PointerEvent) => {
  if (movingFrameId) {
    movingFrameId = null;
    lastFramePoints = null;
    movingElementIds.clear(); // 清理记录
  }
};
```

**原因**: 
- 如果每次移动都重新检测相交元素，Frame 移动路径上的所有元素都会被"吸附"进来
- 正确的做法是只在拖动开始时检测一次，记录初始相交的元素 ID
- 移动过程中只移动这些预先记录的元素，不再重新检测
- 拖动结束时清理记录，为下次拖动做准备

**适用场景**:
- Frame 拖动同步移动内部元素
- 任何需要"容器+内容"联动移动的场景
- 避免移动过程中的意外元素吸附


### Plait Selection 类型结构

**场景**: 使用 Plait 的 Selection 类型进行框选检测时

❌ **错误示例**:
```typescript
// 错误：Selection 没有 ranges 属性
board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
  const rect = RectangleClient.getRectangleByPoints(element.points);
  const selectionRect = RectangleClient.getRectangleByPoints(selection.ranges[0]);
  // 类型错误：类型"Selection"上不存在属性"ranges"
  return isRectIntersect(rect, selectionRect);
};
```

✅ **正确示例**:
```typescript
// 正确：使用 anchor 和 focus 属性
board.isRectangleHit = (element: PlaitElement, selection: Selection) => {
  const rect = RectangleClient.getRectangleByPoints(element.points);
  const selectionRect = RectangleClient.getRectangleByPoints([
    selection.anchor,
    selection.focus
  ]);
  return isRectIntersect(rect, selectionRect);
};
```

**原因**: 
- Plait 的 Selection 类型使用 `anchor` 和 `focus` 两个点来表示选区
- `anchor` 是选区的起点，`focus` 是选区的终点
- 不存在 `ranges` 属性，使用会导致类型错误

**相关类型**:
- `Selection.anchor: Point` - 选区起点
- `Selection.focus: Point` - 选区终点
- 用于框选、文本选择等场景


### Plait 事件处理器类型匹配

**场景**: 重写 Plait board 的事件处理器时

❌ **错误示例**:
```typescript
// 错误：dblClick 期望 MouseEvent，但提供了 PointerEvent
board.dblClick = (event: PointerEvent) => {
  const point = toViewBoxPoint(board, toHostPoint(board, event.x, event.y));
  // 类型错误：不能将类型"(event: PointerEvent) => void"分配给类型"(event: MouseEvent) => void"
};
```

✅ **正确示例**:
```typescript
// 正确：使用 MouseEvent 类型
board.dblClick = (event: MouseEvent) => {
  const point = toViewBoxPoint(board, toHostPoint(board, event.x, event.y));
  // 类型匹配，编译通过
};
```

**原因**: 
- Plait 的不同事件处理器期望不同的事件类型
- `dblClick` 期望 `MouseEvent`，而 `pointerDown/pointerMove/pointerUp` 期望 `PointerEvent`
- 必须使用正确的事件类型，否则会导致类型错误

**常见事件类型**:
- `board.dblClick: (event: MouseEvent) => void`
- `board.pointerDown: (event: PointerEvent) => void`
- `board.pointerMove: (event: PointerEvent) => void`
- `board.pointerUp: (event: PointerEvent) => void`
