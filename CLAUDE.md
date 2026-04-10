# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库中工作时提供指导。

---

## 项目概述

**Opentu (开图)** 是一个基于 Plait 框架构建的开源白板应用。支持思维导图、流程图、自由绘画、图片插入，以及 AI 驱动的内容生成（支持 Gemini、Midjourney、Flux、Seedream、Kling 等多种图片/视频生成模型）。

| 属性 | 值 |
|------|-----|
| 名称 | Opentu (开图) - AI 图片与视频创作工具 |
| 版本 | 0.5.0 |
| 许可证 | MIT |
| 官网 | https://opentu.ai |

---

## 开发命令

```bash
# 开发
pnpm start              # 启动开发服务器 (localhost:7200)
pnpm run build          # 构建所有包
pnpm run build:web      # 仅构建 Web 应用

# 测试与检查
pnpm check              # 类型检查 + ESLint（推荐）
pnpm typecheck          # 仅类型检查
pnpm lint               # 仅 ESLint
pnpm test               # 运行所有测试

# 版本发布
pnpm run version:patch  # 升级补丁版本 (0.0.x)
pnpm run version:minor  # 升级次版本 (0.x.0)
pnpm run release        # 构建并打包发布
```

---

## 项目架构

```
aitu/
├── apps/
│   ├── web/                    # 主 Web 应用 (Vite + React)
│   └── web-e2e/                # E2E 测试 (Playwright)
├── packages/
│   ├── drawnix/                # 核心白板库 (362+ TS 文件)
│   │   ├── components/         # UI 组件 (43 个)
│   │   ├── services/           # 业务服务 (32 个)
│   │   ├── plugins/            # Plait 插件 (15 个)
│   │   ├── hooks/              # React Hooks (27 个)
│   │   └── utils/              # 工具函数 (33 个)
│   ├── react-board/            # Plait React 适配层
│   └── react-text/             # 文本编辑组件 (Slate.js)
├── docs/                       # 项目文档
├── openspec/                   # OpenSpec 规范
└── specs/                      # 功能规格说明
```

### 关键入口文件

| 文件 | 说明 |
|------|------|
| `apps/web/src/main.tsx` | 应用入口 |
| `packages/drawnix/src/drawnix.tsx` | 主编辑器组件 |
| `apps/web/src/sw/index.ts` | Service Worker |
| `packages/drawnix/src/services/generation-api-service.ts` | AI 生成服务 |
| `packages/drawnix/src/services/task-queue-service.ts` | 任务队列服务 |

### 重要 Context

- `DrawnixContext` - 编辑器状态（指针模式、对话框）
- `AssetContext` - 素材库管理
- `WorkflowContext` - AI 工作流状态
- `ChatDrawerContext` - 聊天抽屉状态

---

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 18.3, TypeScript 5.4, Vite 6.2 |
| 构建工具 | Nx 19.3, pnpm, SWC |
| UI 框架 | TDesign React, Tailwind CSS, Lucide React |
| 绘图框架 | Plait ^0.84, Slate.js, RoughJS, Mermaid |
| AI/API | Gemini API, Midjourney, Flux, Seedream, Kling, Veo3, Sora-2 |
| 状态管理 | React Context, RxJS, LocalForage |
| 测试 | Vitest, Playwright |

---

## 核心架构概念

### AI 生成流程

`AIInputBar → swTaskQueueService.createTask() → postMessage → Service Worker (ImageHandler/VideoHandler + IndexedDB) → broadcastToClients → Canvas 插入 / 媒体库缓存`

**核心特性**：页面刷新不影响任务执行，通过 `remoteId` 恢复视频轮询。

### 模型适配器架构

支持多种 AI 图片/视频生成模型，通过统一的适配器接口集成：

**已集成模型**：
- **图片生成**：Gemini (Imagen 3)、Midjourney、Flux、Seedream 5.0
- **视频生成**：Veo 3、Sora 2、Kling、Seedance

