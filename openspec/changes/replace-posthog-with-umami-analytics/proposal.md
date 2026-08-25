# Change: 将统计上报从 PostHog 迁移到 Umami

## Why

当前 Opentu 的 Web 端使用 PostHog 进行页面访问、AI 生成、UI 操作、PPT、提示词、页面性能和 Web Vitals 统计。原 PostHog 服务成本发生变化，需要迁移到项目提供的 Umami 服务 `https://umami.tu-zi.com`，同时停止浏览器继续加载或请求 PostHog。

## What Changes

- 在 Web 入口接入 Umami tracker，使用 website ID `e6bd249e-bc68-4857-b6a5-02131b4ea286`。
- 将现有业务统计工具和声明式 tracking adapter 的底层实现切换为 `window.umami.track()`。
- 保留现有业务事件名称、事件分类、脱敏规则、版本/环境/路由上下文和主要统计覆盖范围。
- 处理 Umami 与 PostHog 的差异：移除 PostHog `register()` 和特殊事件语义，避免自动 pageview 与手动页面访问重复上报，并正确处理 SDK 未加载和异步失败。
- 删除运行时代码、静态首页、CSP、Service Worker、错误过滤和测试中的 PostHog 专属代码与域名配置。

## Non-Goals

- 不新增自动识别所有可点击元素的埋点能力。
- 不改变现有业务事件的触发时机或产品交互。
- 不删除 CHANGELOG 和历史复盘文档中的历史 PostHog 记录。
- 不引入可在运行时切换多个统计供应商的通用平台。

## Impact

- Affected specs: `analytics-reporting`
- Affected code: `apps/web`, `packages/drawnix`, `netlify.toml`, `openspec`
- External service: `https://umami.tu-zi.com/script.js`
