## 1. OpenSpec and provider entry

- [x] 1.1 审批 `replace-posthog-with-umami-analytics` 提案
- [x] 1.2 在 `apps/web/index.html` 接入 Umami tracker 和 website ID
- [x] 1.3 替换 `apps/web/public/home.html` 与 `apps/web/public/en/home.html` 中的 PostHog 初始化

## 2. Runtime analytics migration

- [x] 2.1 将 `posthog-analytics.ts` 迁移为 Umami 实现并保留现有业务方法
- [x] 2.2 将 `posthog-adapter.ts` 迁移为 Umami adapter，更新插件出口和 batch service
- [x] 2.3 批量更新业务源码、测试和 mock 的导入路径与 provider 命名
- [x] 2.4 移除 `registerAnalyticsSuperProperties` 和 `window.posthog` 启动轮询
- [x] 2.5 保留脱敏、公共上下文和有限的 SDK 未加载保护
- [x] 2.6 调整页面访问、页面性能和 Web Vitals 事件，避免标准 pageview 重复

## 3. Runtime and deployment cleanup

- [x] 3.1 从 `netlify.toml`、`apps/web/public/_headers` 和 Vite dev/preview CSP 中移除 PostHog，加入 Umami
- [x] 3.2 更新 Service Worker 的监控域名放行和调试黑名单
- [x] 3.3 更新 crash logger、SW console capture 和运行时注释中的 provider 过滤
- [x] 3.4 保留历史 CHANGELOG/复盘文档，不把历史记录误删为运行时代码

## 4. Verification

- [x] 4.1 全仓库扫描确认运行时代码、配置和测试不再引用 PostHog
- [x] 4.2 运行 `git diff --check`
- [x] 4.3 运行相关单元测试、类型检查、Lint 和 Web 构建
- [ ] 4.4 浏览器验证 Umami 脚本、页面访问、自定义事件和 Web Vitals 请求
- [ ] 4.5 验证浏览器网络面板中没有 PostHog 请求，且 Umami 故障不阻塞应用启动
