## 1. Implementation
- [x] 1.1 为 `ToolDefinition` 补充默认窗口行为类型定义，至少支持 `autoPinOnOpen`
- [x] 1.2 调整 `tool-window-service` 的打开逻辑，在未显式传入 `autoPin` 时读取工具定义默认行为
- [x] 1.3 为 `video-analyzer` 与 `music-analyzer` 配置默认打开即常驻
- [x] 1.4 补充针对性校验，确认默认自动常驻与显式 `autoPin`、手动 pin/unpin 不冲突
