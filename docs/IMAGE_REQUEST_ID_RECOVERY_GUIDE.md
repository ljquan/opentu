# 生图超时兜底：X-Request-Id 找回机制

> 版本：v1.0 · 日期：2026-07-09

## 一、背景

**问题场景**：使用 `api.tu-zi.com` 等 API 站生图时，偶发以下情况：

- 图片实际生成成功，账户已扣费
- 但客户端因请求超时/网络中断没拿到响应
- 用户端显示"生图失败"，等于白白花费了 API 调用

**API 站提供的能力**：
- **生图时**：在请求头带上自定义 `X-Request-Id`
- **超时后**：调用 `GET /log/get-request?id={requestId}` 可以找回真实的生成结果

**改造目标**：让客户端在同步生图接口超时时自动走 `/log/get-request` 兜底找回，把"失败"透明地转为"成功"。

## 二、总体设计

### 2.1 传输层按能力注入 X-Request-Id

- `ProviderTransport.send()` 是所有 provider 请求的最终出口
- 新增 `ProviderTransportRequest.requestId` 可选字段
- 仅在受支持的 Tuzi 同源请求中写入 `X-Request-Id`
- 跨域 Tuzi 与其他供应商不附带该头，避免 API 未在 `Access-Control-Allow-Headers` 放行时导致 `Failed to fetch`
- 只有实际发送了请求头时，超时抛出的 `TimeoutError` 才会挂载 `.requestId`
- **向后兼容**：不传 `requestId` 时行为完全不变

### 2.2 图片适配器自动生成 requestId

- `sendAdapterRequest()`（`model-adapters/context.ts`）
- 当请求为 Tuzi 同源图片调用且 caller 未显式传入 `requestId` → **自动生成 UUID**
- 通过 `AdapterContext.onRequestSent({ requestId })` 回调回传给 caller，便于日志/兜底

### 2.3 找回接口封装

- `recoverImageByRequestId(requestId, config, signal)` 位于 `media-api/image-api.ts`
- `GET /log/get-request?id={requestId}`，使用 `baseUrlStrategy: 'trim-v1'`（此接口不带 /v1 前缀）
- **短超时 15s**，避免兜底本身长时间挂起
- 响应结构与生图接口一致（`{ data: [{ url }] }`），复用 `parseImageResponse` 解析
- 若返回 `status` 非 `succeeded/success` → 抛出「找回接口返回状态非成功」

### 2.4 三处调用点覆盖超时兜底

| 路径 | 触发时机 | 文件 |
|---|---|---|
| **主线程 SW 模式 - Adapter** | tuzi/gpt-image/seedream 适配器生图超时 | `services/media-executor/fallback-adapter-routes.ts` |
| **主线程降级模式 - 直连** | `?sw=0` 降级路径下 `/images/generations` 直连超时 | `services/media-executor/fallback-executor.ts` |
| **同步 API 门面** | `generateImageSync()`（目前仅测试直用） | `services/media-api/image-api.ts` |

三处逻辑一致：
1. 生成 / 捕获 requestId
2. `providerTransport.send()` catch 到 `TimeoutError`
3. 调用 `recoverImageByRequestId()` 尝试找回
4. **成功**：把找回的图当正常结果，走 completeLLMApiLog + 缓存 URL + 完成任务
5. **失败**：抛出**原始超时错误**，日志的 `errorMessage` 保持"生图超时"，用户端展示保持原样

### 2.5 日志字段同步

- `LLMApiLog.requestId?: string`（双端 interface 同步）
- `startLLMApiLog({ requestId })` 支持初始化时写入
- 新增 `updateLLMApiLogRequestId(logId, requestId)` 用于 adapter 路径的后置补写（因 requestId 由 sendAdapterRequest 生成，先 log 后拿到 id）
- IDB schema 无需迁移（`requestId` 是可选字段）

## 三、代码改动清单

### 3.1 类型层

| 文件 | 改动 |
|---|---|
| `packages/drawnix/src/services/provider-routing/types.ts` | `ProviderTransportRequest` 新增 `requestId?: string` |
| `packages/drawnix/src/services/model-adapters/types.ts` | `AdapterContext` 新增 `onRequestSent?: (info: { requestId: string }) => void` |

### 3.2 传输层

`packages/drawnix/src/services/provider-routing/provider-transport.ts`

- 新增 `applyRequestIdHeader(headers, requestId)` 工具函数
- `prepareRequest()` 中调用 → 写入 `X-Request-Id`
- `send()` 中的 TimeoutError 挂上 `.requestId`

### 3.3 适配器上下文

`packages/drawnix/src/services/model-adapters/context.ts`