**适配器注册与路由**：定义适配器 → `registerModelAdapter()` 注册 → `resolveAdapterForModel()` 运行时路由。关键文件：`services/model-adapters/registry.ts`、`types.ts`、`default-adapters.ts`、`services/media-executor/fallback-adapter-routes.ts`

**多图与签名 URL**：适配器返回 `{ url, urls?, format }`，`urls` 展开为独立预览项；任务完成前自动 `cacheRemoteUrl()` 到 `/__aitu_cache__/`；所有媒体元素使用 `referrerPolicy="no-referrer"` 避免签名 URL 403

### 素材库数据来源

本地上传素材（IndexedDB 元数据 + Cache Storage 数据）、AI 生成素材（任务队列已完成任务）、Cache Storage 媒体（`/__aitu_cache__/` 前缀）。**设计原则**：Cache Storage 是唯一数据真相，IndexedDB 只存元数据。

### 插件系统

> 详细规则和示例请参考 `docs/CODING_RULES.md` → Plait 插件规范

采用 `withXxx` 组合式模式：`withTool`, `withFreehand`, `withImage`, `withVideo`, `withWorkzone` 等。

- **新画布功能必须作为 Plait 插件**，禁止独立 React 组件 + SVG overlay（坐标系不一致、事件冲突）
- **工具互斥通过 `board.pointer` 管理**，禁止独立布尔状态手动管理
- **Viewport 缩放+平移用 `updateViewport` 一步完成**，禁止 `updateZoom()` + `moveToCenter()` 分两步
- **全屏展示用「viewport 对准 + 隐藏 UI + 蒙层挖洞」**，禁止 `toImage` 截图方案
- **自定义组件 `onContextChanged` 必须处理 viewport 变化**，viewport 变化时选择框不会自动跟随
- **编程式选中元素用 `Transforms.addSelectionWithTemporaryElements`**，`cacheSelectedElements` 不触发渲染
- **Frame 拖动元素检测只在 `pointerDown` 时执行**，禁止每次移动重新检测

---

## 核心编码规则

> 详细规则和错误示例请参考 `docs/CODING_RULES.md`

### 断舍离原则（最高优先级）

> **极简主义是本项目的核心哲学。代码越少，Bug 越少，维护成本越低。**

1. **坚决删除冗余代码**：发现无用代码立即删除，不犹豫、不"留着以后可能用到"；架构演进后的遗留代码及时清理
2. **拒绝重复实现**：主线程已实现的功能，SW 不要再实现一遍；相似功能提取共享模块
3. **YAGNI 原则**：新增代码前问"这真的需要吗？"；能用 10 行解决的不写 100 行；不为假想的未来需求预留代码

### 必须遵守

