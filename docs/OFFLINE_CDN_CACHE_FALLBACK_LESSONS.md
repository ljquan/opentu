# 离线 CDN 资源缓存回退经验

> **已废弃（2026-07-18）**：项目已彻底下线 jsDelivr/npm 发布的 CDN 方案，全量转自建服务器直发。本文档仅作历史记录保留，当前实现请参考 [CDN 方案下线经验](./CDN_TO_SELF_HOSTED_LESSONS.md)。

## 背景

离线打开已访问过的工作台时，启动进度停在 82%。控制台显示入口 CSS/JS、`cdn-config.js`、`manifest.json` 等 CDN 资源在断网环境下请求失败，最终 Service Worker 返回 503。

## 现象判断

- 82% 不是业务初始化进度，而是启动壳的模拟进度上限。
- 进度停住通常表示主入口 JS/CSS 没有成功加载，应用没有机会调用 `window.__OPENTU_BOOT__.markReady()`。
- “浏览器访问过一次”不等价于资源一定进入了当前版本的 SW Cache；资源可能只存在于浏览器 HTTP cache，或存在于旧版本 SW Cache。

## 根因

- 构建后首屏资源会被重写到 jsDelivr，例如 `/npm/aitu-app@0.6.73/assets/index-xxx.js`。
- SW 静态缓存键使用同源路径，例如 `/assets/index-xxx.js`。
- 离线时如果 CDN 绝对路径没有归一为同源资源路径，就无法命中已有缓存。
- 对缺少 SW 自定义元数据的有效缓存响应过于保守，会误判为可疑缓存并删除。

## 修复策略

- 在 SW 解析静态资源目标时，将 `aitu-app@version` 包路径归一到真实同源路径。
- Smart CDN 资源联网回退前，先查当前 SW Cache、旧版本 SW Cache，再查浏览器 HTTP cache。
- 对无 SW 元数据但 `ok` 且不是 HTML fallback 的静态响应允许使用，避免离线误删可用缓存。

## 后续守则

- CDN URL、同源 URL、npm 包 URL 必须收敛到同一个缓存键体系。
- 离线兜底顺序应优先使用本地可用缓存，再尝试网络来源。
- 不要把“已访问过一次”当作 SW 预缓存完成的证明。
- 修改启动链路时，优先跑 SW/CDN 相关单测，避免全量编译浪费时间。

## 验证命令

```bash
pnpm exec vitest run apps/web/src/sw/cdn-fallback.spec.ts apps/web/src/sw/app-shell-routing.spec.ts --run
```
