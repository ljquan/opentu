# Opentu 项目概念文档

> 本文档定义了 Opentu 项目的核心概念和术语，确保团队成员在开发过程中保持一致的理解。

## 一、项目定位

**Opentu（开图）** 是一个以画布为核心工作区底座的开源 **AI应用平台**。

Opentu 的平台结构分为四层：

- **工作区层**：画布、视口、元素、项目组织
- **应用层**：图片、视频、灵感板、思维导图、流程图、知识库、工具箱、Agent/Skill
- **运行层**：模型路由、任务队列、工作流执行、缓存与同步
- **开放层**：插件化、开源、可部署、可扩展

画布仍然是产品骨架，但在品牌与概念体系里，它承担的是 `工作区底座`，而不是旧意义上的全部产品定义。

- **官网**: https://opentu.ai
- **版本**: 0.6.x
- **许可证**: MIT
- **定位短句**: 在同一工作区中连接模型、工具、知识与工作流
- **技术栈**: React + TypeScript + Plait + Vite + Nx (Monorepo)

---

## 二、核心概念术语表

### 2.1 工作区层概念

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **画板 (Board)** | Board | 工作区中的单个画布页面，包含元素集合、视口状态和主题配置 | `workspace.types.ts` |
| **元素 (Element)** | PlaitElement | 画板上的基本单位，如图片、图形、文字、视频等 | `@plait/core` |
| **视口 (Viewport)** | Viewport | 画布的可视区域状态，包含缩放比例和偏移位置 | `@plait/core` |
| **文件夹 (Folder)** | Folder | 组织画板的容器，支持嵌套结构 | `workspace.types.ts` |
| **工作区 (Workspace)** | Workspace | 管理所有文件夹、画板与平台 UI 状态的顶层容器 | `workspace.types.ts` |
| **画布工作区** | Canvas Workspace | 面向用户的统一操作界面，承载 AI 应用与内容组织 | `drawnix.tsx` |

**层级关系**:
```
Workspace (工作区)
├── Folder (文件夹)
│   ├── Board (画板)
│   │   ├── PlaitElement (元素)
│   │   └── Viewport (视口)
│   └── Folder (嵌套文件夹)
└── Board (根级画板)
```

### 2.2 AI 生成概念

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **任务 (Task)** | Task | AI 生成的基本执行单位，有状态生命周期 | `task.types.ts` |
| **任务类型 (TaskType)** | TaskType | 任务分类：IMAGE / VIDEO / CHARACTER / CHAT / INSPIRATION_BOARD | `task.types.ts` |
| **任务状态 (TaskStatus)** | TaskStatus | 任务生命周期状态 | `task.types.ts` |
| **任务队列 (TaskQueue)** | TaskQueue | 管理所有任务的队列系统，运行在 Service Worker 中 | `sw/task-queue/` |
| **远程 ID (RemoteId)** | remoteId | 服务端返回的任务标识，用于轮询和恢复 | `task.types.ts` |
| **执行阶段 (ExecutionPhase)** | TaskExecutionPhase | 任务执行的细分阶段：SUBMITTING / POLLING / DOWNLOADING | `task.types.ts` |

**任务状态流转**:
```
PENDING (待执行)
    ↓
PROCESSING (执行中)
    ↓
COMPLETED (完成) / FAILED (失败) / CANCELLED (取消)
```

**任务类型说明**:
- `IMAGE`: 图片生成任务
- `VIDEO`: 视频生成任务
- `CHARACTER`: 角色提取任务 (Sora-2 专属)
- `CHAT`: 聊天/AI 分析任务
- `INSPIRATION_BOARD`: 灵感板生成任务 (图片生成 + 分割 + 布局)

