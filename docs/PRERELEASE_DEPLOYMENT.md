# 预发布与生产部署架构

## 域名与环境

| 环境 | 域名 | 符号链接 | 用途 |
|------|------|----------|------|
| 预发布 | pr.opentu.ai | `releases/current` | 最新 deploy 版本，验证用 |
| 生产 | opentu.ai | `releases/production` | 正式对外版本 |

## 服务器架构

```
用户请求 → 212.50.250.235 (gateway, L4 stream proxy)
         → 23.106.140.133 / 10.33.12.77 (japan-server-2, nginx TLS 终止)

/home/opentu/releases/
├── 1.0.4/
├── 1.0.5/
├── current      → 1.0.5  (pr.opentu.ai)
├── production   → 1.0.4  (opentu.ai)
└── manage.sh
```

## 发布流程

```bash
# 1. 构建并部署到预发布 (pr.opentu.ai)
pnpm release

# 2. 在 pr.opentu.ai 验证功能正常

# 3. 推送到生产 (opentu.ai)
pnpm release:rollback              # 默认取 current 指向的版本
pnpm release:rollback 1.0.5        # 指定版本（位置参数）
pnpm release:rollback --v=1.0.5    # 指定版本（短参数）
pnpm release:rollback --version=1.0.5  # 指定版本（完整参数）
```

## Nginx 配置

- 生产: `/etc/nginx/sites-enabled/opentu-root.conf`
- 预发布: `/etc/nginx/sites-enabled/opentu-prerelease.conf`
- 仓库备份: `scripts/opentu-production.conf`, `scripts/opentu-prerelease.conf`

## SSL 证书

证书路径: `/etc/letsencrypt/live/opentu.ai/`
覆盖域名: `opentu.ai`, `pr.opentu.ai`
自动续期: certbot timer

## 服务器管理脚本

```bash
# 在 japan-server-2 上直接操作
/home/opentu/releases/manage.sh list       # 列出版本
/home/opentu/releases/manage.sh current    # 查看当前版本
/home/opentu/releases/manage.sh promote 1.0.5  # 手动推送生产
```

从本地安全删除未激活的历史版本：

```bash
pnpm release:remove 1.0.6
node scripts/release-manage.js remove 1.0.6 --dry-run
```

`remove` 仅接受 `x.y.z` 格式的版本号，并会拒绝删除 `current`（预发布）或
`production`（生产）正在使用的版本。已撤回的 `1.0.6`、`1.0.7` 不应重新部署。

## 注意事项

- gateway (212.50.250.235) 对所有非 `car.tu-zi.com` 的 SNI 做 TCP passthrough 到 japan-server-2
- `web.opentu.ai` 和 `share.opentu.ai` 走 Cloudflare，不在此服务器
- `pr.opentu.ai` DNS 已指向 212.50.250.235
