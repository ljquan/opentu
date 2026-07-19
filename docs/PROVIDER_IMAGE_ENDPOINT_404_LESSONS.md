# 多供应商生图 404 路径排障经验

更新日期：2026-07-19

## 现象

新增供应商后，模型可以被正常发现和选择，但提交生图任务后返回：

```text
Tuzi GPT Image request failed: 404
```

这与浏览器的 `Failed to fetch` 不同。`404` 说明请求已经到达 HTTP 服务，但最终 URL 没有命中生图端点。

## 根因

OpenAI 兼容的生图端点通常是：

```text
POST /v1/images/generations
```

供应商配置将 `https://api.tu-zi.com/v1` 作为 Base URL 时，binding 应使用 `/images/generations`。如果 endpoint discovery、旧任务快照或手工 binding 又保留了 `/v1/images/generations`，普通字符串拼接会产生：

```text
https://api.tu-zi.com/v1/v1/images/generations
```

该路径会返回 `404`。

## 验证方法

排查时应将三个候选路径分开验证：

```text
/images/generations
/v1/images/generations
/v1/v1/images/generations
```

在 `api.tu-zi.com` 的本次验证中：

- `/v1/images/generations` 是存在的正确 API；无凭据时返回 `401`，使用有效凭据可返回图片。
- `/v1/v1/images/generations` 返回 `404`。
- 主机根路径下的 `/images/generations` 可能返回站点 HTML，不能当作生图 API 成功。

判断站点是否故障时，不能只看一次 `404`。应使用正确路径完成一次最小真实生成，并确认响应包含图片 URL 或 Base64 数据。

## 修复原则

### 1. 在统一传输层处理版本边界

URL 合并时，如果 Base URL 的末尾版本段与 path 开头的版本段完全相同，只保留一个。

例如：

```text
base: https://api.tu-zi.com/v1
path: /v1/images/generations
result: https://api.tu-zi.com/v1/images/generations
```

只折叠完全相同的版本段。`/v1` 和 `/v1beta` 不得合并，绝对 URL 也不得改写。

Tuzi GPT 生图还应显式使用 `ensure-v1` 传输策略。站点测速或备用站切换只保存 origin 时，运行时会自动补上 `/v1`；Base URL 已经包含 `/v1` 时不重复追加。

### 2. Base URL 与 endpoint path 职责必须清晰

- Base URL 已包含 `/v1` 时，常规 OpenAI binding 使用 `/images/generations`。
- endpoint 已经是完整绝对 URL 时，应直接使用，不再与 Base URL 拼接。
- Google `v1beta`、Suno 根路径、Kling 专用路径应继续使用各自的 `baseUrlStrategy`。

设置页中的 Tuzi 站点列表可以展示简洁的 origin，例如 `https://apicdn.tu-zi.com`，但选中或测速切换后写入供应商配置的必须立即是 `https://apicdn.tu-zi.com/v1`。重新打开设置时，应从已保存的 `/v1` Base URL 反查并唯一高亮对应站点。

模型价格地址是独立配置，仍使用 origin 下的 `/api/pricing`，不应被改成 `/v1/api/pricing`。

Tuzi 的官方备用站不都使用 `tu-zi.com` 域名。美国、广州和深圳节点使用 `sydney-ai.com` 或 `ourzhishi.top`，路由判断必须基于受信站点列表，不能只检查 hostname 后缀。否则切换备用站后，同一个 `gpt-image-2` 会被误判为普通 OpenAI 兼容模型并选择错误 adapter。

Tuzi `default` 分组的 GPT Image 简化 JSON 格式对文生图和参考图请求都使用 `/v1/images/generations`。旧任务或历史 binding 即使保存了 `/images/edits`，Tuzi JSON adapter 也必须修正回 `/images/generations`，不能把 JSON 请求发送到官方 multipart edits 接口。

站点首页测速只能反映连通性，不能证明生图路由可用。可信 Tuzi 节点对图片 POST 返回 `404` 时，应保持相同 API 版本和请求体尝试其它官方节点；普通供应商、绝对 endpoint 和非图片请求不得触发该切换。

### 3. 错误必须携带可安全暴露的 endpoint

供应商返回空响应或 HTML 错误页时，错误文案应包含最终 URL 的 pathname，但不包含 query、API Key 或 Authorization 请求头。

## 回归清单

- Base URL 为 `https://host/v1`，path 为 `/images/generations`。
- Base URL 为 `https://host`，使用 `ensure-v1`，path 为 `/images/generations`。
- Base URL 为 `https://host/v1`，path 为 `/v1/images/generations`。
- Base URL 为 `https://host/v1`，path 为 `/v1`。
- Base URL 为 `https://host/v1`，path 为 `/v1beta/...`，不应错误合并。
- 绝对 endpoint URL 保持不变。
- 设置页点击或自动选择备用站后，API 地址立即包含 `/v1`。
- 关闭并重新打开设置后，已保存站点保持唯一高亮。
- 价格地址仍为 `/api/pricing`，不追加 `/v1`。
- 官方备用域名仍按 Tuzi GPT Image 兼容模式推断 binding。
- 历史 `/images/edits` binding 在 Tuzi JSON adapter 中修正为 `/images/generations`。
- 可信 Tuzi 图片路由返回 `404` 时自动尝试下一官方节点。
- `404` 无 JSON 错误体时，用户可以看到最终 endpoint path。
- 使用真实供应商完成一次生图，不只验证模型列表。

## 相关代码

- `packages/drawnix/src/services/provider-routing/provider-transport.ts`
- `packages/drawnix/src/services/model-adapters/tuzi-gpt-image-adapter.ts`
- `packages/drawnix/src/components/settings-dialog/provider-endpoint-utils.ts`
- `packages/drawnix/src/utils/provider-base-url.ts`
- `packages/drawnix/src/services/__tests__/provider-routing.test.ts`
- `packages/drawnix/src/services/__tests__/tuzi-gpt-image-adapter.test.ts`
- `docs/PROVIDER_IMAGE_CORS_LESSONS.md`