### 2.3 工作流概念

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **工作流 (Workflow)** | Workflow | 包含多个步骤的任务执行计划 | `workflow-types.ts` |
| **工作流步骤 (WorkflowStep)** | WorkflowStep | 工作流中的单个 MCP 工具调用 | `workflow-types.ts` |
| **WorkZone** | WorkZone | 画布上显示工作流进度的特殊元素 | `workzone.types.ts` |
| **MCP 工具** | MCPTool | Model Context Protocol 工具，执行具体的 AI 操作 | `mcp/types.ts` |
| **工作流上下文** | WorkflowContext | 工作流的执行环境信息 | `workflow-types.ts` |

**工作流执行流程**:
```
WorkflowDefinition (定义)
    ↓ submit
Workflow (运行时)
    ↓ execute
WorkflowStep[] (步骤列表)
    ↓ for each
MCPTool.execute() (工具执行)
    ↓ result
Task (可能创建任务)
```

**步骤状态**:
- `pending`: 待执行
- `running`: 执行中
- `completed`: 已完成
- `failed`: 执行失败
- `skipped`: 跳过执行

### 2.4 素材库概念

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **素材 (Asset)** | Asset | 媒体库中的图片或视频资源 | `asset.types.ts` |
| **素材类型 (AssetType)** | AssetType | 素材分类：IMAGE / VIDEO | `asset.types.ts` |
| **素材来源 (AssetSource)** | AssetSource | 素材来源：LOCAL / AI_GENERATED | `asset.types.ts` |
| **统一缓存 (UnifiedCache)** | UnifiedCache | 协调 Cache Storage 和 IndexedDB 的缓存服务 | `unified-cache-service.ts` |
| **存储素材 (StoredAsset)** | StoredAsset | IndexedDB 中存储的素材元数据 | `asset.types.ts` |

**素材来源说明**:
- `LOCAL`: 用户从本地上传的素材
- `AI_GENERATED`: 通过 AI 生成的素材

**数据来源优先级**:
1. 本地上传素材 ← IndexedDB 元数据 + Cache Storage 实际数据
2. AI 生成素材 ← 任务队列已完成任务
3. Cache Storage 媒体 ← 虚拟路径缓存

### 2.5 聊天与对话概念

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **对话会话 (Session)** | ChatSession | 一个独立的对话上下文 | `chat.types.ts` |
| **消息 (Message)** | ChatMessage | 对话中的单条消息 | `chat.types.ts` |
| **消息角色 (Role)** | MessageRole | 消息发送者：USER / ASSISTANT | `chat.types.ts` |
| **消息状态 (MessageStatus)** | MessageStatus | 消息发送状态 | `chat.types.ts` |
| **AI 输入上下文** | AIInputContext | 用户输入的完整解析结果 | `chat.types.ts` |
| **附件 (Attachment)** | Attachment | 消息中附带的文件 | `chat.types.ts` |

**消息状态**:
- `sending`: 发送中
- `streaming`: 流式接收中
- `success`: 发送成功
- `failed`: 发送失败

**AIInputContext 结构**:
```typescript
{
  rawInput: string;          // 原始输入（含模型/参数标记）
  userInstruction: string;   // 纯净用户指令
  model: { id, type, isExplicit };
  params: { count, size, duration };
  selection: { texts, images, videos, graphics };
  finalPrompt: string;       // 最终生成 prompt
}
```

### 2.6 模型概念

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **模型类型 (ModelType)** | ModelType | 模型分类：image / video / text | `model-config.ts` |
| **模型配置 (ModelConfig)** | ModelConfig | 模型的完整配置信息 | `model-config.ts` |
| **短代码 (ShortCode)** | shortCode | 模型快捷标识，如 `nbpv`、`veo3` | `model-config.ts` |
| **参数配置 (ParamConfig)** | ParamConfig | 模型参数的配置信息 | `model-config.ts` |

**模型分类**:
- `image`: 图片生成模型 (Gemini Imagen, GPT Image)
- `video`: 视频生成模型 (Veo3, Sora-2)
- `text`: 文本/Agent 模型 (DeepSeek, Claude, Gemini)

