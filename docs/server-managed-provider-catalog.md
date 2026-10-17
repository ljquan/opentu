# 服务端供应商目录

## 部署变量

在 Vercel 项目中配置：

- `POSTGRES_URL`：Neon 提供的连接串（也可使用 `POSTGRES_URL_NON_POOLING`）。
- `OPENTU_PROVIDER_ENCRYPTION_KEY`：32 字节密钥，使用 base64 或 64 位 hex。
- `TUZI_SESSION_API_BASE_URL`：可选，默认为 `https://api.tu-zi.com`。
- `VITE_OPENTU_SERVER_CATALOG=true`：让首页模型广场读取 `/api/catalog/models`。

可以使用以下命令生成加密密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 管理流程

1. 使用 Tuzi 管理员账户打开 `/admin/providers`。
2. 添加供应商名称、Base URL、鉴权方式和 API Key。
3. 点击“测试连接”，确认供应商可以返回 `/v1/models`。
4. 点击“同步模型”，逐个发布用户允许使用的模型。

公开目录只返回供应商显示名和模型元数据。API Key 在服务端使用 AES-256-GCM 加密保存，浏览器不会收到密钥原文。

## 生产注意事项

- 上线前用迁移账号执行 `pnpm db:migrate`；命令读取进程环境中的数据库连接串，不自动加载 `.env`。先在测试库演练并备份生产库。生产请求只检查迁移版本，不再自动建表；运行账号需要读取迁移记录及业务表的 DML 权限，不需要 DDL 权限。
- 生产供应商地址必须为公网 HTTPS。目录同步和生成请求共用 DNS/IP 校验与固定解析结果的连接，禁止重定向、内网及保留地址；DNS 等待最多 5 秒。
- 模型同步采用加锁、去重批量写入和事务切换；供应商配置在请求期间变化时返回冲突，需重新同步。
- 不要在前端 `VITE_*` 变量中放置供应商密钥。
- `POSTGRES_URL` 或加密密钥缺失时，管理 API 会返回不可用状态，不会回退到浏览器保存的管理密钥。
- 当前变更建立了安全的目录和供应商管理边界；将所有创作协议统一改为服务端生成代理是后续独立变更。
- 首期公网只允许公开目录中的免费文本和图片模型。管理员灰度、外部结算、视频和音频任务均保持关闭；服务端通过 `OPENTU_PUBLIC_GENERATION_ENABLED` 显式开关控制。