1. **文件大小限制**：单个文件不超过 500 行
2. **类型定义**：对象用 `interface`，联合类型用 `type`，避免 `any`；枚举作为值使用时不能用 `import type`
3. **组件规范**：函数组件 + Hooks，事件处理器用 `useCallback`
4. **定时器清理**：`setInterval` 必须保存 ID，提供 `destroy()` 方法
5. **API 请求**：禁止重试，区分业务失败和网络错误
6. **调试日志**：提交前必须清理 `console.log`；同步模块（`github-sync/*`）使用 `logDebug/logInfo/logSuccess/logWarning/logError` 而非 `console.log`；**禁止空 catch 块**，至少记录 `console.debug`
7. **敏感信息**：永不硬编码 API Key，使用 `sanitizeObject` 过滤日志，敏感 ID 用 `maskId` 脱敏
8. **布局抖动**：`Suspense` 的 fallback 应撑满容器或固定高度，防止加载时跳动
9. **结构化数据**：复杂消息展示应优先使用 `aiContext` 等结构化数据而非字符串解析
10. **图标验证**：使用 `tdesign-icons-react` 前需验证导出名称是否存在（如 `ServiceIcon`）
11. **外部 API 调用频率**：低频刷新的外部接口必须使用单例控制调用频率
12. **共享模块设计**：相似功能提取到 `*-core.ts` 核心模块，通过配置类型区分行为
13. **同名模块隔离**：多个同名模块有独立全局状态，确保从正确的模块路径导入
14. **工作区初始化**：`getCurrentBoard()` 返回 `null` 但 `hasBoards()` 为 `true` 时，必须自动选择第一个画板，不能只在 "无画板" 时创建新画板
15. **工具函数组织**：通用工具函数放 `@aitu/utils`，使用时直接导入，禁止二次导出或不必要的包装
16. **数据安全保护**：破坏性操作（删除、覆盖）前必须安全检查，当前编辑项不可删除，批量删除需确认，不可逆操作需输入确认文字
17. **模块循环依赖**：将共享函数（如 `shouldUseSWTaskQueue`）提取到独立模块打破循环；单例构造函数用 `queueMicrotask` 延迟访问其他模块导出
18. **配置对象深拷贝**：`getSetting()` 等返回配置对象的方法需返回深拷贝，防止脱敏函数等外部操作修改全局状态
19. **避免过度设计**：优先使用简单的 interface + service 模式；只在有明确需求时才添加 Repository、Strategy 等抽象层
20. **重构先问问题**：重构前明确要解决的实际问题；验证方案是否真的解决问题而非增加复杂度
21. **统计上报旁路化**：统计/监控的初始化与上报须在 requestIdleCallback 或 setTimeout 中执行，不在主路径上做脱敏与网络请求；失败静默不向上抛
22. **第三方 Session Replay**：默认关闭或按采样开启，避免主线程卡顿（wheel/setInterval）与 413；若开启需配置限流与 413 错误处理
23. **组件库类型就窄不就宽**：给 UI 组件配置项（如 Dropdown options、Table columns、Form rules）写类型时，优先贴组件库声明的最窄类型；不要用 `ReactNode`、`unknown as Xxx` 这类宽泛写法糊过去，避免升级依赖后类型漂移
24. **公共接口改签名必须全量收口**：修改 service / hook / util 的函数签名或返回结构后，必须全局搜索所有调用点并一并修正；禁止只改定义或只改单个调用点，留下“对象改 number / 字段名漂移”这类半更新状态
25. **跨层参数禁止直接透传**：MCP、Service Worker、主线程执行器、UI 层的 `options` / `params` 若类型不一致，必须显式写 adapter / mapper 做转换；即使当前只映射 0-1 个字段，也不要把上一层对象直接传给下一层碰运气
26. **外部输入入口先校验再执行业务**：Tool/RPC/URL 参数/存储恢复数据进入业务前，先做 type guard 或 schema 校验；禁止用 `as SomeType` 直接断言后调用，避免把编译期问题拖成运行时异常

### Service Worker 规则

