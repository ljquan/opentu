# PostHog Web Vitals 和 Page Report 监控

本文档说明了如何在 Opentu 项目中使用 PostHog 上报 Web Vitals 数据和 Page Report 数据。

## 功能概述

### 1. Web Vitals 监控 (`web-vitals-service.ts`)

自动监控并上报 Core Web Vitals 指标：

- **LCP (Largest Contentful Paint)**: 最大内容绘制 - 衡量加载性能
  - Good: < 2.5s
  - Needs Improvement: < 4s
  - Poor: ≥ 4s

- **FCP (First Contentful Paint)**: 首次内容绘制
  - Good: < 1.8s
  - Needs Improvement: < 3s
  - Poor: ≥ 3s

- **CLS (Cumulative Layout Shift)**: 累积布局偏移 - 衡量视觉稳定性
  - Good: < 0.1
  - Needs Improvement: < 0.25
  - Poor: ≥ 0.25

- **TTFB (Time to First Byte)**: 首字节时间 - 衡量服务器响应速度
  - Good: < 800ms
  - Needs Improvement: < 1800ms
  - Poor: ≥ 1800ms

- **INP (Interaction to Next Paint)**: 交互到下一次绘制 - 衡量响应性能
  - Good: < 200ms
  - Needs Improvement: < 500ms
  - Poor: ≥ 500ms

### 2. Page Report 监控 (`page-report-service.ts`)

自动监控并上报页面浏览和性能数据：

#### 页面浏览事件 (`page_view`)
- 页面 URL 和路径
- 页面标题
- 来源 (referrer)
- 视口尺寸 (viewport width/height)
- 屏幕尺寸 (screen width/height)
- 设备类型 (mobile/tablet/desktop)
- 浏览器 User Agent
- 浏览器语言

#### 页面性能事件 (`page_performance`)
使用 Navigation Timing API Level 2 收集：
- DNS 查询时间 (`dns_time`)
- TCP 连接时间 (`tcp_time`)
- 请求时间 (`request_time`)
- 响应时间 (`response_time`)
- DOM 处理时间 (`dom_processing_time`)
- DOM Interactive 时间 (`dom_interactive_time`)
- DOM Complete 时间 (`dom_complete_time`)
- 完整加载时间 (`load_time`)
- 资源数量 (`total_resources`)
- 资源总大小 (`total_size`)

#### 其他事件
- `page_unload`: 页面卸载，包含页面停留时间
- `page_hidden`: 页面隐藏（用户切换标签）
- `page_visible`: 页面可见（用户返回标签）

### 3. SPA 导航支持

Page Report 服务自动监听 SPA 单页应用的导航：
- `history.pushState()` 调用
- `history.replaceState()` 调用
- `popstate` 事件（浏览器前进/后退）

## 实现细节

### 初始化流程

在 `apps/web/src/main.tsx` 中：

```typescript
// 等待 PostHog 加载完成后初始化监控
const initMonitoring = () => {
  if (window.posthog) {
    console.log('[Monitoring] PostHog loaded, initializing Web Vitals and Page Report');
    initWebVitals();
    initPageReport();
  } else {
    console.log('[Monitoring] Waiting for PostHog to load...');
    setTimeout(initMonitoring, 500);
  }
};

// 延迟初始化，确保 PostHog 已加载
setTimeout(initMonitoring, 1000);
```

### PostHog 事件格式

所有事件都包含以下标准字段：
- `category`: 事件类别 (`web_vitals` 或 `page_report`)
- `timestamp`: 事件发生时间戳
- `page_url`: 完整页面 URL
- `page_path`: 页面路径

#### Web Vitals 事件示例

```javascript
{
  eventName: 'web_vitals',
  category: 'web_vitals',
  metric_name: 'LCP',
  metric_value: 2345.67,
  metric_rating: 'good',
  metric_id: 'v3-1234567890',
  metric_delta: 123.45,
  navigation_type: 'navigate',
  page_url: 'https://opentu.ai/',
  page_path: '/',
  referrer: 'https://google.com',
  user_agent: 'Mozilla/5.0...',
  timestamp: 1702345678901
}
```

#### Page View 事件示例

```javascript
{
  eventName: 'page_view',
  category: 'page_report',
  page_url: 'https://opentu.ai/',
  page_path: '/',
  page_title: 'Opentu - AI应用平台',
  referrer: 'https://google.com',
  viewport_width: 1920,
  viewport_height: 1080,
  screen_width: 1920,
  screen_height: 1080,
  device_type: 'desktop',
  user_agent: 'Mozilla/5.0...',
  language: 'zh-CN',
  timestamp: 1702345678901
}
```

