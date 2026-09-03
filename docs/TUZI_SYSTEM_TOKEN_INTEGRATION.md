# Tuzi 系统令牌接入

OpenTu 的 Tuzi 账户页使用用户在浏览器中提供的系统访问令牌和用户 ID 读取账户信息，并按授权分组同步托管供应商。令牌和用户 ID 不属于构建时或部署时配置，不应写入生产环境变量、镜像或仓库。

## 使用方式

用户可以在“设置 -> Tuzi 账户”中填写用户 ID 和系统访问令牌，也可以通过 OpenTu URL 参数传入：

- 用户 ID：`id` 或 `tuzi_user_id`
- 系统访问令牌：`token`、`key`、`tuzi_token` 或 `tuzi_api_token`

连接或替换令牌成功后，当前账户页会重新读取账户余额、用量、请求次数和授权分组，并立即同步供应商列表。清除令牌时只移除 Tuzi 托管供应商，用户自定义供应商不受影响。

## 构建配置

Tuzi 集成默认开启，API 地址默认使用 `https://api.tu-zi.com`，标准生产部署无需配置这两项。需要切换到其他 Tuzi API 时才设置：

```env
VITE_TUZI_API_BASE_URL=https://其他-tuzi-api.example.com
VITE_TUZI_PARENT_ORIGIN=https://api.tu-zi.com
```

只有明确设置 `VITE_TUZI_EMBEDDED_MODE=false` 时才关闭 Tuzi 集成。`VITE_TUZI_PARENT_ORIGIN` 当前仅保留为嵌入来源配置。系统令牌和用户 ID 必须由用户输入或 URL 参数提供。

## 反向代理

当 OpenTu 与 Tuzi API 不同源时，账户请求会使用 OpenTu 同源路径：

```text
/__opentu_tuzi_session__/* -> https://api.tu-zi.com/*
```

仓库已经为 Vite、Netlify、Vercel 以及生产和预发布 Nginx 配置该路由。其他自托管环境必须在外层反向代理增加等价规则，并保留 `Authorization` 和 `New-Api-User` 请求头。

`lipanski/docker-static-website` 仅提供静态文件，不负责上述动态反向代理；使用该镜像部署时必须由外层 Nginx、网关或负载均衡器提供代理路由。

## Tuzi API 兼容要求

目标 Tuzi API 需要接受：

- `Authorization: Bearer <系统令牌>`
- `New-Api-User: <用户 ID>`
- `GET /api/user/self`
- `POST /api/opentu/providers/ensure`
- `POST /api/opentu/providers/:group/rotate`
- `GET /api/log/self`
- `GET /api/option`

日志按页读取，不会在打开设置时全量加载；供应商模型只在实际需要时发现，避免连接或切换设置页时重复请求全部模型。
