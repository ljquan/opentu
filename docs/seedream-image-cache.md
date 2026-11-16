# Seedream 5.5 原图缓存

Seedream 5.5 的火山存储图片可以直接显示，但实际响应缺少浏览器跨域许可。直接 fetch 因 CORS 失败时，无法把可见图片持久化为可读取的原图字节。

## 下载与缓存

- 对 `https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-5-5/` 下的图片，缓存下载使用同源路径 `/__opentu_seedream_images__/`，由站点转发到固定存储上游。
- 保留原始路径和签名查询参数；原始结果地址、来源元数据与缓存标识不变。生成结果缓存成功后继续使用现有稳定虚拟路径。其他域名、模型路径、非 HTTPS 地址及带用户名/密码的地址保持原有处理。
- 下载不携带 Cookie 或 Authorization；取消信号、超时和原图字节校验沿用既有缓存流程。转发返回 HTML 等错误内容时拒绝缓存。源链接过期或写入失败时保留原始结果与下载提醒，不能将失败当作成功。
- 手动重试缓存成功后清除旧缓存元数据中的警告。给 AI 读取旧图片时优先使用已缓存字节，避免再次依赖过期签名地址。

## 配置与发布

| 运行方式 | 对应配置 |
| --- | --- |
| 本地 Vite 开发服务 | `apps/web/vite.config.ts`，配置变更后由 Vite 重启生效 |
| Vercel | `vercel.json`，固定上游 rewrite 位于 SPA fallback 之前 |
| Netlify | `netlify.toml`，固定上游 200 rewrite |
| Nginx 生产/预发布 | `scripts/opentu-production.conf`、`scripts/opentu-prerelease.conf` 的 `location ^~ /__opentu_seedream_images__/` |

Nginx 配置仅允许 GET/HEAD，并去除认证、Cookie、Origin 和 Referer；启用上游 TLS 校验，CA 文件为 `/etc/ssl/certs/ca-certificates.crt`，不同系统需按实际 CA 路径调整。转发响应增加隔离 CSP 和 nosniff；不要将此路径配置为任意 URL 代理。

生产发布时先应用对应站点的转发规则，再发布前端。自建静态服务器需提供相同路径，单独复制前端产物不会创建服务器转发能力。没有规则时，缓存仍会失败并保留警告；回滚前端下载改动即可回到原来直接读取远程 URL 的行为，已有本地缓存不需要删除。本次没有执行部署。

`pr.opentu.ai` 使用预发布规则，`opentu.ai` 使用生产规则。实际发布前通过 `nginx -T` 确认对应域名生效的 server 配置，备份后仅加入上述 location，执行 `nginx -t` 并 reload，再发布前端；同时确认服务器可访问固定存储上游且 CA 文件存在。仓库中的 `scripts/upload-nginx-config.js` 当前上传旧的 `aitu-releases.conf`，不能据此判断会更新这两个域名实际使用的配置，勿直接用它覆盖站点。此处是发布操作说明，尚未检查线上有效配置。

Vercel/Netlify 重新部署时应用仓库已有 rewrite，无需人工修改 Nginx；部署成功后仍需验证有效图片地址通过同源路径返回图片字节并能缓存。本修复不新增环境变量、依赖、数据库迁移或 Tuzi API 服务改动。

## 已有结果与限制

新生成结果自动沿用修复后的下载路径。已有失败结果在原始签名地址仍有效时，可通过原有缓存/插入操作重新下载；修复不会自动批量扫描或重新生成历史任务。签名已失效且浏览器没有保存字节的旧图片无法凭此次修改恢复。

本修复不补回服务端 GET 响应缺失的分层位置或 OCR 元数据，不改变生成协议、模型请求和计费。新增存储域名或其他模型路径时需单独核对并扩展明确的映射与站点规则。

验证记录见 [Seedream 5.5 QA](./qa-seedream-5-5.md)。
