# Design: AI 任务栏跟随图片目标

## Goals

- 单选生成图片或普通本地图时，现有任务栏跟随目标
- 生成图片使用自身提示词初始化按图片草稿；普通本地图使用空草稿
- 切换图片目标时保存当前草稿并恢复目标自己的提示词、附件和知识库上下文
- 缩略图始终对应当前稳定 URL，同一元素换源后立即刷新
- 编辑提示词后创建新任务并替换原图片
- 允许用户永久开启或关闭任务栏位置跟随，不改变图片目标绑定与生成语义
- 允许用户主动关闭当前跟随绑定，后续按普通图片生成流程新增图片
- 关闭后保留提示词、模型、参数、手动参考图和知识库上下文
- 保留原图片元素的 ID、位置、尺寸和选择上下文
- 失败或目标不存在时不修改画布内容
- 只保存 URL、ID 和 prompt，不复制大图数据

## Non-Goals

- 不扩展到视频、音频或文本目标
- 不改变话题或会话容器；目标级草稿仅在当前画板会话中按图片隔离
- 不改造左侧图片入口和外部 iframe 工具
- 不重构 provider 或任务队列

## Data Model

- image element:
  - `generationPrompt`
  - `generationTaskId`
  - `generationAnchorId`
  - `aiTaskbarReferenceOnly`
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
- local UI preference:
  - `aitu_ai_bound_target_follow_enabled`，仅存布尔值，缺省为开启

## Flow

### Initial generation

1. AI 任务栏创建图片工作流和独立 anchor
2. 工作流图片步骤写入对应 `anchorId`
3. 图片任务完成并插入画布
4. 图片元素写入 prompt、任务 ID 和 anchor ID
5. anchor 回写结果元素 ID 和最新任务关系

### Target editing

1. 用户单选一张生成图片或普通本地图
2. 任务栏根据图片矩形和视口计算吸附位置，并加载该图片的当前草稿
3. 首次选择生成图片时以图片 prompt 初始化草稿；普通本地图以空 prompt 初始化
4. 切换到另一目标时保存当前图片的提示词、手动附件和知识库引用，并恢复新目标自己的草稿
5. 同一元素元数据刷新时，未编辑的默认 prompt 随元数据更新，用户已编辑的 prompt 保持不变
6. 用户编辑或确认 prompt 后提交
7. 新任务携带目标元素 ID；仅在当前目标存在生成绑定时携带 anchor ID 和来源任务 ID
8. 任务成功后通过 `Transforms.setNode` 更新原元素 URL 和元数据，并触发目标上下文刷新
9. 目标不存在或生成失败时保留当前画布，不退化为新增图片

### Detach target

1. 关闭按钮仅在任务栏绑定图片时显示，位于任务栏右上边缘；主按钮临时关闭，旁边菜单提供“本次只作参考图”和“对此图始终只作参考图”
2. 点击关闭后只解除任务栏吸附和原图替换关系，任务栏回到底部，当前图片缩略图继续以“参考图”显示
3. 当前图片保持为生成请求的第一张参考图，同时保留提示词、模型、参数、手动参考图和知识库上下文
4. 临时关闭时，当前图片仍保持选中则按元素 ID 抑制自动重新绑定；取消选择或选择其他元素后恢复默认跟随
5. 永久关闭时，在图片元素写入轻量 `aiTaskbarReferenceOnly` 标记；重新选择或重新加载画板后仍只作为参考图，不跟随、不覆盖
6. 解除绑定后的提交不携带替换、目标、anchor 或来源任务字段，结果按普通流程新增图片，原图保持不变
7. 每次真正关闭累计一次；第 5 次后通过 `localStorage` 永久隐藏提示，关闭按钮继续显示

### Follow preference

1. 图片目标绑定时，在任务栏右上边缘显示独立跟随开关；开关开启时与关闭提示和关闭按钮并存
2. 开关关闭后只让任务栏回到底部，并隐藏关闭提示和关闭按钮，只保留跟随开关
3. 关闭状态继续保留目标缩略图、逐图草稿、提示词候选、模型参数、知识库引用和原图替换参数
4. 开关重新开启后，当前绑定任务栏立即恢复吸附并恢复原关闭提示和关闭按钮，无需重新选择图片
5. 开关值按浏览器 origin 写入小型 `localStorage` 布尔偏好；无历史值或值损坏时默认开启
6. 存储不可用时保持当前页面内状态，不中断目标绑定和生成

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
- 临时关闭状态只保存当前元素 ID；永久关闭只在对应图片元素保存一个布尔标记，不保存图片内容或无界 ID 列表
- `localStorage` 只保存有上限的小型点击计数和单个跟随偏好布尔值，不在视口事件或渲染期间重复写入
- 按图片草稿只保存在当前 React 会话，并在切换画板时清理，不新增持久化草稿或无界历史列表
- 原位更新元素，避免删除和重建造成布局变化