1. SW 和主线程模块不共享，各自维护独立副本
2. 虚拟路径（`/__aitu_cache__/`）由 SW 拦截返回 Cache Storage 数据
3. SW 内部获取缓存数据应直接读取 Cache API，不使用 fetch
4. 更新后禁止自动刷新页面，需用户确认
5. SW 枚举值使用小写（`'completed'`、`'image'`、`'video'`），读取 SW 数据时注意匹配
6. 无效配置下创建的任务不应在后续被执行，首次初始化时应清除"孤儿任务"
7. 跨层数据转换必须传递所有字段，特别是 `options`、`metadata` 等可选字段，遗漏会导致功能静默失败
8. **Cache.put() 会消费 Response body**：需要缓存到多个 key 时，为每个 key 创建独立的 Response 对象，不要复用后 clone
9. **fetchOptions 优先级**：优先尝试 `cors` 模式（可缓存），最后才尝试 `no-cors` 模式（无法缓存）
10. **postmessage-duplex 1.1.0 通信模式**：RPC 用 `call()` 方法（需响应），单向广播用 `broadcast()` + `onBroadcast()`（fire-and-forget）；SW 用 `enableGlobalRouting` 自动管理 channel
11. **postmessage-duplex 单页面单 channel**：同一页面只允许一个 `createFromPage()`（`swChannelClient`），其他模块（如 `FetchRelayClient`）必须复用 `swChannelClient.getChannel()`；多个 channel 会导致 SW `enableGlobalRouting` 按 `clientId` 路由冲突，RPC 响应丢失
12. **postmessage-duplex 消息大小限制**：单次 RPC 响应不超过 1MB，大数据查询需后端分页+精简数据（去掉 requestBody/responseBody 等大字段）
13. **主线程直接读取 IndexedDB**：只读数据直接用 `taskStorageReader.getAllTasks()` 读取，避免 postMessage 限制；写操作通过 SW 或 `taskStorageWriter` 保持一致性
14. **任务数据持久化**：主线程直接通过 `taskStorageWriter` 写入 IndexedDB，无需通过 RPC 通知 SW（断舍离：避免重复写入）
15. **降级模式任务执行**：`?sw=0` 降级模式下，`createTask` 后必须自动触发 `executeTask`，否则任务只会被创建但不会执行
16. **工作流恢复状态不一致**：UI 与 SW 状态不一致时（如终态但有运行中步骤），必须先从 SW 获取真实状态，不能直接标记为失败
17. **错误处理链保持完整**：需要传递特殊错误属性（如 `isAwaitingClient`）时，必须重新抛出原始错误，不能创建新 Error 对象
18. **SW 重发 Tool Request 需延迟**：页面刷新后 claim 工作流时，SW 重发 pending tool request 需延迟 500ms，等待主线程 handler 准备好
19. **同步数据双向合并**：下载远程数据时必须与本地合并（基于 ID 去重，`updatedAt` 判断版本），合并后自动上传确保双向同步
20. **同步数据格式一致性**：`tasks.json` 结构是 `{ completedTasks: Task[] }` 不是数组，画板文件是 `board_{id}.json` 不是 `.drawnix`
21. **RPC 超时与重连**：关键 RPC 调用（如工作流提交）需设置合理超时（15-30秒），超时时主动重新初始化 SW 连接并重试
22. **降级路径功能一致性**：降级到主线程直接调用 API 时，必须保持与 SW 模式相同的功能行为（如 LLM API 日志记录）；工作流工具集也需一致，WorkflowEngine.executeToolStep 中 SW 支持的工具在主线程分支也需有对应 case 路由到 executeMainThreadTool，否则会报 Unknown tool
23. **SW 初始化统一入口**：使用 `swChannelClient.ensureReady()` 作为统一入口，避免在各处重复初始化逻辑；任务队列用 `swTaskQueueService.initialize()`
24. **配置同步到 IndexedDB**：SW 无法访问 localStorage，`SettingsManager` 自动将配置同步到 IndexedDB（同一数据库 `sw-task-queue`），SW 直接从 IndexedDB 读取，避免依赖 postMessage
25. **远程同步任务不恢复执行**：通过 `syncedFromRemote` 标记区分本地和远程任务，SW 的 `shouldResumeTask()` 跳过远程任务，避免多设备重复调用大模型接口
26. **任务参考图传递**：创建图片/视频任务时 `createTask` 的 params 须包含 `referenceImages`（与 `uploadedImages` 一并）；执行时 `executor.generateImage/generateVideo` 须传入 `referenceImages`（或 video 的 `inputReference`），否则 sw=0 降级请求不会带参考图
27. **SW 可用性检测统一**：决定是否走 SW 时需用 `swChannelClient.isInitialized()` + `ping`，不能仅检查 `navigator.serviceWorker.controller`，否则 channel 未就绪会提交超时
28. **降级路径强制主线程执行器**：workflow 提交超时后降级时，MainThreadWorkflowEngine 须传 `forceFallbackExecutor: true`，否则 `executorFactory.getExecutor()` 可能仍返回 SW 执行器导致二次超时
29. **Fetch Relay 初始化超时保护**：`fetchRelayClient.initialize()` 在热路径（如 `generateImage`、`doInitialize`）中必须用 `Promise.race` 加 3s 超时，超时后降级到 `directFetch`
30. **模块迁移接口完整性**：将模块从 SW 迁移到主线程（或反向）时，新模块的 `interface` 定义必须与原模块逐字段对比，确保无遗漏；不仅调用时传参要完整，**类型定义本身**也要包含所有字段（如 `referenceImages`），否则即使调用方想传数据也无法传入
31. **模型参数偏好按作用域隔离**：图片/视频/音频的参数持久化必须优先使用 `selectionKey`、回退 `modelId`，避免不同供应商的同名模型串配置；表单回填优先级必须是“任务/显式初始化参数 > 模型偏好 > 模型默认值”

