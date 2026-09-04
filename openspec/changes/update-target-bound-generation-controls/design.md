# Design: 跨媒体目标绑定生成控制

## Context

现有图片目标链路已有三块基础：

- `image-generation-anchor` 表示提交后到插入前的画布占位和进度
- 图片插入时会把 `metadata.prompt` 写入 `aiPrompt/generationPrompt`
- `AI_INPUT_PREFILL_EVENT` 能从历史任务回填到底部输入栏

视频、音频和文本生成结果使用不同的画布元素结构，但都能通过 `generationPrompt`、`aiPrompt` 和 `generationTaskId` 保存相同的轻量来源信息。缺口是目标解析和任务栏交互仍偏向图片，无法一致表达“恢复这个生成目标的提示词，并在 follow 提交后以同类型结果替换它”。

## Goals

- 图片、视频、音频和文本生成结果使用一致的虚化提示词交互
- 用户单选生成目标后，任务栏切换到对应生成类型并恢复独立草稿
- follow 模式使用同类型生成结果原位替换目标，而不是新增孤立元素
- 图片、视频和文本复用任务栏跟随、临时关闭和永久关闭交互
- 参考/上下文模式保留目标内容作为生成输入，但不再原位替换
- 复用现有任务队列和各媒体生成 API，不引入新 provider 调用方式
- 保持目标绑定内存占用可控，不复制媒体二进制，只传 URL、文本引用和轻量元数据

## Non-Goals

- 第一阶段不把完整任务详情塞进画布元素
- 不复用 `retryTask` 来承载改 prompt，因为 retry 语义是重跑同参数
- 不为普通手写文本或手动导入媒体推断生成提示词
- 不为音频新增参考输入、跟随关闭菜单或持久化 reference-only 语义
- 不重构外部 iframe 工具的结果回传协议

## Data Model

新增轻量关联字段，优先存 ID 和 prompt，不存大媒体内容：

- anchor:
  - `prompt`
  - `resultElementId`
  - `targetElementId`
  - `sourceTaskId`
  - `latestTaskId`
- task params:
  - `anchorId`
  - `targetElementId`
  - `replaceElementId`
  - `sourceTaskId`
- generated canvas element metadata:
  - 图片继续兼容 `generationPrompt/aiPrompt/prompt`
  - 视频、音频和文本使用 `generationPrompt/aiPrompt`
  - 使用 `generationTaskId` 精确回查任务；图片额外保留 `generationAnchorId`
  - 图片、视频和文本可复用轻量 `referenceOnly` 标记表达永久参考/上下文模式

## Flow

### Initial generation

1. 用户从底部输入栏或 AI 图片入口提交图片生成
2. 系统创建 anchor，写入 prompt 和 workflow/task 绑定
3. 任务完成后，自动插入图片
4. 插入服务把 `prompt/taskId/anchorId` 写入图片元素
5. anchor 记录 `resultElementId` 后淡出或保留为可恢复引用

### Resolve a generated target

1. 用户单选图片、视频、音频或文本画布元素
2. 系统先读取元素上的生成提示词；缺失时仅通过明确的 `generationTaskId` 点查任务
3. 图片可继续使用 anchor 和结果 URL 的历史兼容路径，非图片目标不扫描正文、URL 或无关任务历史
4. 仅当非图片目标恢复到非空提示词时才进入目标绑定，普通内容继续走既有选区流程
5. 任务栏切换到目标的生成类型，并把提示词显示为一次性虚化建议

### Submit from a bound target

1. 用户按空格/回车采纳旧提示词，或直接输入新 prompt
2. follow 模式提交同类型任务，并携带 `replaceElementId/sourcePrompt`
3. 单结果任务成功后，系统只更新绑定元素的内容和生成元数据，保留几何与 selection
4. 失败时保留原目标，并在任务栏或既有反馈层提供错误与恢复入口
5. 图片、视频或文本进入 reference 模式后，不再携带替换参数；目标内容分别进入图片、视频或文本上下文
6. 音频只使用 follow 模式，不宣称或构造音频参考输入
7. 任务栏目标提交使用轻量 `boundTargetFollowControlled` 标记区分其他显式替换入口；结果插入前再次读取永久跟随开关，关闭时只移除本次插入视图中的替换绑定，持久任务本身保持不变
8. 图片结果降级为独立插入后，anchor 清除旧 `targetElementId` 并绑定新 `resultElementId`，防止异步同步恢复旧目标

## UI

- 复用现有底部 AI 任务栏，不新增第二套目标旁控制条
- 选中生成目标时，任务栏使用既有目标定位逻辑；图片、视频和文本可通过开关回到底部并再次恢复跟随
- 未绑定目标时，任务栏恢复底部固定位置
- 任务栏不显示完整任务历史；旧 prompt 仅作为带键盘提示的一次性虚化建议，采纳后才成为真实输入
- 用户直接输入或点击任务栏其他按钮时，旧 prompt 建议立即消失且不自动恢复
- 图片和视频关闭目标替换后显示对应“参考图/参考视频”文案，文本显示“上下文”文案
- 音频不显示“只作参考”或永久关闭方式菜单，避免暗示生成链路支持音频参考输入
- 多图批量生成第一阶段按单张图片独立绑定；每张图修改只替换自身

## Safety And Performance

- 不把 Blob、base64 或完整任务历史写入画布元素、anchor 或任务绑定字段
- 非图片目标通过 task ID 点查提示词，不在高频选区刷新中扫描任务历史
- 目标状态键包含媒体类型，避免元素类型变化复用旧草稿或取消状态
- 替换目标时保留元素几何和 selection；文本自动尺寸变化后仅触发必要的选区刷新
- 新任务使用现有队列并发控制，不绕过任务队列
- 任务清理后，元素上的 prompt 和轻量元数据仍可支撑基本编辑
- 永久开关仅影响带任务栏来源标记的图片、视频和文本替换任务，不影响 PPT、弹窗或其他显式替换入口

## Open Questions

- 工具箱外部 iframe 工具无法读取本地任务队列，是否只提供回填入口而不做目标绑定？