**常用短代码**:
| 短代码 | 模型 | 类型 |
|--------|------|------|
| `nbpv` | nano-banana-pro-vip | 图片 |
| `nb` | nano-banana | 图片 |
| `veo3` | Veo 3 | 视频 |
| `sora-2` | Sora 2 | 视频 |

### 2.7 角色概念 (Sora 专属)

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **角色 (Character)** | SoraCharacter | 从 Sora-2 视频中提取的可复用人物 | `character.types.ts` |
| **角色状态 (CharacterStatus)** | CharacterStatus | 角色创建生命周期状态 | `character.types.ts` |
| **时间戳范围** | characterTimestamps | 角色提取的视频时间范围 (格式: "start,end") | `character.types.ts` |

**角色使用方式**:
- 通过 `@username` 在提示词中引用角色
- 角色提取需要 1-3 秒的视频片段

### 2.8 工具箱概念

| 术语 | 英文 | 定义 | 关键文件 |
|------|------|------|----------|
| **工具定义 (ToolDefinition)** | ToolDefinition | 工具箱中工具的配置信息 | `toolbox.types.ts` |
| **工具元素 (PlaitTool)** | PlaitTool | 画布上的工具实例（iframe 容器）| `toolbox.types.ts` |
| **工具窗口 (ToolWindow)** | ToolWindowState | 浮窗形式打开的工具状态 | `toolbox.types.ts` |
| **工具分类 (ToolCategory)** | ToolCategory | 工具分类枚举 | `toolbox.types.ts` |

**工具分类**:
- `AI_TOOLS`: AI 工具（提示词、生成等）
- `CONTENT_TOOLS`: 内容工具（文案、素材等）
- `UTILITIES`: 实用工具（批处理、转换等）
- `CUSTOM`: 自定义工具

### 2.9 平台分层概念

| 术语 | 英文 | 定义 |
|------|------|------|
| **应用层** | Application Layer | 面向用户的能力模块，如图片、视频、知识库、工具箱、Agent |
| **运行层** | Runtime Layer | 支撑应用运行的任务队列、模型路由、缓存、工作流 |
| **开放层** | Extensibility Layer | 插件、部署、开源与扩展机制 |

---

## 三、架构分层概念

### 3.1 应用层 (apps/web)

| 模块 | 文件 | 职责 |
|------|------|------|
| 主入口 | `main.tsx` | 应用启动、Service Worker 注册 |
| App 组件 | `app.tsx` | 工作区管理、数据加载 |
| Service Worker | `sw/index.ts` | 后台任务执行、缓存管理 |
| 任务队列 | `sw/task-queue/` | 任务调度、执行器 |

### 3.2 核心库 (packages/drawnix)

| 模块 | 目录 | 职责 |
|------|------|------|
| 主组件 | `drawnix.tsx` | 编辑器主入口组件 |
| 插件 | `plugins/` | 功能扩展插件 (`withXxx` 模式) |
| 服务 | `services/` | 业务逻辑服务 |
| 钩子 | `hooks/` | React 状态管理 |
| MCP 工具 | `mcp/` | AI 工具系统 |
| 组件 | `components/` | UI 组件库 |
| 类型 | `types/` | TypeScript 类型定义 |
| 常量 | `constants/` | 配置常量 |
| 工具 | `utils/` | 工具函数 |

### 3.3 适配层

| 包 | 职责 |
|-----|------|
| `packages/react-board` | Plait Board 的 React 适配 |
| `packages/react-text` | Slate 文本编辑的 React 适配 |
| `packages/utils` | 共享工具函数 |

---

## 四、数据流概念

### 4.1 AI 生成数据流

```
用户输入 (AIInputBar)
    ↓ 解析
AIInputContext (输入上下文)
    ↓ convertToWorkflow
WorkflowDefinition (工作流定义)
    ↓ workflowSubmissionService.submit
postMessage → Service Worker
    ↓ WorkflowExecutor
执行 MCP 工具
    ↓ 创建 Task
SWTaskQueue (任务队列)
    ↓ 调用生成 API
结果返回
    ↓ broadcastToClients
应用层接收
    ↓
unifiedCacheService.cache() → 缓存
    ↓
insertToCanvas() → 插入画布
```

