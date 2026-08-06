# tuzi-api 端点路由兜底经验

更新日期：2026-06-16

## 背景

OpenTu AI 网页版的供应商设置需要让用户选择 tuzi-api 的真实站点端点，并在默认自动模式下选择最优路径。用户反馈深圳地址在浏览器里可能出现 `Failed to fetch`，但 tuzi-api 其它站点可以正常使用。

这类问题不能靠手写一批站点解决。端点来源必须绑定上游 tuzi-api，同时实际请求链路要能在浏览器网络错误时切换到同一上游的其它站点。

## 上游来源

- 上游仓库：[tuziapi/tuzi-api](https://github.com/tuziapi/tuzi-api)
- 状态接口：`https://api.tu-zi.com/api/status`
- 解析字段：`data.api_address_list`

内置兜底只保留当前上游暴露的站点：

- `https://api.tu-zi.com`
- `https://apius.tu-zi.com`
- `https://apicdn.tu-zi.com`
- `https://api.sydney-ai.com`
- `https://api.ourzhishi.top`
- `https://apisz.ourzhishi.top`

## 修复规则

### 1. 端点来源统一收口

端点来源集中在 `tuzi-api-endpoints.ts`：

- 拉取 `https://api.tu-zi.com/api/status`。
- 只解析 `data.api_address_list`。
- 只接受内置上游白名单内的 origin。
- 状态接口失败时回退内置 6 个站点。

这样设置页、模型发现和请求兜底使用同一份来源，不再分别维护站点列表。

### 2. 设置页承载端点选择

端点管理只放在应用菜单的设置页里，不放到底部 AI 输入栏：

- 默认勾选自动选择。
- 支持测速后选择延迟最低端点。
- 支持手动点击端点并同步 API 地址。
- 支持添加/删除自定义端点。
- 页面显示来源为 `tuzi-api`。

样式必须归属设置页自身，避免复用底部输入栏类名导致功能边界不清。

### 3. 模型列表获取需要同源兜底

模型发现请求 `/models` 时，如果主端点发生浏览器网络错误，可按 tuzi-api 候选端点继续尝试。

只兜底网络层错误，例如：

- `Failed to fetch`
- `Load failed`
- `NetworkError`

不要吞掉 HTTP 401、模型参数错误、鉴权错误等业务响应。

### 4. 实际生成请求也要兜底

用户真正提交图片、文本或其它任务时，传输层也要在同一请求路径上重试其它 tuzi-api 站点。

关键约束：

- 当前 baseUrl 必须属于 tuzi-api 上游站点，才允许切换。
- 保留原路径后缀，例如 `/v1`。
- 复用原请求 body、headers 和超时控制。
- 只在浏览器网络错误时重试。

## 代码落点

- `packages/drawnix/src/services/provider-routing/tuzi-api-endpoints.ts`：tuzi-api 上游来源、白名单解析、兜底站点。
- `packages/drawnix/src/components/settings-dialog/settings-dialog.tsx`：设置页端点选择、自动/手动模式、测速和自定义端点。
- `packages/drawnix/src/components/settings-dialog/settings-dialog.scss`：设置页端点面板样式。
- `packages/drawnix/src/utils/runtime-model-discovery.ts`：模型列表 `/models` 网络错误兜底。
- `packages/drawnix/src/services/provider-routing/provider-transport.ts`：实际 Provider 请求网络错误兜底。
- `packages/drawnix/src/utils/__tests__/runtime-model-discovery.test.ts`：模型发现兜底测试。
- `packages/drawnix/src/services/__tests__/tuzi-api-endpoints.test.ts`：来源解析和来源失败兜底测试。

## 检查清单

- 设置页 API 地址下方显示端点面板。
- 端点面板显示 `来源: tuzi-api`。
- 底部 AI 输入栏不显示端点选择控件。
- `data.api_address_list` 只解析 tuzi-api 上游站点。
- 深圳地址 `Failed to fetch` 时，模型发现会尝试其它 tuzi-api 站点。
- 生成请求遇到浏览器网络错误时，会尝试其它 tuzi-api 站点。
- HTTP 401、参数错误和业务错误不会被误判为可切换端点。
- tuzi-api 状态接口失败时，功能仍可使用内置 6 个站点。

## 验证建议

```bash
pnpm nx run web:typecheck
pnpm --dir packages/drawnix exec vitest run \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/services/__tests__/tuzi-api-endpoints.test.ts
git diff --check
```

## 提交备注模板

```text
问题描述:
- OpenTu AI 网页版供应商端点来源需要绑定 tuzi-api 上游。
- 部分 tuzi-api 站点在浏览器环境可能出现 Failed to fetch，影响模型获取和实际生成请求。

修复思路:
- 新增 tuzi-api 端点来源模块，从 api.tu-zi.com/api/status 解析 data.api_address_list，并保留上游站点白名单兜底。
- 设置页新增端点面板，支持自动最优、测速、手动选择和自定义端点。
- 模型发现和 Provider 请求在浏览器网络错误时按同源 tuzi-api 站点重试。

更新代码架构:
- 端点来源集中到 provider-routing/tuzi-api-endpoints.ts。
- 设置页只负责端点选择 UI，不再把端点入口放到底部输入栏。
- runtime-model-discovery 和 provider-transport 共享 tuzi-api 候选端点兜底策略。
```
