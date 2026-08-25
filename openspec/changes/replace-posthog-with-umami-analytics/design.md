## Context

当前统计链路由 `apps/web/index.html` 中的 PostHog loader、`packages/drawnix/src/utils/posthog-analytics.ts`、声明式 `posthog-adapter.ts` 和多个业务调用方组成。启动代码会等待 `window.posthog` 后初始化页面报告和 Web Vitals。静态中英文首页、CSP、Service Worker 和错误日志过滤还各自包含 PostHog 专属逻辑。

Umami 提供浏览器脚本和 `window.umami.track(eventName, eventData)` 接口，但没有 PostHog `register()` 的同等超属性机制，也不会识别 `$web_vitals`、`$ai_generation` 等 PostHog 专属事件语义。

## Goals / Non-Goals

- Goals:
  - 让生产 Web 端只向 Umami 上报统计。
  - 保留当前业务统计方法和事件名称，减少调用方行为变化。
  - 保留现有脱敏、版本、环境、域名和路由上下文。
  - 统一页面访问口径，避免 Umami 自动 pageview 与手动基础 pageview 重复。
  - SDK 不可用时不影响应用启动。
- Non-Goals:
  - 不恢复历史旧版 Umami 实现。
  - 不重做声明式 tracking 功能或增加新的事件覆盖范围。
  - 不把历史文档中的 PostHog 内容当作当前运行时依赖处理。

## Decisions

### 1. 直接迁移现有统计工具

将 `posthog-analytics.ts` 改为 Umami 实现并保留其公开业务方法；将 `posthog-adapter.ts` 改为 `umami-adapter.ts`，同步更新插件出口、调用方和测试 mock。该方案不引入新的供应商抽象层，符合已确定的直接迁移范围。

### 2. 每个事件携带公共上下文

保留现有 `getAnalyticsReleaseContext()` 的数据模型，在每次 `track()` 时合并版本、部署环境、host、hostname 和 route_name。移除 `registerAnalyticsSuperProperties()` 及启动阶段对 `window.posthog.register()` 的依赖。

### 3. 页面访问由 Umami 自动 pageview 负责

使用 Umami tracker 的默认 pageview 能力，停止 `page-report-service` 中重复的基础 `app_page_view` 上报；保留页面性能和 Web Vitals 作为自定义事件。若后续仍需完整设备/视口页面数据，应使用不同的明确事件名，不能与标准 pageview 混用。

### 4. 保留本地统计开关语义

继续支持当前本地开发默认不加载统计、通过 `report=1` 显式启用的行为，避免开发数据污染生产统计。Umami 脚本加载失败或未完成初始化时，统计调用静默跳过且不阻塞启动。

### 5. 统一部署和 Service Worker 允许列表

从 `script-src`、`connect-src` 和 Service Worker 监控服务放行/调试黑名单中移除 PostHog 域名，加入 `umami.tu-zi.com` 所需规则。验证 Netlify、Vite dev/preview 和静态首页实际响应头均一致。

### 6. 处理异步和批量结果

Umami adapter 需要兼容 `track()` 返回 `void` 或 Promise 的 SDK 形态。批量服务必须等待可等待结果，不能把“调用已发起”误判为“上报成功”；保留现有内存重试边界，不在本次迁移中扩展离线持久化。

## Risks / Trade-offs

- Umami 不提供 PostHog 专属事件解析，历史 `$web_vitals` 和 `$ai_generation` 只能作为普通事件保留。
  - Mitigation: 保留事件名和字段，更新文档与验证口径。
- 自动 pageview 和现有手动页面统计可能重复。
  - Mitigation: 由 Umami 负责标准 pageview，关闭重复的基础手动 pageview。
- 全仓库导入和测试 mock 数量较多，遗漏会导致构建或运行时仍引用 PostHog。
  - Mitigation: 使用全仓库 `rg` 扫描，并在构建产物和浏览器网络面板中确认无 PostHog 请求。
- Umami 脚本被网络策略拦截时，部分低频事件会丢失。
  - Mitigation: 统计逻辑旁路化、设置有限等待/重试，不影响主业务。

## Migration Plan

1. 审批本变更提案。
2. 替换 Umami 核心工具、adapter、启动检查和所有调用方导入。
3. 替换应用入口及中英文静态首页的 tracker。
4. 更新 CSP、Service Worker、错误过滤和测试 mock。
5. 调整页面访问和性能事件，完成类型检查、测试、构建与浏览器网络验证。
6. 确认生产环境无 PostHog 请求后再发布。

## Rollback

若 Umami 上报或构建验证失败，可回滚本次变更提交，恢复 PostHog 入口、adapter、CSP 和启动检查；不涉及数据库或用户本地业务数据迁移。

## Open Questions

- Umami 后台是否需要保留现有 `app_page_view` 的完整设备/视口字段；当前方案默认不再重复上报基础页面访问。
- `report=1` 是否继续允许在预览环境启用统计；当前方案默认保留现有行为。
