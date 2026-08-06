# CDN 发布方案下线经验总结

更新日期：2026-07-18

## 现象

线上访问报错：

```
GET https://cdn.jsdelivr.net/npm/aitu-app@1.0.1/assets/index-BrKnNwcm.js
404 Not Found
```

用户能正常打开旧版本页面，但刷新到 `1.0.1` 版本后首屏脚本加载失败，无法进入工作台。

## 根因

项目并行存在两条发布链路：

1. **CDN 链路（旧）**：`apps/web/vite.config.ts` 的 `rewriteEntryAssetsToCDNPlugin` 默认会把构建产物 `index.html` 里的入口 `<script>`/`<link>` 改写成
   `https://cdn.jsdelivr.net/npm/aitu-app@{version}/assets/xxx.js`，这套“CDN 优先、本地兜底”的机制要求**每次发版都额外执行一次 `pnpm npm:publish`**，把对应版本发布到 npm，jsDelivr 才能读到内容。
2. **自建服务器链路（新）**：新增的 `scripts/release-manage.js` 通过 SSH 把构建产物 tar 包直接部署到自建服务器，构建时特意传入 `AITU_REWRITE_ENTRY_ASSETS_TO_CDN=0` 关闭 CDN 改写，产物用纯本地相对路径。

`1.0.1` 是走旧的默认构建流程发布的：HTML 被改写指向了 `aitu-app@1.0.1`，但对应的 `npm publish` 没有执行，导致 jsDelivr 上根本没有这个版本包 → 404。

一句话：
**“默认开启 CDN 改写”和“发布时才决定要不要发 npm”这两件事分离在两个地方判断，只要发布流程换了一条腿走路，就必然会漏掉另一条腿要求的步骤。**

## 决策

不修补“发布时自动带上 npm publish”，而是彻底下线 CDN 方案，只保留自建服务器直发这一条路径。理由：

- 自建服务器发布不依赖任何第三方 CDN 的可用性和版本发布节奏，链路更短、故障面更小。
- 项目已经不缺离线加速手段：Service Worker 本身有完整的预缓存/版本管理机制，CDN 只是锦上添花，却带来了“忘发 npm 包就 404”这种脆性代价。
- 断舍离：两条并行发布链路本身就是双份维护成本，且大概率会再次出现"改了一处、漏了另一处"的问题。

## 清理范围

CDN/npm-publish 相关代码分散在构建、启动脚本、Service Worker 三层，清理时按依赖关系逐层剥离：

| 层 | 清理内容 |
|---|---|
| 构建期 | `apps/web/vite.config.ts`：删除 `rewriteEntryAssetsToCDNPlugin`、`rewriteManifestAssetsToCDNPlugin`、`AITU_REWRITE_ENTRY_ASSETS_TO_CDN` 开关 |
| 启动期 | `apps/web/index.html`：删除 `toPreferredBootAssetUrl`、`__OPENTU_BOOT_ASSET_FALLBACK__`、`appendManagedBootScript`、`cdn-config.js` 加载、CDN 偏好同步逻辑；`apps/web/public/cdn-config.js`、`cdn-debug.html` 整体删除 |
| 主线程 | `apps/web/src/app/bootstrap.tsx`：删除向 SW 同步 CDN 偏好的协议代码 |
| Service Worker | `apps/web/src/sw/cdn-fallback.ts`（整个文件）、`cacheFile`/`handleStaticRequest` 里的 CDN 优先分支，全部改为直连源站 fetch |
| RPC/调试通道 | `packages/drawnix/src/services/sw-channel/client.ts`、`sw/task-queue/channel-manager.ts`：删除没有任何调用方的 `cdn:getStatus`/`cdn:resetStatus`/`cdn:healthCheck` 调试接口 |
| 发布脚本 | 删除 `publish-npm.js`、`publish-cdn-assets.js`、`build-hybrid.js`、`deploy-hybrid.js`、`rollback-hybrid.js`；`package.json` 删除 `npm:publish*` 系列脚本；`release-manage.js` 删除给 CDN 用的 HTML/manifest 兜底改写逻辑 |
| 文档 | 删除 `NPM_CDN_DEPLOY.md`、`CDN_DEPLOYMENT.md`；`FEATURE_FLOWS.md` 里对 `cdn-fallback.ts` 的引用一并清理 |

## 验证方式

- `pnpm typecheck` 全量通过。
- `pnpm run build:web` 构建成功，产物 `index.html`/`manifest.json`/`sw.js` 中搜不到任何 `jsdelivr`/`aitu-app@` 字样。
- 受影响的 vitest 用例（`app-shell-routing.spec.ts` 等）全部通过。
- `pnpm lint` 存量告警与清理前基线一致，本次改动未引入新的告警。

## 后续规则

1. **不要在没有自动化保障的前提下引入“构建期改写资源 URL 指向外部服务”的机制**：一旦资源 URL 和外部发布动作（npm publish、对象存储上传等）分属两个独立触发点，就必然会出现遗漏其一的窗口期。
2. **静态资源统一走自建服务器同源地址**，离线加速完全交给 Service Worker 的预缓存/版本管理，不再引入第三方 CDN 依赖。
3. 若未来确有引入 CDN 的需求，要求：资源 URL 改写和外部发布必须在**同一个脚本、同一次调用**里原子完成，禁止分成两个可以独立执行的步骤。