### React 规则

1. Context 回调中必须使用函数式更新 `setState(prev => ...)`
2. Hover 延迟操作需要正确的计时器清理
3. 弹出菜单/浮层需用 `createPortal` 渲染到 body，避免被父容器 overflow 截断
4. 模式切换时多个相关状态需同步更新，封装成一个函数而非直接暴露底层 setMode
5. 图标组件使用 `React.FC`，支持 `size` 属性
6. 传递组件作为 prop 时必须实例化：`icon={<Icon />}` 而非 `icon={Icon}`
7. 内联 style 的 `undefined` 值会覆盖 CSS 类，需要 CSS 类生效时传 `style={undefined}`
8. Flex 布局中使用 `flex: 1` 时，若兄弟元素可隐藏，内部组件需设 `max-width` 防止变形
9. `useCallback` 定义必须在引用它的 `useEffect` 之前，否则会报 TDZ 错误
10. Slate-React Leaf 组件 DOM 结构必须稳定，不能根据条件切换标签/CSS 实现方式
11. **异步操作不阻塞 UI**：远程同步等耗时操作应异步执行（fire-and-forget），不阻塞弹窗关闭
12. **关键操作直接调用**：不依赖 RxJS 事件订阅触发关键业务逻辑，订阅时序不可靠
13. **CPU 密集型循环需 yield**：大量 JSON.stringify/加密等操作的循环，每 3-5 次迭代调用 `await yieldToMain()` 让出主线程
14. **跨 React Root 状态共享**：Plait 文本组件通过 `createRoot` 渲染在独立 React 树中，Context 无法穿透；需用 `useSyncExternalStore` + 模块级 store 共享状态
15. **列表索引引用须用 ID 追踪**：当 Viewer/弹窗通过 `currentIndex` 引用列表项时，若列表可能动态变化（新项插入/删除），必须通过 item ID 在列表变化后修正索引，否则会显示错误的内容
16. **RxJS 事件/全局 Store 传递的对象必须是新引用**：原地修改对象再 emit 会导致 React.memo 失效，必须创建新对象后再存入 Map 并 emit
17. **useEffect 初始对账须用 ref 守卫**：遍历任务列表执行对账可能触发状态更新 → 依赖变化 → useEffect 重跑形成死循环，用 `useRef(false)` 确保只执行一次
18. **模型选择器跨类型切换禁止错型 pinned**：从图片/视频/音频/文本切换生成类型时，若当前供应商下存在同名但不同类型模型，`pinned model` 逻辑必须返回 `null` 并回退到目标类型的最近有效选择 / 默认模型 / 首个可用模型，不能把旧类型模型伪装成新类型继续显示
19. **可交互 hover 提示禁止使用原生 `title`**：凡是 tooltip 内需要复制、点击、悬停停留等交互，必须使用自定义浮层/portal Tooltip；原生 `title` 只能用于纯静态、不可交互的浏览器默认提示
20. **模型项次要操作优先放右键菜单**：模型选择器里像“复制模型名”这类低频操作，优先放统一右键菜单；菜单标题直接展示真实调用的 `model.id`，不要复用展示名，避免内置/非内置模型出现认知偏差

