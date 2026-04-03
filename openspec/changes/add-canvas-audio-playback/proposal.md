# Change: 增加画布内音频播放闭环

## Why

当前仓库已经支持 Suno 音频生成、任务轮询、任务队列展示以及“插入到画布”的音频结果，但插入后的结果仍然是静态卡片：

- 画布上的音频元素本质上是带 `audioUrl` 的图片元素
- 用户无法在画布内直接播放、暂停或查看播放进度
- 当前双击行为只是打开外部音频地址，无法形成画布内的工作流闭环
- Stitch 中已经存在音频工作区设计参考，但生产代码还没有接入对应交互

这导致“音频作为一等画布资产”的体验在最后一步断开。

## What Changes

- 将当前 SVG 音频贴图替换为真正的画布音频组件节点
- 为画布音频节点增加本地播放/暂停能力、Stitch 对齐的播放态反馈，以及更克制的白板化视觉
- 增加全局唯一的音频播放状态，确保同一时间只有一个激活音源
- 约束音频节点的缩放行为，避免任意四向拉伸破坏组件比例和样式
- 让节点与顶部播放器隐藏技术性生成模型信息，只保留用户可理解的标题、状态和语义信息
- 增加顶部迷你播放器浮层，用于显示当前曲目、进度、切歌和音量控制
- 让当前播放中的音频节点在浏览器支持的情况下使用真实音频频谱驱动波形与律动反馈
- 将画布音频元素与已保留的 `providerTaskId / clipId` 元数据联动，为后续续写、重试和更多音频动作提供基础
- 为播放失败、音频地址失效等异常情况增加前端反馈

## Scope

### In Scope

- 画布音频组件节点插入、渲染和基础缩放
- 保持音频节点缩放时的整体比例和组件节奏
- 画布音频节点单击播放/暂停
- 顶部迷你播放器浮层的增强控制
- 单实例播放管理与激活态联动
- 基础播放进度展示、跳转、切歌和音量调节
- 基于 Web Audio 分析器的实时频谱可视化与软降级
- 任务队列、自动插入和画布元素之间的音频元数据贯通

### Out Of Scope

- 多轨混音或时间轴编辑
- 波形裁剪、片段拼接、infill 编辑器
- 完整的音频素材库管理与下载缓存体系重构
- 全量覆盖 Stitch 设计稿中的所有音频工作区交互

## Impact

- Affected specs:
  - `canvas-audio-playback`
- Affected code:
  - `packages/drawnix/src/data/audio.ts`
  - `packages/drawnix/src/drawnix.tsx`
  - `packages/drawnix/src/plugins/with-audio-node.ts`
  - `packages/drawnix/src/components/audio-node-element/*`
  - `packages/drawnix/src/services/*audio*`
  - `packages/drawnix/src/components/task-queue/*`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - `packages/drawnix/src/services/media-result-handler.ts`

## Relationship To Existing Changes

- 建立在 `add-audio-generation-suno-routing` 提供的音频生成与任务结果链路之上
- 参考 `add-stitch-design-workflow` 中已存在的 `audio-generation-workspace` 设计资产，但不会直接运行 Stitch 输出
