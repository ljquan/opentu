# 多供应商生图 CORS 预检失败排障经验

更新日期：2026-07-19

## 背景

用户新增图片供应商、选择模型并提交提示词后，任务会进入生成状态，但随后失败并只显示：

```text
Failed to fetch
```

该错误没有 HTTP 状态码和业务错误体，说明浏览器未能把真实响应交给应用层。在多供应商前端直连 API 的架构中，这种现象应优先检查 CORS 预检、DNS/TLS、浏览器扩展拦截和请求中断，不应先归因于模型或提示词。

## 根因

项目为图片提交请求新增了 `X-Request-Id`，用于把本地图片任务与 API 请求关联起来。

但该请求头被无条件用到了所有图片供应商。浏览器对跨域 `POST` 请求发起 `OPTIONS` 预检时，API 的响应只允许：

```text
Authorization
Content-Type
```

没有在 `Access-Control-Allow-Headers` 中放行 `X-Request-Id`。因此浏览器在正式生图请求发送之前就终止了调用，前端只能收到 `TypeError: Failed to fetch`。

## 关键证据链

### 1. 先验证凭据与 API 基线

直接请求 `/v1/models`，能正常返回模型列表，说明 API Key、Base URL 和基础鉴权可用。

再用不带 `X-Request-Id` 的 `/v1/images/generations` 请求生成图片，能获得正常结果，说明模型、请求体与响应解析链路正常。

### 2. 单独比较 CORS 预检

分别检查两组 `Access-Control-Request-Headers`：

```text
authorization,content-type
authorization,content-type,x-request-id
```

两次 `OPTIONS` 响应都没有在 `Access-Control-Allow-Headers` 中返回 `X-Request-Id`。这就能解释为什么 curl 可以成功，而浏览器会失败：

- curl 不执行浏览器 CORS 策略。
- 浏览器会先预检，且会拦截未被服务端明确放行的自定义头。

### 3. 在真实项目界面复验

在本地项目中按完整用户路径验证：

1. 新增供应商。
2. 填写 Base URL 和 API Key。
3. 获取并添加图片模型。
4. 从 AI 输入栏选择该供应商模型。
5. 提交提示词并等待任务完成。
6. 检查任务队列、结果图片、链接和控制台。

修复后任务成功完成，且没有出现 `Failed to fetch`。

## 修复原则

### 1. 自定义请求头必须是供应商能力

`X-Request-Id` 不是 OpenAI 兼容协议的通用部分。传输层不能因为操作类型是 `image` 就向所有供应商注入该头。

能力判断至少应包含：

- 当前 Base URL 是否属于允许该请求头的受信供应商。
- 最终请求是否与当前页面同源，或是否已由开发代理转成同源请求。

### 2. Request ID 必须来自稳定任务 ID

图片提交应复用本地任务 UUID；同一任务重试保持不变，不应由各适配器临时生成随机 ID。异步轮询 `GET` 不携带该请求头。

### 3. 开发代理与生产跨域是两种环境

本地 Vite 代理可以把指定 API 改写为同源路径，因此可携带 `X-Request-Id`。生产站点直连外部 API 时，必须服从对方 CORS 声明。

测试环境也不应被误判为开发代理环境，否则 URL 会被改写为相对路径，导致单元测试无法验证真实的生产跨域行为。

## 容易误判的方向

### 1. 把 `Failed to fetch` 当作 HTTP 500

HTTP 4xx/5xx 已经进入应用响应处理，通常能获取 status 和 body。`Failed to fetch` 更像是网络层、安全策略或请求取消问题。

### 2. 只用 curl 证明已修复

curl 成功只能证明 API 基线可用，无法证明浏览器 CORS 正常。前端直连供应商的功能必须在真实浏览器中做端到端验证。

### 3. 只修某一个 adapter

图片生成同时存在 adapter、同步 API 门面、fallback executor 等路径。如果能力规则没有收口到 provider transport 与共享判断函数，其他执行路径仍会重现问题。

### 4. 修图片结果缓存链路

远程图片缓存失败也可能出现 fetch 错误，但本次故障发生在生图请求提交前的预检阶段。应先根据任务进度、Network 面板和服务端是否收到请求区分故障阶段。

## 测试与上线检查清单

### 自动测试

- 自定义跨域供应商即使传入 request ID，也不应生成 `X-Request-Id` 请求头。
- Tuzi 跨域请求不应启用 request ID 请求头。
- Tuzi 同源或代理请求应继续携带本地任务 ID。
- 图片 API 响应解析仍应支持远程 URL 和 Base64。
- `drawnix` 类型检查必须通过。
- Web 主应用和 Service Worker 生产构建必须通过。

### 真实浏览器验证

- 新增供应商后可以获取模型。
- 可以选择新供应商的图片模型。
- 提交后任务从生成中进入已完成，不出现 `Failed to fetch`。
- 任务队列可以展示结果图和远程链接。
- 控制台没有本次请求的 CORS 或网络错误。

### 安全检查

- 不在源码、日志、文档、提交记录或 PR 描述中保留 API Key。
- 测试完成后删除临时供应商配置与本地测试数据。
- 已在对话、录屏或截图中暴露的 Key 应尽快轮换。

## 长期经验规则

- 协议兼容不等于请求头、CORS 和异步查询能力完全一致。
- 自定义头必须与 provider capability 或 binding metadata 绑定，不能只按媒体类型全局注入。
- 排查多供应商问题时，必须分别验证鉴权、协议、CORS、提交、轮询和结果缓存。
- 命令行基线验证与浏览器端到端验证缺一不可。
- Request ID 不能以破坏正常跨域请求为代价；不支持该头的供应商应稳定降级为普通请求。

## 相关代码

- `packages/drawnix/src/services/provider-routing/provider-transport.ts`
- `packages/drawnix/src/services/model-adapters/context.ts`
- `packages/drawnix/src/services/media-api/image-api.ts`
- `packages/drawnix/src/services/media-executor/fallback-executor.ts`
- `packages/drawnix/src/services/__tests__/provider-routing.test.ts`
- `docs/IMAGE_REQUEST_ID_LESSONS.md`