### 4.2 素材库数据流

```
素材展示
├── 本地上传素材 ← assetStorageService (IndexedDB 元数据)
│                   验证 Cache Storage 有实际数据
├── AI 生成素材 ← taskQueueService.getCompletedTasks()
└── 缓存媒体 ← unifiedCacheService (Cache Storage)

删除素材
├── 本地素材 → assetStorageService.removeAsset()
└── AI 素材 → taskQueueService.deleteTask()
```

### 4.3 虚拟路径规范

| 路径前缀 | 用途 | 示例 |
|----------|------|------|
| `/__aitu_cache__/image/` | AI 生成图片、合并图片、分割图片 | `/__aitu_cache__/image/task-123.png` |
| `/__aitu_cache__/video/` | AI 生成视频 | `/__aitu_cache__/video/task-456.mp4` |
| `/asset-library/` | 本地上传素材 | `/asset-library/asset-789.jpg` |

**重要规则**:
- 虚拟路径由 Service Worker 拦截并从 Cache Storage 返回
- 存储时使用相对路径作为缓存 key，确保一致性
- 查询时支持完整 URL 和相对路径的匹配

---

## 五、状态管理概念

### 5.1 React Context

| Context | 职责 | 提供者位置 |
|---------|------|------------|
| `DrawnixContext` | 编辑器全局状态（指针模式、弹窗状态等）| `drawnix.tsx` |
| `WorkflowContext` | 工作流执行状态 | `drawnix.tsx` |
| `AssetContext` | 素材库状态和操作 | `drawnix.tsx` |
| `ChatDrawerContext` | 聊天抽屉状态 | `drawnix.tsx` |
| `RecentColorsProvider` | 最近使用颜色 | `drawnix.tsx` |
| `I18nProvider` | 国际化 | `drawnix.tsx` |
| `ToolbarConfigProvider` | 工具栏配置 | `drawnix.tsx` |

### 5.2 持久化存储

| 存储方式 | 用途 | API |
|----------|------|-----|
| LocalForage (IndexedDB) | 画板数据、会话消息、素材元数据、任务数据 | `localforage` |
| Cache Storage | 媒体文件实际内容 | `caches.open()` |
| localStorage | 设置配置、UI 状态 | `localStorage` |

**存储 Key 规范**:
- 画板: `boards-{id}`
- 文件夹: `folders-{id}`
- 会话: `chat-sessions-{id}`
- 消息: `chat-messages-{sessionId}`
- 素材元数据: `assets-{id}`

---

## 六、UI 层级概念 (Z-Index)

| 层级 | 范围 | 用途 | 示例 |
|------|------|------|------|
| Layer 0 | 0-999 | 基础画布元素 | 画布内容 |
| Layer 1 | 1000-1999 | 画布装饰元素 | 选中框 |
| Layer 2 | 2000-2999 | 工具栏 | UnifiedToolbar |
| Layer 3 | 3000-3999 | Popover / Tooltip | 弹出菜单 |
| Layer 4 | 4000-4999 | 抽屉 / 面板 | TaskQueue, ChatDrawer |
| Layer 5 | 5000-5999 | 弹窗 / Dialog | AI 生成弹窗 |
| Layer 6 | 6000-6999 | 通知 | 任务警告 |
| Layer 7 | 7000-7999 | 认证弹窗 | 登录框 |
| Layer 8 | 8000-8999 | 图片查看器 | ImageViewer |
| Layer 9 | 9000+ | 系统级覆盖层 | 加载遮罩 |

**使用规范**:
- TypeScript: 从 `constants/z-index.ts` 导入 `Z_INDEX`
- SCSS: 从 `styles/z-index.scss` 导入 `$z-*` 变量

