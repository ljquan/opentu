# Change: 增加安全的历史发布版本清理

## Why
预发布服务器会长期保留每次部署的完整静态产物。已确认有缺陷的版本如果仍然存在，不仅占用磁盘，也可能被误选为回滚目标或通过版本 URL 直接访问。

## What Changes
- 为本地发布管理脚本增加 `remove` 命令
- 删除前同时检查预发布与生产符号链接，禁止删除正在使用的版本
- 限制版本参数为标准三段式版本号，避免路径越界
- 支持 `--dry-run` 预览清理操作
- 在版本日志中明确标记已经撤回的版本，并停止提供进入该版本的链接
- 记录并清理已确认有缺陷的 `1.0.6`、`1.0.7` 发布产物

## Impact
- Affected specs: `release-safe-static-loading`
- Affected code: `scripts/release-manage.js`, `package.json`, `docs/PRERELEASE_DEPLOYMENT.md`, `CHANGELOG.md`, `scripts/sync-changelog.js`, `apps/web/public/versions.html`