#### Page Performance 事件示例

```javascript
{
  eventName: 'page_performance',
  category: 'page_report',
  page_url: 'https://opentu.ai/',
  page_path: '/',
  dns_time: 45.2,
  tcp_time: 102.3,
  request_time: 234.5,
  response_time: 156.7,
  dom_processing_time: 456.8,
  dom_interactive_time: 987.6,
  dom_complete_time: 1234.5,
  load_time: 2345.6,
  total_resources: 42,
  total_size: 1234567,
  timestamp: 1702345678901
}
```

## PostHog 查询示例

### 查询 Web Vitals 数据

```javascript
// 查询所有 LCP 数据
event = 'web_vitals' AND properties.metric_name = 'LCP'

// 查询性能较差的 LCP
event = 'web_vitals' AND properties.metric_name = 'LCP' AND properties.metric_rating = 'poor'

// 按页面分组统计平均 LCP
event = 'web_vitals' AND properties.metric_name = 'LCP'
GROUP BY properties.page_path
AGGREGATE AVG(properties.metric_value)
```

### 查询 Page Report 数据

```javascript
// 查询所有页面浏览
event = 'page_view'

// 按设备类型分组统计页面浏览
event = 'page_view'
GROUP BY properties.device_type

// 查询页面加载性能
event = 'page_performance'
AGGREGATE AVG(properties.load_time), P95(properties.load_time)

// 查询特定页面的性能
event = 'page_performance' AND properties.page_path = '/'
```

### 用户漏斗分析

```javascript
// 页面浏览 -> 页面加载完成 -> 用户交互
1. event = 'page_view'
2. event = 'page_performance'
3. event = 'web_vitals' AND properties.metric_name = 'INP'
```

## 性能影响

### Web Vitals 监控
- 使用动态导入 (`import('web-vitals')`)，不影响初始包大小
- 仅在用户与页面交互时收集数据
- 异步上报，不阻塞主线程

### Page Report 监控
- 使用原生浏览器 API，性能开销极小
- 批量上报，减少网络请求
- 延迟初始化（1秒后），不影响页面加载

## 浏览器兼容性

### Web Vitals
- LCP, CLS, FCP: 所有现代浏览器
- INP: Chrome 96+, Edge 96+
- TTFB: 所有现代浏览器

### Page Report
- Navigation Timing API Level 2: Chrome 57+, Firefox 58+, Safari 15+
- Performance Observer: 所有现代浏览器
- 降级方案：在不支持的浏览器中安静失败

## 故障排查

### 问题：PostHog 未加载

**症状**：控制台显示 `[Monitoring] Waiting for PostHog to load...`

**解决方案**：
1. 检查 `apps/web/index.html` 中的 PostHog 初始化脚本
2. 确认 PostHog API key 正确
3. 检查浏览器控制台是否有网络错误
4. 确认 PostHog 服务正常运行

### 问题：Web Vitals 数据未上报

**症状**：PostHog 中没有 `web_vitals` 事件

**解决方案**：
1. 打开浏览器控制台，查看是否有 `[Web Vitals]` 日志
2. 检查 `web-vitals` 包是否正确安装：`npm list web-vitals`
3. 确认页面有足够的用户交互（某些指标需要交互才触发）
4. 检查浏览器是否支持相关 API

### 问题：Page Report 数据不完整

**症状**：某些性能指标缺失

**解决方案**：
1. 某些指标依赖 Navigation Timing API Level 2，检查浏览器兼容性
2. 在本地开发环境，某些指标可能不准确
3. 确认在页面完全加载后才收集数据

## 测试

运行单元测试：

```bash
# 测试 Web Vitals 服务
nx test drawnix --testFile=web-vitals-service.test.ts

# 测试 Page Report 服务
nx test drawnix --testFile=page-report-service.test.ts

# 运行所有测试
npm test
```

## 相关文件

- `packages/drawnix/src/services/web-vitals-service.ts` - Web Vitals 监控服务
- `packages/drawnix/src/services/page-report-service.ts` - Page Report 监控服务
- `packages/drawnix/src/utils/posthog-analytics.ts` - PostHog Analytics 工具类
- `apps/web/src/main.tsx` - 应用入口，初始化监控
- `apps/web/index.html` - PostHog 初始化脚本

## 参考资料

- [Web Vitals 官方文档](https://web.dev/vitals/)
- [web-vitals 库](https://github.com/GoogleChrome/web-vitals)
- [Navigation Timing API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_timing_API)
- [PostHog 文档](https://posthog.com/docs)
