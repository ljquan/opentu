## 1. Implementation

- [x] 1.1 新增共享 AI composer 状态上下文，供 `AIInputBar` 与 `ChatDrawer` 复用生成配置
- [x] 1.2 收回共享附件草稿：`AIInputBar` 与 `ChatDrawer` 各自维护本地上传/素材库状态
- [x] 1.3 将 `ChatDrawer` 底部输入区收回为 agent-only 简洁对话框，不再重复提供配置控件
- [x] 1.4 将抽屉输入语义固定为 agent-only，不再跟随共享 `generationType` 直接提交工作流
- [x] 1.5 保留外部 `AIInputBar` → `ChatDrawer` 的工作流同步链路，但手动生成改为新建后台会话且不自动切换 active session
- [x] 1.6 补最小回归测试，覆盖附件隔离、agent-only 输入和后台会话同步
- [x] 1.7 恢复抽屉顶部文本模型选择，并保持按会话持久化
