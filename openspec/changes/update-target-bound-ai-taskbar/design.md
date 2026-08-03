# Design: AI 任务栏跟随图片目标

## Goals

- 单选生成图片或普通本地图时，现有任务栏跟随目标
- 生成图片恢复自身提示词；普通本地图保持空提示词
- 切换图片目标时隔离上一目标的附件和知识库上下文
- 缩略图始终对应当前稳定 URL，同一元素换源后立即刷新
- 编辑提示词后创建新任务并替换原图片
- 允许用户主动关闭当前跟随绑定，后续按普通图片生成流程新增图片
- 关闭后保留提示词、模型、参数、手动参考图和知识库上下文
- 保留原图片元素的 ID、位置、尺寸和选择上下文
- 失败或目标不存在时不修改画布内容
- 只保存 URL、ID 和 prompt，不复制大图数据

## Non-Goals

- 不扩展到视频、音频或文本目标
- 不改变话题或会话容器；目标级草稿、附件和知识库引用随目标切换清理
- 不改造左侧图片入口和外部 iframe 工具
- 不重构 provider 或任务队列

## Data Model

- image element:
  - `generationPrompt`
  - `generationTaskId`
  - `generationAnchorId`
- anchor:
  - `prompt`
  - `resultElementId`
  - `targetElementId`
  - `sourceTaskId`
  - `latestTaskId`
- task params:
  - `anchorId`
  - `replaceElementId`
  - `targetElementId`
  - `sourceTaskId`
  - `sourcePrompt`

## Flow

### Initial generation

1. AI 任务栏创建图片工作流和独立 anchor
2. 工作流图片步骤写入对应 `anchorId`
3. 图片任务完成并插入画布
4. 图片元素写入 prompt、任务 ID 和 anchor ID
5. anchor 回写结果元素 ID 和最新任务关系

### Target editing

1. 用户单选一张生成图片或普通本地图
2. 任务栏根据图片矩形和视口计算吸附位置；生成图片恢复自身 prompt，普通本地图使用空 prompt
3. 切换到另一目标时清理上一目标的手动附件、知识库引用和来源任务上下文
4. 用户修改 prompt 并提交
5. 新任务携带目标元素 ID；仅在当前目标存在生成绑定时携带 anchor ID 和来源任务 ID
6. 任务成功后通过 `Transforms.setNode` 更新原元素 URL 和元数据，并触发目标上下文刷新
7. 目标不存在或生成失败时保留当前画布，不退化为新增图片

### Detach target

1. 关闭按钮仅在任务栏绑定图片时显示，位于任务栏右上边缘
2. 点击关闭后清除当前绑定和自动目标缩略图，任务栏回到底部
3. 保留提示词、模型、参数、手动参考图和知识库上下文
4. 当前图片仍保持选中时，按元素 ID 抑制自动重新绑定
5. 取消选择、选择其他元素或重新选择图片后，恢复原有跟随和原位替换逻辑
6. 解除绑定后的提交不携带替换、目标、anchor 或来源任务字段，结果按普通流程新增图片
7. 每次真正关闭累计一次；第 5 次后通过 `localStorage` 永久隐藏提示，关闭按钮继续显示

### Local image rendering

1. 四种导入入口统一识别 MIME，浏览器缺失 MIME 时按扩展名兜底
2. 图片内容按 SHA-256 生成稳定虚拟 URL
3. Cache Storage 不可用时，Blob 存入 IndexedDB 独立对象仓库
4. 缩略图使用 `RetryImage` 从稳定 URL 解析临时 Object URL
5. source 变化后，旧 Blob 请求和重试定时器不得覆盖新图，旧 Object URL 必须释放

## Safety And Performance

- 不把 base64 或完整任务历史写入画布元素和 anchor
- 大文件哈希按分块处理；Blob 存取不复制到画布状态
- 视口事件通过 `requestAnimationFrame` 合并布局刷新
- 取消选择后不再计算目标吸附位置
- 关闭状态只保存当前元素 ID，持久化只保存有上限的小型点击计数
- 原位更新元素，避免删除和重建造成布局变化
