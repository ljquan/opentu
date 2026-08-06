# Opentu 核心功能流程

本文档详细说明项目的核心功能实现流程，包括 AI 生成、Service Worker 架构、工作流机制等。这是 `CLAUDE.md` 的详细补充，当需要理解具体功能实现时参考本文档。

> **注意**：本文档由 CLAUDE.md 拆分而来，包含详细的架构说明和实现细节。

---

## 目录

- [AI 生成流程](#ai-生成流程service-worker-模式)
- [Service Worker 任务队列架构](#service-worker-任务队列架构)
- [Service Worker 预缓存机制](#service-worker-预缓存机制)
- [工作流提交机制](#工作流提交机制)
- [WorkZone 画布元素](#workzone-画布元素)
- [灵感创意板块](#灵感创意板块)
- [历史提示词功能](#历史提示词功能)
- [图片合并与分割](#图片合并与分割)

---

## 核心功能流程

### AI 生成流程（Service Worker 模式）

项目使用 Service Worker 作为后台任务执行器，实现页面刷新不影响任务执行。

```
用户输入
  ↓
AIInputBar (输入组件)
  ↓
swTaskQueueService.createTask() (应用层)
  ↓ postMessage
Service Worker (后台)
  ├── SWTaskQueue.submitTask() (任务管理)
  ├── ImageHandler / VideoHandler (执行器)
  └── taskQueueStorage (IndexedDB 持久化)
  ↓ broadcastToClients
应用层接收状态更新
  ↓
Canvas 插入 / 媒体库缓存
```

**核心特性**：
- **页面刷新恢复**：任务状态持久化到 IndexedDB，刷新后自动恢复
- **多标签页同步**：通过 `broadcastToClients` 向所有标签页广播状态
- **视频任务恢复**：通过 `remoteId` 恢复轮询，继续等待视频生成完成

### Service Worker 任务队列架构

```
apps/web/src/sw/
├── index.ts                       # SW 主入口
└── task-queue/
    ├── queue.ts                   # 任务队列核心 (SWTaskQueue)
    ├── storage.ts                 # IndexedDB 存储 (TaskQueueStorage)
    ├── types.ts                   # 类型定义
    ├── handlers/                  # 任务处理器
    │   ├── image.ts               # 图片生成处理器
    │   ├── video.ts               # 视频生成处理器
    │   ├── character.ts           # 角色生成处理器
    │   └── chat.ts                # 聊天处理器
    ├── workflow-executor.ts       # 工作流执行器
    ├── workflow-types.ts          # 工作流类型
    ├── chat-workflow/             # 聊天工作流
    │   ├── executor.ts            # 聊天工作流执行器
    │   └── types.ts               # 聊天工作流类型
    ├── mcp/                       # MCP 工具系统
    │   ├── tools.ts               # 工具注册
    │   └── executor.ts            # 工具执行器
    └── utils/
        └── index.ts               # 工具函数导出
```

**应用层服务**：
```
packages/drawnix/src/services/
├── sw-client/
│   ├── client.ts                  # SW 通信客户端 (SWTaskQueueClient)
│   ├── types.ts                   # 消息类型定义
│   └── index.ts                   # 导出
├── sw-task-queue-service.ts       # SW 任务队列服务
├── sw-chat-service.ts             # SW 聊天服务
├── sw-chat-workflow-service.ts    # SW 聊天工作流服务
└── task-queue/
    └── index.ts                   # 任务队列入口（自动选择 SW/传统模式）
```

**通信协议**：
```typescript
// 应用层 → Service Worker
type MainToSWMessage =
  | { type: 'TASK_QUEUE_INIT'; geminiConfig; videoConfig }
  | { type: 'TASK_SUBMIT'; taskId; taskType; params }
  | { type: 'TASK_CANCEL'; taskId }
  | { type: 'TASK_RETRY'; taskId }
  | { type: 'TASK_GET_ALL' }
  | { type: 'CHAT_START'; chatId; params }
  | { type: 'WORKFLOW_SUBMIT'; workflow }
  // ...

// Service Worker → 应用层
type SWToMainMessage =
  | { type: 'TASK_CREATED'; task }
  | { type: 'TASK_STATUS'; taskId; status; progress }
  | { type: 'TASK_COMPLETED'; taskId; result }
  | { type: 'TASK_FAILED'; taskId; error; retryCount }
  | { type: 'WORKFLOW_STEP_STATUS'; workflowId; stepId; status }
  // ...
```

**IndexedDB 存储结构**：
- `tasks` - 任务数据（图片/视频/角色生成）
- `config` - API 配置（apiKey, baseUrl）
- `workflows` - 工作流数据
- `chat-workflows` - 聊天工作流数据
- `pending-tool-requests` - 待处理的主线程工具请求

**任务生命周期**：
```
PENDING → PROCESSING → COMPLETED
                    ↘ FAILED
                    ↘ CANCELLED
```

**使用示例**：
```typescript
import { taskQueueService } from '../services/task-queue';

// 创建任务
const task = taskQueueService.createTask(
  { prompt: '生成一张日落图片', size: '1:1' },
  TaskType.IMAGE
);

// 监听任务更新
taskQueueService.observeTaskUpdates().subscribe((event) => {
  if (event.type === 'taskUpdated' && event.task.status === TaskStatus.COMPLETED) {
    console.log('任务完成:', event.task.result?.url);
  }
});
```

### Service Worker 预缓存机制 (Precache Manifest)

项目使用 **Precache Manifest** 机制确保版本更新时用户能快速加载新版本：

**问题**：如果 SW 只预缓存少量基础文件（如 index.html），版本更新后用户首次访问需要从网络下载所有 JS/CSS，导致加载慢。

**解决方案**：

1. **构建时生成资源清单** (`vite.config.ts`)：
```typescript
// Vite 插件在构建完成后扫描 dist 目录
function precacheManifestPlugin(): Plugin {
  return {
    name: 'precache-manifest',
    closeBundle: {
      async handler() {
        // 扫描所有静态资源，生成 precache-manifest.json
        // 包含 URL 和文件哈希（用于增量更新）
        manifest.push({ url: '/assets/xxx.js', revision: 'a1b2c3d4' });
      }
    }
  };
}
```

2. **SW 安装时预缓存所有资源** (`sw/index.ts`)：
```typescript
sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const files = await loadPrecacheManifest(); // 读取 manifest
      await precacheStaticFiles(cache, files);    // 并发预缓存
    })()
  );
});
```

3. **增量更新**：通过 `x-sw-revision` 头比较文件哈希，跳过未变化的文件

**工作流程**：
```
版本更新发布 → 用户访问 → 新 SW 安装
                           ↓
                    读取 precache-manifest.json
                           ↓
                    并发预缓存所有资源（6个并发）
                           ↓
                    预缓存完成 → 通知用户更新
                           ↓
                    用户确认 → 激活新 SW → 缓存优先秒开
```

**相关文件**：
- `apps/web/vite.config.ts` - `precacheManifestPlugin()` 生成 manifest
- `apps/web/src/sw/index.ts` - `loadPrecacheManifest()` 和 `precacheStaticFiles()`
- `dist/apps/web/precache-manifest.json` - 构建产物

**预缓存不阻塞首次访问**：

这是一个常见误解 —— 很多开发者担心 `event.waitUntil()` 会阻塞页面加载。实际上：

1. **页面加载和 SW 安装是并行的**：用户访问时页面正常从网络加载，SW 在后台安装
2. **SW 在页面 load 后才注册**：`main.tsx` 中 `window.addEventListener('load', () => { navigator.serviceWorker.register(...) })`
3. **`event.waitUntil()` 只影响 SW 生命周期**：它让 SW 等待预缓存完成后才激活，不影响主线程

```
时间 →
[页面加载] ████████████ load 事件
                         ↓
[用户可用] ──────────────●──────────────── 用户已可使用
                         
[SW 注册]                ●────────
[SW 预缓存]                   ████████████████
[SW 激活]                                    ●────────
```

**结论**：首次访问正常加载，SW 在后台默默预缓存，下次访问秒开。

**Service Worker 自动激活策略**：

项目采用 **自动激活** 策略，确保用户总是使用最新版本：

```typescript
// sw/index.ts - install 事件
sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precacheStaticFiles(cache, files);
      // 预缓存完成后，直接激活新 SW
      sw.skipWaiting();
    })()
  );
});

// activate 事件
sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await sw.clients.claim(); // 接管所有页面
      // 通知客户端 SW 已更新
      const clients = await sw.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({ type: 'SW_ACTIVATED', version: APP_VERSION });
      });
    })()
  );
});
```

**页面刷新策略**（区分主应用和调试页面）：

| 页面类型 | SW 更新后行为 | 原因 |
|---------|-------------|------|
| 主应用 (React) | 显示更新提示，**不自动刷新** | 避免打断用户操作 |
| sw-debug.html | **自动刷新** | 调试页面需要最新版本 |

```typescript
// main.tsx - 主应用只在用户确认后才刷新
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!userConfirmedUpgrade) {
    return; // 用户没确认就不刷新
  }
  window.location.reload();
});

// sw-debug/app.js - 调试页面自动刷新
onControllerChange(() => {
  window.location.reload();
});
```

### 编辑器插件系统
```
Drawnix (主编辑器)
  ├── Plait Board (绘图核心)
  └── Plugins
      ├── withTool (工具系统)
      ├── withFreehand (自由画)
      ├── withMind (思维导图)
      ├── withDraw (基础绘图)
      ├── withHotkey (快捷键)
      ├── withTextLink (文本链接)
      ├── withTextPaste (文本粘贴)
      ├── withImage (图片粘贴)
      ├── withVideo (视频支持)
      ├── withWorkZone (工作流进度)
      └── ...
```

### 工作流提交机制

项目使用统一的工作流提交机制，避免重复创建工作流导致的问题。

**核心文件**：
- `hooks/useWorkflowSubmission.ts` - 工作流提交 Hook
- `components/ai-input-bar/workflow-converter.ts` - 工作流转换器
- `services/workflow-submission-service.ts` - 工作流提交服务

**工作流程**：
```
AIInputBar 创建工作流
  ↓
convertToWorkflow() - 创建 LegacyWorkflowDefinition（唯一 ID）
  ↓
submitWorkflowToSW(parsedParams, referenceImages, retryContext, existingWorkflow)
  ↓
useWorkflowSubmission.submitWorkflow() - 复用已有工作流，避免重复创建
  ↓
workflowSubmissionService.submit() - 提交到 SW
  ↓
SW WorkflowExecutor 执行
```

**关键设计**：
- `submitWorkflow` 接受可选的 `existingWorkflow` 参数
- 如果传入 `existingWorkflow`，直接使用而不重新创建
- 避免因重复调用 `convertToWorkflow` 导致不同 ID 的工作流

**API 签名**：
```typescript
submitWorkflow: (
  parsedInput: ParsedGenerationParams,
  referenceImages: string[],
  retryContext?: WorkflowRetryContext,
  existingWorkflow?: LegacyWorkflowDefinition
) => Promise<{ workflowId: string; usedSW: boolean }>
```

### WorkZone 画布元素

WorkZone 是一个特殊的画布元素，用于在画布上直接显示 AI 生成任务的工作流进度。

**核心文件**：
- `plugins/with-workzone.ts` - Plait 插件，注册 WorkZone 元素类型
- `components/workzone-element/WorkZoneContent.tsx` - React 渲染组件
- `types/workzone.types.ts` - 类型定义

**工作流程**：
```
AIInputBar 提交生成任务
  ↓
创建 WorkZone 元素到画布 (WorkZoneTransforms.insertWorkZone)
  ↓
WorkflowContext 更新工作流状态
  ↓
WorkZoneContent 组件响应更新，显示进度
  ↓
任务完成/失败后可删除 WorkZone
```

**关键 API**：
- `WorkZoneTransforms.insertWorkZone(board, options)` - 创建 WorkZone
- `WorkZoneTransforms.updateWorkflow(board, id, workflow)` - 更新工作流状态
- `WorkZoneTransforms.removeWorkZone(board, id)` - 删除 WorkZone

**AI 生成完成事件**：
当所有工作流步骤完成后，会触发 `ai-generation-complete` 事件：
```typescript
window.dispatchEvent(new CustomEvent('ai-generation-complete', {
  detail: { type: 'image' | 'mind' | 'flowchart', success: boolean, workzoneId: string }
}));
```
- 思维导图/流程图：在 `sw-capabilities/handler.ts` 中触发
- 图片生成：在 `useAutoInsertToCanvas.ts` 的 `updateWorkflowStepForTask` 中触发
- `AIInputBar` 监听此事件来重置 `isSubmitting` 状态

**技术要点**：
- 使用 SVG `foreignObject` 在画布中嵌入 React 组件
- 使用 XHTML 命名空间确保 DOM 元素正确渲染
- 需要在 `pointerdown` 阶段阻止事件冒泡，避免 Plait 拦截点击事件
- WorkZone 元素被选中时不触发 popup-toolbar（在 `popup-toolbar.tsx` 中过滤）
- AIInputBar 发送工作流时不自动展开 ChatDrawer（通过 `autoOpen: false` 参数控制）

**位置策略**（按优先级）：
1. **有选中元素** → 放在选中元素下方（左对齐）
2. **无选中元素** → 放在最底部元素下方（左对齐）
3. **画布为空** → 放在视口中心

**选中框缩放**：
- 选中框大小根据 `zoom` 属性自动调整，与缩放后的内容匹配
- 使用 `activeGenerator` 的 `getRectangle` 计算缩放后的矩形

**自动滚动**：
- 使用 `scrollToPointIfNeeded` 函数智能滚动
- WorkZone 不在视口内时自动滚动到中心位置
- WorkZone 已在视口内时不滚动（避免干扰用户）


### 灵感创意板块 (InspirationBoard)

当画板为空时，在 AI 输入框上方显示灵感创意板块，帮助用户快速开始创作。

**核心文件**：
- `components/inspiration-board/InspirationBoard.tsx` - 主组件
- `components/inspiration-board/InspirationCard.tsx` - 模版卡片组件
- `components/inspiration-board/constants.ts` - 模版数据配置

**功能特点**：
- 画板为空时自动显示，有内容时隐藏
- 3x2 网格布局展示创意模版
- 支持分页浏览更多模版
- 点击模版自动填充提示词到输入框
- 提供"提示词"快捷按钮，可打开香蕉提示词工具

**数据加载状态管理 (`isDataReady`)**：

为了避免在画布数据加载完成前误判画布为空（导致灵感板闪烁），项目使用 `isDataReady` 状态来标识数据是否已准备好。

**数据流**：
```
app.tsx (isDataReady state)
  ↓ setValue 完成后 setIsDataReady(true)
  ↓ prop
drawnix.tsx (isDataReady prop)
  ↓ prop
DrawnixContent (isDataReady prop)
  ↓ prop
AIInputBar (isDataReady prop)
  ↓ prop
SelectionWatcher (isDataReady prop)
  ↓
只有 isDataReady=true 时才检查画布是否为空
```

**关键逻辑**：
- `app.tsx`：初始 `isDataReady = false`，在 `setValue` 完成后（`finally` 块中）设置为 `true`
- `SelectionWatcher`：只有当 `isDataReady` 为 `true` 时才开始检查画布是否为空
- 避免在数据加载前误判画布为空，防止灵感板闪烁

### 历史提示词功能

支持记录和管理用户的历史提示词，方便快速复用。

**核心文件**：
- `services/prompt-storage-service.ts` - 存储服务（localStorage）
- `hooks/usePromptHistory.ts` - React Hook
- `components/ai-input-bar/PromptHistoryPopover.tsx` - UI 组件

**功能特点**：
- 自动保存用户发送的提示词（无数量限制，使用 IndexedDB 存储）
- 支持置顶/取消置顶常用提示词
- 鼠标悬浮三点图标显示历史列表
- 点击历史提示词回填到输入框
- 支持删除单条历史记录

**API 示例**：
```typescript
const { history, addHistory, removeHistory, togglePinHistory } = usePromptHistory();

// 添加历史
addHistory('生成一张日落风景图', hasSelection);

// 置顶/取消置顶
togglePinHistory(itemId);
```

### 文本粘贴功能

支持智能文本粘贴到画布，自动控制文本宽度避免过长。

**核心文件**：
- `plugins/with-text-paste.ts` - 文本粘贴插件
- `plugins/with-common.tsx` - 插件注册（文本粘贴 + 图片粘贴）

**功能特点**：
- 自动换行：超过 50 字符自动换行
- 智能断行：优先在空格处断行，保持单词完整
- 保留格式：保留原文本的换行符
- 不影响现有功能：图片粘贴和 Plait 元素复制粘贴正常工作

**配置参数**：
```typescript
const TEXT_CONFIG = {
  MAX_CHARS_PER_LINE: 50,    // 最大字符数/行
  DEFAULT_WIDTH: 400,         // 默认文本框宽度
  MAX_WIDTH: 600,             // 最大文本框宽度
  CHAR_WIDTH: 8,              // 估算字符宽度
};
```

**使用方法**：
1. 从任何地方复制文本
2. 在画布上按 `Ctrl+V` / `Cmd+V`
3. 文本自动插入并换行

**插件链顺序**：
```typescript
// 在 with-common.tsx 中
return withTextPastePlugin(withImagePlugin(newBoard));
```

详细文档：`/docs/TEXT_PASTE_FEATURE.md`

### 模型健康状态功能

在模型选择下拉菜单中显示实时健康状态，帮助用户了解模型的可用性。

**核心文件**：
- `services/model-health-service.ts` - 健康状态 API 服务
- `hooks/useModelHealth.ts` - React Hook（带缓存和自动刷新）
- `components/shared/ModelHealthBadge.tsx` - 健康状态徽章组件
- `components/shared/model-health-badge.scss` - 样式文件

**功能特点**：
- 仅当 `baseUrl` 为 `api.tu-zi.com` 时才启用
- 每 5 分钟自动刷新健康数据
- 全局缓存避免重复请求
- 彩色方块徽章显示状态，hover 显示状态文字
- API 请求失败时静默处理，不显示健康状态

**API 来源**：
- 端点：`https://apistatus.tu-zi.com/api/history/aggregated`
- 返回字段：`model_name`、`status_label`、`status_color`、`error_rate` 等

**使用示例**：
```typescript
import { useModelHealth } from '../../hooks/useModelHealth';
import { ModelHealthBadge } from '../shared/ModelHealthBadge';

// 在组件中使用 Hook
const { shouldShowHealth, getHealthStatus } = useModelHealth();

// 获取特定模型的健康状态
const status = getHealthStatus('gemini-2.0-flash-exp-image-generation');

// 使用徽章组件
<ModelHealthBadge modelId="gemini-2.0-flash-exp-image-generation" />
```

**显示规则**：
- `shouldShowHealth` 为 `true` 时（baseUrl 包含 `api.tu-zi.com`）才显示徽章
- 没有匹配模型的健康数据时不显示徽章
- 徽章颜色由 API 返回的 `statusColor` 决定（绿/黄/红等）

### 字体管理与缓存

支持 Google Fonts 的自动加载和缓存，通过 Service Worker 实现应用层无感知的字体缓存。

**核心文件**：
- `services/font-manager-service.ts` - 字体管理服务
- `apps/web/src/sw/index.ts` - Service Worker 字体缓存逻辑
- `constants/text-effects.ts` - 字体配置（系统字体 + Google Fonts）

**功能特点**：
- 自动提取画布中使用的字体
- 画布初始化时预加载已使用的字体
- Service Worker 自动缓存字体文件（基于 URL）
- 支持系统字体和 Google Fonts
- 字体预览图管理

**工作流程**：
```
画布加载
  ↓
提取使用的字体（从 text.children 中）
  ↓
fontManagerService.preloadBoardFonts()
  ↓
加载 Google Fonts（link 标签）
  ↓
Service Worker 拦截请求
  ├─ 检查 drawnix-fonts 缓存
  ├─ 缓存命中 → 直接返回
  └─ 缓存未命中 → 下载并缓存
  ↓
字体加载完成 → board.redraw()
```

**缓存策略**：
- 使用 Service Worker Cache API
- Cache-First 策略（优先使用缓存）
- 缓存 CSS 文件和字体文件（woff2）
- 应用层无感知，完全由 Service Worker 管理

**支持的字体**：
- 系统字体：苹方、微软雅黑、黑体、宋体、楷体等
- Google Fonts：Noto Sans SC、ZCOOL 系列、Ma Shan Zheng 等

### 参考图上传组件 (ReferenceImageUpload)

统一的参考图上传组件，用于 AI 图片生成和视频生成弹窗。

**核心文件**：
- `components/ttd-dialog/shared/ReferenceImageUpload.tsx` - 主组件
- `components/ttd-dialog/shared/ReferenceImageUpload.scss` - 样式文件

**功能特点**：
- 本地文件上传：点击"本地"按钮选择文件
- 素材库选择：点击"素材库"按钮从媒体库选择图片
- 拖拽上传：支持将图片拖拽到上传区域
- 粘贴板获取：支持 Ctrl+V / Cmd+V 粘贴图片
- 多种模式：
  - 单图模式 (`multiple=false`)
  - 多图网格模式 (`multiple=true`)
  - 插槽模式 (`slotLabels` 用于视频生成的首帧/尾帧)

**使用示例**：
```tsx
// AI 图片生成中的使用
<ReferenceImageUpload
  images={uploadedImages}
  onImagesChange={setUploadedImages}
  language={language}
  disabled={isGenerating}
  multiple={true}
  label="参考图片 (可选)"
/>

// AI 视频生成中的使用（首帧/尾帧模式）
<ReferenceImageUpload
  images={uploadedImages}
  onImagesChange={handleImagesChange}
  language={language}
  disabled={isGenerating}
  multiple={true}
  maxCount={2}
  slotLabels={['首帧', '尾帧']}
  label="首尾帧图片 (可选)"
/>
```

**类型定义**：
```typescript
interface ReferenceImage {
  url: string;    // Base64 或 URL
  name: string;   // 文件名
  file?: File;    // 原始文件对象
}

interface ReferenceImageUploadProps {
  images: ReferenceImage[];
  onImagesChange: (images: ReferenceImage[]) => void;
  language?: 'zh' | 'en';
  disabled?: boolean;
  multiple?: boolean;
  maxCount?: number;
  label?: string;
  slotLabels?: string[];  // 插槽标签（如 ['首帧', '尾帧']）
  onError?: (error: string | null) => void;
}
```

**样式特点**：
- 虚线边框的上传区域
- 垂直排列的"本地"和"素材库"按钮
- 拖拽时的视觉反馈
- 统一的按钮样式（图标 16px，字体 13px，字重 400）

### 备份恢复功能 (Backup & Restore)

支持将用户数据（提示词、项目、素材）导出为 ZIP 文件，并从 ZIP 文件恢复数据。

**核心文件**：
- `services/backup-restore/` - 备份恢复服务（支持自动分片）
- `components/backup-restore/backup-restore-dialog.tsx` - UI 对话框

**功能特点**：
- 导出提示词历史（图片/视频提示词）
- 导出项目数据（文件夹和画板）
- 导出素材库（本地上传 + AI 生成的缓存媒体）
- 增量导入（自动去重，不覆盖已有数据）
- 支持进度显示

**ZIP 文件结构**：
```
aitu_backup_xxx.zip
├── manifest.json              # 备份元信息
├── prompts.json               # 提示词数据
├── projects/                  # 项目文件
│   ├── 文件夹名/
│   │   └── 画板名.drawnix     # 画板数据
│   └── 画板名.drawnix         # 根目录画板
└── assets/                    # 素材文件
    ├── xxx.meta.json          # 素材元数据
    └── xxx.jpg/.mp4           # 媒体文件
```

**数据来源**：
```
导出素材：
├── 本地素材库 ← localforage (asset-storage-service)
└── AI 生成缓存 ← unified-cache-service (drawnix-unified-cache)

导入素材：
├── 本地素材 → localforage + unified-cache
└── AI 生成素材 (source: 'AI_GENERATED') → 仅 unified-cache
```

**关键 API**：
```typescript
// 导出
const blob = await backupRestoreService.exportToZip({
  includePrompts: true,
  includeProjects: true,
  includeAssets: true,
}, onProgress);
backupRestoreService.downloadZip(blob);

// 导入
const result = await backupRestoreService.importFromZip(file, onProgress);
// result: { success, prompts, projects, assets, errors }
```

**缓存刷新机制**：
导入数据后需要刷新内存缓存才能生效：
- `resetPromptStorageCache()` - 刷新提示词缓存
- `workspaceService.reload()` - 刷新工作区缓存

**技术要点**：
- 使用 JSZip 处理 ZIP 文件
- 媒体文件通过 `unifiedCacheService.getCachedBlob()` 获取
- 虚拟 URL（`/asset-library/`）从 Cache API 获取
- 导入时区分本地素材和 AI 生成素材，存储位置不同

### 分页加载与虚拟滚动

支持任务队列和素材库的分页加载与虚拟滚动，优化大数据量场景下的性能。

**核心文件**：
- `hooks/useInfinitePagination.ts` - 无限滚动分页 Hook
- `hooks/useVirtualList.ts` - 虚拟列表 Hook（封装 @tanstack/react-virtual）
- `hooks/useImageLazyLoad.ts` - 图片懒加载 Hook
- `components/lazy-image/LazyImage.tsx` - 懒加载图片组件
- `components/task-queue/VirtualTaskList.tsx` - 虚拟任务列表组件
- `components/media-library/VirtualAssetGrid.tsx` - 虚拟素材网格组件
- `apps/web/src/sw/task-queue/storage.ts` - IndexedDB 游标分页查询

**功能特点**：
- IndexedDB 游标分页：支持大数据量的高效分页查询
- 无限滚动：滚动到底部自动加载更多数据
- 虚拟滚动：只渲染可见区域的元素，大幅减少 DOM 节点
- 图片懒加载：基于 IntersectionObserver，进入视口才加载图片
- 实时更新：支持 `prependItems`、`updateItem`、`removeItem` 操作

**使用示例**：
```typescript
// 无限滚动分页
const {
  items,
  isLoading,
  isLoadingMore,
  hasMore,
  loadMore,
  reset,
} = useInfinitePagination({
  fetcher: async ({ offset, limit }) => {
    const result = await swTaskQueueClient.requestPaginatedTasks({
      offset,
      limit,
      status: filterStatus,
    });
    return {
      items: result.tasks,
      total: result.total,
      hasMore: result.hasMore,
    };
  },
  pageSize: 50,
  getItemKey: (task) => task.id,
  deps: [filterStatus],
});

// 虚拟列表
const { parentRef, virtualItems, totalSize, getItem } = useVirtualList({
  items: tasks,
  estimateSize: 200,
  overscan: 3,
});
```

**IndexedDB 分页查询**：
```typescript
// Service Worker 中的游标分页实现
async getPaginatedTasks(params: PaginationParams): Promise<PaginatedResult> {
  const { offset = 0, limit = 50, status } = params;
  const db = await this.getDB();
  const tx = db.transaction('tasks', 'readonly');
  const store = tx.objectStore('tasks');
  const index = store.index('by-createdAt');

  let cursor = await index.openCursor(null, 'prev');
  let skipped = 0;
  const items: Task[] = [];

  while (cursor && items.length < limit) {
    if (status && cursor.value.status !== status) {
      cursor = await cursor.continue();
      continue;
    }
    if (skipped < offset) {
      skipped++;
      cursor = await cursor.continue();
      continue;
    }
    items.push(cursor.value);
    cursor = await cursor.continue();
  }

  return { items, total, hasMore: offset + items.length < total };
}
```

**性能优化**：
- 默认每页 50 条数据
- 虚拟列表 overscan 设置为 3-5 个元素
- 图片懒加载 rootMargin 设置为 200px（提前加载）
- 使用 `getItemKey` 进行去重，避免重复数据

---

### Service Worker 版本升级流程

#### 升级时序

```
主线程 5 分钟定时 registration.update()
  → 浏览器检测到新 sw.js
  → 新 SW install（prewarming → 预缓存资源 → markNewVersionReady → upgradeState='ready'）
  → 新 SW 进入 waiting 状态
  → 主线程 statechange='installed' → requestSWVersionState
  → SW 响应 SW_VERSION_STATE（pendingVersion + upgradeState='ready'）
  → 主线程 dispatch 'sw-update-available'
  → VersionUpdatePrompt 显示升级提示
  → 用户点击"立即更新" → COMMIT_UPGRADE → skipWaiting → activate → claim → reload
```

#### 自然激活（所有旧 tab 关闭）

当所有旧 tab 关闭后，waiting SW 自动变为 active。activate 处理器必须无条件将 `committedVersion` 更新为 `APP_VERSION`，否则新 tab 会用旧版本号打开旧缓存、从网络获取新 `index.html`，导致新 hash 资源用旧版本号请求源站 → 404。

#### 踩坑记录

1. **waiting SW 的 postmessage-duplex 不可靠**：新 SW 处于 waiting 状态时，`channelManager.sendSWNewVersionReady()` 可能无法到达客户端（channel 未与 waiting worker 建立）。必须依赖原生 `postMessage` + `statechange` 事件作为可靠通知路径。

2. **statechange 通知需要重试**：`requestSWVersionState(newWorker)` 只发一次，如果 SW 仍在预缓存（`waitUntil` 未完成），响应可能丢失。需要 5 秒后重试 + `visibilitychange` 时重新检查。

3. **activate 必须无条件更新 committedVersion**：原设计只在首次安装和用户确认时更新，自然激活时遗漏。SW 一旦激活就是当前版本，`committedVersion` 必须与 `APP_VERSION` 一致。

#### 关键文件

| 文件 | 职责 |
|------|------|
| `apps/web/src/main.tsx` | SW 注册、版本状态监听、升级确认 |
| `apps/web/src/sw/index.ts` | install/activate 处理、版本状态管理、静态资源拦截 |
| `packages/drawnix/src/components/version-update/version-update-prompt.tsx` | 升级提示 UI |

---