- `sendAdapterRequest()` 中：
  - 若 `context.operation === 'image'` 且 `request.requestId` 未设 → 生成 UUID
  - 若有 requestId + `onRequestSent` → 触发回调（try/catch 保护）
- 新增 `generateRequestId()` 兜底（`crypto.randomUUID` 优先，无则 `req-{ts}-{rand}`）

### 3.4 找回接口封装

`packages/drawnix/src/services/media-api/image-api.ts`

- 新增常量 `RECOVER_REQUEST_TIMEOUT_MS = 15_000`
- 新增函数 `generateRequestId()` / `isTimeoutError()` 工具
- **新增 `recoverImageByRequestId(requestId, config, signal)`**
- `generateImageSync()` 加超时兜底 try/catch

`packages/drawnix/src/services/media-api/index.ts`
- 导出 `recoverImageByRequestId`

### 3.5 图片直连路径兜底

`packages/drawnix/src/services/media-executor/fallback-executor.ts`

- 顶部新增 `generateRequestIdForImage()` / `isTimeoutErrorForRecover()`
- import `recoverImageByRequestId`
- `generateImage()` 图片直连分支：
  - 生成 requestId，写入 `startLLMApiLog` + `providerTransport.send`
  - 内层 try/catch 捕获 TimeoutError → 调 `recoverImageByRequestId` → 成功走 complete，失败 throw

### 3.6 Adapter 路径兜底 + 日志补写

`packages/drawnix/src/services/media-executor/fallback-adapter-routes.ts`

- 新增 `isTimeoutErrorForAdapterRecover()`
- import `recoverImageByRequestId` / `updateLLMApiLogRequestId` / 类型 `ImageApiConfig`
- `executeImageViaAdapter()` 中：
  - 显式创建 `adapterContext`，注入 `onRequestSent` 回调（首次触发时缓存 requestId + 补写日志）
  - 内层 try/catch 捕获 adapter 错误：若是超时 + 有 requestId → 构造 `recoverConfig`（从 `context.provider` 提取）→ 调找回

### 3.7 日志器双端同步

`apps/web/src/sw/task-queue/llm-api-logger.ts`（SW 模式）
`packages/drawnix/src/services/media-executor/llm-api-logger.ts`（主线程降级）

两处**结构对齐**：
- `LLMApiLog` interface 加 `requestId?: string`
- `startLLMApiLog` 参数加 `requestId?`
- 新增导出函数 `updateLLMApiLogRequestId(logId, requestId)`

## 四、执行步骤

### 4.1 顺序

1. **types 层**：`provider-routing/types.ts` / `model-adapters/types.ts`
2. **传输层**：`provider-transport.ts`
3. **适配器上下文**：`model-adapters/context.ts`
4. **日志器双端**：`sw/task-queue/llm-api-logger.ts` / `media-executor/llm-api-logger.ts`
5. **找回接口封装**：`media-api/image-api.ts` + `index.ts` 导出
6. **generateImageSync 兜底**：`media-api/image-api.ts`
7. **fallback-executor 兜底**：`media-executor/fallback-executor.ts`
8. **fallback-adapter-routes 兜底**：`media-executor/fallback-adapter-routes.ts`
9. **编译校验**：`pnpm exec nx run-many -t typecheck`

### 4.2 提交拆分建议

按上面的分组分 5-6 个 commit，方便 code review 与回滚。

## 五、验证方案

### 5.1 编译验证

```bash
pnpm exec nx run-many -t typecheck   # 5 个包全部通过 ✓
```

### 5.2 手动验证（浏览器）

**场景 A - 正常路径**：
1. 本地开发环境打开应用，用 `api.tu-zi.com` provider 正常生图
2. F12 > Application > IndexedDB > `llm-api-logs` > `logs`
3. 找到最新一条记录，字段 `requestId` 应为 UUID（如 `8c41eb26-a2d0-fcb1-01a6-f697e7d4e2ff`）
4. F12 > Network 面板中找到 `/images/generations` 请求，Request Headers 应包含 `X-Request-Id: <UUID>`
5. 改用跨域供应商域名时，Request Headers 不应包含 `X-Request-Id`，且生图仍能正常完成

**场景 B - 超时找回成功**：
1. 临时把 `IMAGE_GENERATION_TIMEOUT_MS`（`constants/TASK_CONSTANTS.ts`）改到 100ms
2. 触发一次生图
3. 观察 Console 应出现：
   - `[FallbackMediaExecutor/FallbackAdapterRoutes] 生图请求超时，尝试通过 X-Request-Id 找回: xxx`
   - `[...] ✅ 通过 X-Request-Id 找回结果成功: xxx`
4. 画布上应正常出现图片，任务状态为 completed（**不显示失败**）
5. 恢复超时常量