---

## 七、命名规范

### 7.1 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase.tsx | `ImageCropPopup.tsx` |
| Hooks | camelCase.ts (use 前缀) | `useImageCrop.ts` |
| 服务 | kebab-case-service.ts | `workspace-service.ts` |
| 工具函数 | kebab-case.ts | `image-utils.ts` |
| 类型定义 | kebab-case.types.ts | `task.types.ts` |
| 常量 | UPPER_SNAKE_CASE.ts | `TASK_CONSTANTS.ts` |
| 样式 | kebab-case.scss | `ai-input-bar.scss` |

### 7.2 变量命名

| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `AIInputBar` |
| 函数 | camelCase | `handleSubmit` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 类型/接口 | PascalCase | `TaskStatus` |
| 枚举值 | UPPER_SNAKE_CASE | `TaskType.IMAGE` |
| CSS 类名 | kebab-case (BEM) | `.ai-input-bar__container` |

### 7.3 事件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| CustomEvent | kebab-case | `ai-generation-complete` |
| 追踪事件 | snake_case | `toolbar_click_save` |
| 回调 Props | on + PascalCase | `onSubmit`, `onChange` |

---

## 八、关键概念辨析

### 8.1 Task vs Workflow

| 维度 | Task | Workflow |
|------|------|----------|
| 定义 | 单个 AI 生成任务 | 多步骤执行计划 |
| 粒度 | 原子操作 | 组合操作 |
| 状态 | 独立状态和结果 | 整体状态 + 步骤状态 |
| 创建方 | TaskQueue | WorkflowExecutor |
| 关系 | 一个 Workflow 可创建多个 Task | - |

### 8.2 Board vs Workspace

| 维度 | Board | Workspace |
|------|-------|-----------|
| 定义 | 单个画板 | 平台中的统一工作区容器 |
| 内容 | 元素、视口、主题 | 文件夹、画板、UI 状态 |
| 持久化 | 独立存储 | 状态存储 |
| 切换 | 可以切换当前画板 | 唯一实例 |

### 8.3 Asset vs Task Result

| 维度 | Asset | Task Result |
|------|-------|-------------|
| 定义 | 素材库中的资源 | 任务的输出结果 |
| 元数据 | 完整（名称、来源、类型等）| 基本（URL、格式、尺寸）|
| 来源 | 本地上传 / AI 生成 | 仅 AI 生成 |
| 转换 | Task Result 可转换为 Asset | - |

### 8.4 MCP Tool vs Built-in Tool

| 维度 | MCP Tool | Built-in Tool |
|------|----------|---------------|
| 定义 | AI 相关工具 | 工具箱中的外部工具 |
| 实现 | 函数执行 | iframe 嵌入 |
| 示例 | generate_image, ai_analyze | 香蕉提示词、素材网站 |
| 调用 | 通过工作流步骤 | 用户手动打开 |

### 8.5 Service Worker 通信

| 消息方向 | 类型前缀 | 示例 |
|----------|----------|------|
| 主线程 → SW | `TASK_*`, `WORKFLOW_*` | `TASK_SUBMIT`, `WORKFLOW_CANCEL` |
| SW → 主线程 | `TASK_*`, `WORKFLOW_*` | `TASK_COMPLETED`, `WORKFLOW_STEP_STATUS` |

---

## 九、插件系统概念

### 9.1 插件模式

Opentu 使用 `withXxx` 模式扩展 Plait Board 功能：

```typescript
// 插件链式组合
const plugins = [
  withGroup,
  withDraw,
  withMind,
  withFreehand,
  withVideo,
  withTool,
  withWorkZone,
  // ...
];
```

### 9.2 核心插件列表

