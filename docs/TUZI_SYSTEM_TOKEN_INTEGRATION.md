# Tuzi 系统令牌接入

OpenTu 是独立开源应用。只有当它被嵌入已登录的 tuzi-api 页面，并且收到可信父页面的 `postMessage` 响应时，才启用 Tuzi 系统令牌和分组配置流程。独立部署、直接访问或嵌入其他站点时，仍使用原有供应商 API Key 配置，不展示 Tuzi 专属界面，也不发起 Tuzi 业务请求。

## 用户流程

1. 用户在对话框发送消息，OpenTu 发现当前文本路由没有可用 API Key。
2. OpenTu 向父页面发送 `TUZI_OPENTU_READY`，最多等待 10 秒。
3. tuzi-api 校验消息来源和 iframe 窗口后，返回当前登录用户的 ID、系统令牌状态和可用分组。
4. 已有系统令牌时，OpenTu 直接进入分组选择；没有系统令牌时显示“创建系统令牌”按钮。
5. 用户点击创建后，OpenTu 发送 `TUZI_CREATE_SYSTEM_TOKEN`，由 tuzi-api 使用当前登录会话创建或取得令牌并返回。
6. 用户选择已有分组，或使用“创建新的令牌分组”操作完成 Provider 配置。OpenTu 发送 `TUZI_ENSURE_PROVIDERS`，同步托管 Provider 及模型。
7. 设置成功后弹窗关闭，首次被拦截的消息只自动发送一次。后续发送直接复用已保存的分组和 Provider，不重复弹窗。

如果 10 秒内没有收到合法响应，OpenTu 将本次页面生命周期标记为独立模式并打开原有供应商配置。独立模式不会创建系统令牌、保存 Tuzi 上下文或显示 Tuzi 引导。

## 安全边界

- 系统令牌和用户 ID 只保存在 OpenTu 当前页面内存中，不写入 URL、hash、`localStorage`、构建变量、镜像或仓库。
- OpenTu 只接受 `window.parent` 发出的消息，并严格匹配父页面 origin、协议版本、消息类型和 `requestId`。
- 父页面只接受目标 OpenTu iframe 的消息，并用 iframe 的精确 origin 回复，不使用 `*`。
- `VITE_TUZI_PARENT_ORIGIN` 可用于固定允许的父页面 origin；同时存在 `document.referrer` 时两者必须一致。
- 刷新页面后必须重新握手。父页面登录过期时，后续请求返回错误，不复用旧凭据。

## 消息协议

所有消息使用版本 `1`，并携带唯一 `requestId`：

```text
OpenTu -> tuzi-api: TUZI_OPENTU_READY
tuzi-api -> OpenTu: TUZI_OPENTU_CONTEXT

OpenTu -> tuzi-api: TUZI_CREATE_SYSTEM_TOKEN
tuzi-api -> OpenTu: TUZI_SYSTEM_TOKEN_CREATED

OpenTu -> tuzi-api: TUZI_ENSURE_PROVIDERS
tuzi-api -> OpenTu: TUZI_PROVIDERS_READY

tuzi-api -> OpenTu: TUZI_OPENTU_ERROR
```

`TUZI_OPENTU_CONTEXT` 的 `status` 为 `ready` 或 `need_system_token`。只有 `ready` 响应包含 `systemToken`；两种状态都必须包含数字形式的 `userId` 和 `groups`。

## 构建配置

生产环境建议固定父页面来源：

```env
VITE_TUZI_PARENT_ORIGIN=https://api.tu-zi.com
```

本地联调可将同源代理指向本地 tuzi-api；未设置时仍使用生产地址：

```env
VITE_TUZI_SESSION_PROXY_TARGET=http://127.0.0.1:3101
```

账户余额、日志、换新分组 Key 等已有 Tuzi 账户功能仍可能通过同源代理访问 Tuzi API。不同源部署需要保留：

```text
/__opentu_tuzi_session__/* -> https://api.tu-zi.com/*
```

静态文件服务器不提供动态代理；这部分必须由外层 Nginx、网关或负载均衡器实现。首次令牌创建和 Provider ensure 通过父页面 `postMessage` 完成，不依赖 OpenTu 直接持有 tuzi-api 登录 Cookie。
