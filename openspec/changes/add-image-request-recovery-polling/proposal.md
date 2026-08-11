# Change: 图片请求 ID 与刷新后结果恢复

## Why

可信 Tuzi 图片请求可能已成功提交，但页面刷新或正式 POST 后的连接中断会让浏览器无法确认提交结果，导致上游生成完成后原任务仍停留在处理中或被错误标记为失败。公网浏览器还要求目标节点的 CORS 明确放行 `X-Request-Id`，否则正式请求会在预检阶段失败。

## What Changes

- 图片正式 POST 前持久化当前 `submissionRequestId`、`imageSubmissionAttempted=true` 和调用路由。
- 可信 Tuzi 图片正式请求统一携带 `X-Request-Id`；本地、局域网及受支持的公网部署通过固定同源代理保留原节点与 Token，不支持代理的页面才确定性路由到兼容节点，且只提交一次。
- 页面刷新后或同页面正式提交结果未知时，仅恢复具有完整新提交元数据的同步图片任务；使用相同 Request ID 只读轮询上游结果。
- 结果未知的非幂等 POST 不跨 Tuzi 节点重发；仅幂等 GET/HEAD 保留网络 fallback，未携带 Request ID 的图片端点收到明确 404 后才沿用既有端点 fallback。
- 恢复成功后复用现有缓存、任务完成和卡片渲染流程；缓存失败时保留可用远程 URL。
- 取消、删除、重试、同步覆盖和超时通过 Request ID 条件写入与内存执行实例身份共同阻止旧结果覆盖 replacement 或释放其执行资源。
- Custom HTTP multipart 图片输入仅允许可信同源资源、无凭据公网 HTTP(S) 或有效图片 data/blob URL，并限制类型、重定向、文件数量和总字节数。

## Non-Goals

- 不在健康正式请求期间并行轮询结果。
- 不恢复缺少提交元数据的旧图片任务。
- 不提供 24 小时超时补偿或复活失败任务。
- 不向第三方供应商发送 Request ID、用户凭据或恢复查询。
- 不自动重新提交图片生成 POST。

## Impact

- Affected specs: `image-generation`
- Affected code:
  - 图片请求入口与 provider transport
  - 图片任务持久化、恢复轮询与任务执行器
  - 启动恢复扫描、定向测试、Docs/QA