### 其他常见陷阱

> 详细示例请参考 `docs/CODING_RULES.md`

1. **API 错误字段类型安全**：`data.error` 可能是字符串或对象，必须用 `typeof` 区分后再传给 `new Error()`
2. **数值范围转换**：回调链传递进度值时，0-1 和 0-100 范围容易混淆，每层输入/输出值域必须注释标注

### 缓存规则

1. IndexedDB 元数据必须验证 Cache Storage 实际数据存在
2. 本地缓存图片只存 Cache Storage，不存 IndexedDB 元数据
3. Cache API 返回前必须验证响应有效性（`blob.size > 0`）
4. **Cache.put() 会消费 Response body**：需要缓存到多个 key 时，为每个 key 创建独立的 Response 对象

---

## 品牌设计

### 核心色彩

| 用途 | 颜色 |
|------|------|
| 主品牌色 | `#F39C12` (橙金) |
| 强调色 | `#5A4FCF` (蓝紫), `#E91E63` (玫红) |
| 品牌渐变 | `linear-gradient(135deg, #F39C12 0%, #E67E22 30%, #5A4FCF 70%, #E91E63 100%)` |

### UI 规范

- **Tooltips**：始终使用 `theme='light'`，高层级容器内需显式设置更高 `zIndex` (如 20000)
- **媒体预览**：统一使用 `UnifiedMediaViewer` 公共组件，禁止自定义 Dialog 实现
- **媒体封面兜底**：音频封面/缩略图/播放器封面统一走公共组件处理失败占位，禁止各处重复写 `onError + fallback`
- **生成结果缩略图**：使用 `object-fit: contain` 完整展示，禁止 cover 裁切
- **小图 hover 预览**：缩略图应提供 hover 大图预览功能（Portal 渲染到 body）
- **状态表意**：优先使用量化组件（如信号格）而非单一颜色圆点来展示程度差异
- **按钮圆角**：8px
- **卡片圆角**：12px
- **动画时长**：150-300ms，ease-out 曲线
- **可点击容器**：用 `pointer-events: none` + 父容器 `onClick` 扩大交互区域
- **筛选与选中联动**：选中计数、操作都应基于筛选后的结果
- **全局配色统一**：在 `tdesign-theme.scss` 中集中覆盖第三方组件样式
- **组件内颜色**：TDesign CSS 变量可能被覆盖，组件 scss 中应直接使用具体颜色值（如 `rgba(243, 156, 18, 0.12)`）

---

## 相关文档

### 核心文档（按需阅读）

| 文档 | 说明 | 何时阅读 |
|------|------|---------|
| `docs/CODING_RULES.md` | 详细编码规则和错误示例 | 编写代码时遇到特定场景 |
| `docs/FEATURE_FLOWS.md` | 核心功能实现流程 | 理解功能架构时 |
| `docs/CONCEPTS.md` | 项目核心术语定义 | 理解业务概念时 |
| `docs/CODING_STANDARDS.md` | 基础编码规范 | 代码风格参考 |

### 专题文档

`docs/Z_INDEX_GUIDE.md`（层级管理）、`docs/UNIFIED_CACHE_DESIGN.md`（缓存架构）、`docs/SW_DEBUG_POSTMESSAGE_LOGGING.md`（SW 调试）、`docs/CLAUDE_CODE_BEST_PRACTICES.md`（使用技巧）

### 规范文档

`openspec/AGENTS.md` - OpenSpec 规范（涉及架构变更时必读）

---

## OpenSpec 说明

当请求涉及计划/提案/破坏性变更/架构调整时，请先打开 `@/openspec/AGENTS.md`。

## 验证命令

```bash
pnpm check              # 类型检查 + ESLint（推荐）
pnpm test               # 单元测试
pnpm run build          # 构建验证
```