**场景 C - 找回失败**：
1. 同 B 步骤 1，触发超时
2. 但用 devtools 的 request block 屏蔽 `/log/get-request`
3. Console 应出现：
   - `[...] ❌ 通过 X-Request-Id 找回结果失败: xxx`
4. 用户端看到"生图超时"错误（**保持原有失败展示**）

### 5.3 日志查看

- IndexedDB `llm-api-logs` > `logs` 表
- 或访问 `sw-debug.html`（若项目有该调试页面）查看 requestId 字段

## 六、影响面 & 兼容性

| 项 | 说明 |
|---|---|
| **老日志记录** | `requestId` 为可选字段，读旧数据 = undefined，无影响 |
| **未覆盖的适配器**（如 Midjourney/Flux/Kling 视频） | 走 submit+poll 异步流，自身有 remoteId 机制，本次**不改** |
| **`?sw=0` 降级模式** | 已覆盖（fallback-executor 直连 + fallback-adapter-routes 两条分支）|
| **`crypto.randomUUID`** | Chrome 92+ / 现代 SW 全部支持，含极端兜底 fallback |
| **`baseUrlStrategy: 'trim-v1'`** | 已有能力，不新增基础设施 |
| **`X-Request-Id` 与 CORS** | 仅在 Tuzi 同源/代理请求中追加；其他请求省略，避免预检失败 |
| **找回接口自身超时** | 15s 短超时，兜底不拖累主流程 |

## 七、注意事项

### 7.1 只作用于同步生图

- **不覆盖**：`generateImageAsync`（走 `/v1/videos` 通道，自身有 remoteId + poll 机制）
- **不覆盖**：Midjourney / Flux / Kling / Seedance / 视频 API 等异步流程
- **不覆盖**：`AdapterContext.operation !== 'image'` 的场景（如聊天/视频/音频）

### 7.2 找回接口返回格式

- 已按 `{ data: [{ url }], status?: 'succeeded' }` 结构处理
- 若实际 API 返回结构不同（比如带 `data.state` 而非 `status`），需要调整 `recoverImageByRequestId` 内的 status 检测

### 7.3 缓存与 URL 有效期

- 找回来的 URL 会走原有 `cacheRemoteUrls` 流程缓存到本地 `/__aitu_cache__/`
- 用户看到的最终图片是缓存副本，不受签名 URL 过期影响

### 7.4 CLAUDE.md 规范符合性

- **规则 26（外部输入校验）**：`error.requestId` 使用前用 `typeof === 'string'` 检查
- **规则 22（降级路径功能一致性）**：SW 模式与降级模式都覆盖了兜底逻辑
- **断舍离原则**：仅新增必要字段和函数，不引入 Repository/Strategy 等抽象层
- **规则 27（SW 与主线程日志器双端同步）**：`LLMApiLog` interface 两处保持字段一致

## 八、后续拓展方向（不在本次范围内）

1. **失败原因分类**：`LLMApiLog` 新增 `recoveryAttempted?: boolean` / `recoveryFailReason?: string`，便于统计"多少次通过兜底救回"（用户当前选择只加 `requestId`）
2. **UI 展示**：在 `sw-debug.html` 增加 `requestId` 列，方便手动排查
3. **视频接口兜底**：Kling/Sora2 视频超时也可能失败但已扣费，未来可扩展到视频路径
4. **手动重试按钮**：给失败任务加"通过 requestId 重新找回"按钮

## 九、相关文件速查表

```
packages/drawnix/src/
├── services/
│   ├── provider-routing/
│   │   ├── types.ts                          [+] requestId 字段
│   │   └── provider-transport.ts             [+] applyRequestIdHeader + 挂 TimeoutError.requestId
│   ├── model-adapters/
│   │   ├── types.ts                          [+] AdapterContext.onRequestSent
│   │   └── context.ts                        [+] sendAdapterRequest 自动生成 requestId
│   ├── media-api/
│   │   ├── image-api.ts                      [+] recoverImageByRequestId + generateImageSync 兜底
│   │   └── index.ts                          [+] 导出 recoverImageByRequestId
│   └── media-executor/
│       ├── fallback-executor.ts              [+] 图片直连路径超时兜底
│       ├── fallback-adapter-routes.ts        [+] adapter 路径超时兜底 + 日志 requestId 补写
│       └── llm-api-logger.ts                 [+] LLMApiLog.requestId + updateLLMApiLogRequestId
└── ...

apps/web/src/sw/task-queue/
└── llm-api-logger.ts                          [+] LLMApiLog.requestId + updateLLMApiLogRequestId
```

`[+]` = 本次改动 / 新增
