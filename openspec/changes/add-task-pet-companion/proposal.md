# Change: 新增任务灵宠提醒

## Why

AI 生成任务可能持续数秒到数分钟，用户切换到画布其他区域后只能主动打开任务队列查看状态。现有任务进度卡片适合精确查看，但缺少低干扰、持续可见且可按任务类型控制的状态提醒。

## What Changes

- 在左侧工具栏垃圾桶按钮正上方提供“灵宠设置”入口；灵宠本体改为独立画布浮层，不再挤在工具栏按钮内
- 灵宠本体支持拖动、视口边界夹取与位置持久化，默认停靠在画布右下区域
- 复用现有兔子品牌图片，通过稳定裁切和状态动作提升小尺寸可读性，不引入新的图片生成或远端素材依赖
- 订阅统一任务队列事件，将任务开始、提交、处理中、等待、下载、完成和失败映射为不同动作与提示气泡
- 支持按文本、生图、生视频任务分别启用提醒
- 支持独立开关灵宠显示、动作提醒和浏览器语音播报；默认显示灵宠并开启动作，语音默认关闭
- 在设置对话框新增“任务灵宠”页，并通过现有 `AppSettings` 链路持久化、备份小型偏好
- 复用现有 TTS 语音、语速、音调和音量设置；语音不可用时自动降级为动作与文字提示
- 对进度更新去重，对并发完成/失败事件进行固定窗口聚合，避免重复动画、连续抢播和无界内存增长
- 状态气泡根据灵宠所在象限自动选择展开方向；尊重系统“减少动态效果”偏好，并在窄视口限制气泡宽度
- 灵宠只读取任务类型、状态、阶段和数量，不展示提示词、结果地址或跨画板内容详情

## Impact

- Affected specs:
  - `task-pet-companion`
- Affected code:
  - `packages/drawnix/src/components/task-pet/`
  - `packages/drawnix/src/components/settings-dialog/`
  - `packages/drawnix/src/components/toolbar/`
  - `packages/drawnix/src/utils/settings-types.ts`
  - `packages/drawnix/src/utils/settings-manager.ts`