| 插件 | 功能 |
|------|------|
| `withDraw` | 基础绘图能力 |
| `withMind` | 思维导图支持 |
| `withFreehand` | 自由绘画 |
| `withPen` | 钢笔工具 |
| `withVideo` | 视频元素支持 |
| `withTool` | 工具元素（iframe）|
| `withWorkZone` | WorkZone 元素 |
| `withHotkey` | 快捷键处理 |
| `withTextLink` | 文本链接 |
| `withTextPaste` | 文本粘贴 |
| `withImage` | 图片粘贴 |
| `withTracking` | 数据追踪 |

---

## 十、MCP 工具系统

### 10.1 工具注册

MCP 工具在 `mcp/registry.ts` 中注册：

```typescript
export const mcpTools: Map<string, MCPTool> = new Map([
  ['generate_image', imageGenerationTool],
  ['generate_video', videoGenerationTool],
  ['ai_analyze', aiAnalyzeTool],
  ['canvas_insert', canvasInsertTool],
  // ...
]);
```

### 10.2 工具接口

```typescript
interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (params, options?) => Promise<MCPResult>;
  supportedModes?: MCPExecuteMode[];
  promptGuidance?: ToolPromptGuidance;
}
```

### 10.3 执行模式

| 模式 | 说明 | 使用场景 |
|------|------|----------|
| `async` | 同步等待 API 返回 | 快速操作 |
| `queue` | 加入任务队列 | 长时间生成任务 |

---

## 十一、Service Worker 架构

### 11.1 核心职责

1. **任务队列管理**: 处理 AI 生成任务
2. **缓存管理**: 预缓存静态资源、缓存媒体文件
3. **工作流执行**: 执行多步骤工作流
4. **消息通信**: 与主线程双向通信

### 11.2 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 主入口 | `sw/index.ts` | SW 生命周期、fetch 拦截 |
| 任务队列 | `sw/task-queue/queue.ts` | 任务调度 |
| 任务存储 | `sw/task-queue/storage.ts` | IndexedDB 持久化 |
| 处理器 | `sw/task-queue/handlers/` | 具体任务执行 |
| 工作流执行器 | `sw/task-queue/workflow-executor.ts` | 工作流执行 |

### 11.3 消息协议

```typescript
// 主线程 → SW
type MainToSWMessage =
  | { type: 'TASK_QUEUE_INIT'; geminiConfig; videoConfig }
  | { type: 'TASK_SUBMIT'; taskId; taskType; params }
  | { type: 'WORKFLOW_SUBMIT'; workflow }
  // ...

// SW → 主线程
type SWToMainMessage =
  | { type: 'TASK_CREATED'; task }
  | { type: 'TASK_STATUS'; taskId; status; progress }
  | { type: 'WORKFLOW_STEP_STATUS'; workflowId; stepId; status }
  // ...
```

---

## 十二、附录

### 12.1 相关文档

- [CLAUDE.md](../CLAUDE.md) - 完整开发指南
- [Z_INDEX_GUIDE.md](./Z_INDEX_GUIDE.md) - Z-Index 层级规范
- [UNIFIED_CACHE_DESIGN.md](./UNIFIED_CACHE_DESIGN.md) - 统一缓存设计
- [VERSION_CONTROL.md](./VERSION_CONTROL.md) - 版本控制规范

### 12.2 类型定义文件索引

| 概念领域 | 文件路径 |
|----------|----------|
| 任务系统 | `packages/drawnix/src/types/task.types.ts` |
| 工作区 | `packages/drawnix/src/types/workspace.types.ts` |
| 素材库 | `packages/drawnix/src/types/asset.types.ts` |
| 聊天 | `packages/drawnix/src/types/chat.types.ts` |
| WorkZone | `packages/drawnix/src/types/workzone.types.ts` |
| 角色 | `packages/drawnix/src/types/character.types.ts` |
| 工具箱 | `packages/drawnix/src/types/toolbox.types.ts` |
| MCP | `packages/drawnix/src/mcp/types.ts` |
| 工作流 | `apps/web/src/sw/task-queue/workflow-types.ts` |
| 模型配置 | `packages/drawnix/src/constants/model-config.ts` |
