# Change: 图片请求 ID 与刷新后结果恢复

## Why

可信 Tuzi 图片请求可能已成功提交，但页面刷新会中断浏览器连接，导致上游生成完成后原任务仍停留在处理中或被标记为中断。公网浏览器还要求目标节点的 CORS 明确放行 `X-Request-Id`，否则正式请求会在预检阶段失败。

## What Changes

- 图片正式 POST 前持久化当前 `submissionRequestId`、`imageSubmissionAttempted=true` 和调用路由。
- 可信 Tuzi 图片正式请求统一携带 `X-Request-Id`；若配置节点未放行该请求头，确定性路由到已验证兼容的可信节点，且只提交一次。
- 页面刷新后，仅恢复具有完整新提交元数据的同步图片任务；使用相同 Request ID 只读轮询上游结果。
- 恢复成功后复用现有缓存、任务完成和卡片渲染流程；缓存失败时保留可用远程 URL。
- 取消、删除、重试和超时通过 Request ID 条件写入阻止旧结果覆盖新状态。

## Non-Goals

- 不在健康正式请求期间并行轮询结果。
- 不恢复缺少提交元数据的旧图片任务。
- 不提供 24 小时超时补偿或复活失败任务。
- 不因同页面网络错误自动进入恢复。
- 不向第三方供应商发送 Request ID、用户凭据或恢复查询。
- 不自动重新提交图片生成 POST。

## Impact

- Affected specs: `image-generation`
- Affected code:
  - 图片请求入口与 provider transport
  - 图片任务持久化、恢复轮询与任务执行器
  - 启动恢复扫描、定向测试、Docs/QA
