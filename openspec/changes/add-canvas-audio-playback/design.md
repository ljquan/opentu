## Context

仓库当前已经具备以下音频相关能力：

- `audio-api-service` 能提交、轮询并提取音频生成结果
- 任务队列可以展示音频任务，并把结果插入画布
- `data/audio.ts` 会把音频包装成 SVG 卡片并作为图片元素插入

但播放行为仍缺失：

- 画布内没有统一的 `HTMLAudioElement` 或播放状态容器
- 音频卡片仅保存 `audioUrl` 和少量展示元数据
- 双击音频元素只会 `window.open(audioUrl)`

同时，`.stitch/screens.json` 中已经存在 `audio-generation-workspace` 参考，明确包含：

- 画布音频节点
- 顶部迷你播放器浮层
- 激活节点的播放态

因此本次设计目标不是重新定义音频工作区，而是把已有生成链和已有设计参考连接成最小可用闭环。

## Goals / Non-Goals

- Goals:
  - 让画布中的音频组件节点能直接播放和暂停
  - 用一套全局播放状态驱动画布节点动画、节点激活态与顶部浮层
  - 让音频节点与顶部浮层更贴近 Stitch 参考中的轻量 HUD 方案
  - 避免音频节点在缩放时出现任意方向拉伸导致的样式变形
  - 保持实现范围足够小，不引入完整 DAW 或时间轴系统
- Non-Goals:
  - 不实现音频编辑器、波形剪辑器、多轨混音
  - 不在本次中重构媒体库为完整音频库
  - 不直接把 Stitch HTML 当作运行时代码

## Decisions

- Decision: 使用单一全局音频控制器

  - 通过一个共享的播放服务或 store 管理当前 `audio element`
  - 同一时间只允许一个音频源处于播放状态
  - 所有 UI 只订阅共享状态，不各自创建独立播放器

- Decision: 将音频结果升级为专用 Plait 音频节点

  - 新增 `audio-node` 元素类型，复用 `Card` / `WorkZone` 的 `foreignObject + React` 渲染模式
  - 节点自身承载音频标题、封面、波形律动、播放态和进度反馈
  - 保留旧 SVG 音频贴图的兼容识别，但新插入路径统一走 `audio-node`

- Decision: 节点内交互优先采用“组件自渲染 + 全局播放器协同”

  - 节点本身显示播放按钮、进度和律动反馈
  - 顶部浮层是当前播放节点的全局回声，不重复承担全部主交互
  - 共享播放服务负责同步节点状态、顶部浮层与错误处理

- Decision: 音频节点保持比例缩放，避免自由拉伸

  - 参考 Stitch 里的固定比例音频卡片，而不是通用白板矩形
  - 音频节点允许放大和缩小，但缩放过程需保持既定宽高比
  - 不暴露会导致封面、波形和时间布局变形的自由四向拉伸体验

- Decision: 节点与浮层默认隐藏技术型模型信息

  - `providerTaskId / clipId / clipIds / modelVersion` 继续作为内部元数据保留
  - 画布节点和顶部浮层优先展示标题、时长、播放状态和语义信息
  - 不在主视觉中突出 `chirp-v3` 或 clip 片段主键等技术字段

- Decision: 顶部浮层是全局播放回声，不是主编辑面板

  - 节点是播放源
  - 顶部浮层显示当前曲目、进度、切歌和音量控制
  - 浮层应避开底部 AI 栏、右侧抽屉和顶部工具区

- Decision: 切歌能力以当前画布中的音频节点队列为基础

  - 共享播放服务维护一个按画布顺序同步的临时播放队列
  - 顶部浮层的上一首 / 下一首使用这条队列
  - 队列只服务当前画布上下文，不升级为跨项目媒体库

- Decision: 异常情况优先采用软失败

  - 如果音频 URL 无法播放，保留卡片本身
  - 播放失败时给出用户提示，并退出当前播放态
  - 不因播放失败破坏已插入的画布资产

- Decision: 在支持的浏览器中使用 Web Audio 频谱分析驱动节点律动

  - 通过 `AudioContext + MediaElementAudioSourceNode + AnalyserNode` 从当前播放音源提取实时频谱
  - 播放服务输出固定数量的 band 数据和低频脉冲强度，供当前激活节点消费
  - 分析链应节流更新，避免把高频频谱刷新传播成整张画布的重渲染
  - 如果浏览器或跨域策略不允许频谱分析，节点回退到当前静态/伪随机波形，不阻断播放

## Proposed Runtime Shape

```ts
interface CanvasAudioPlaybackState {
  activeElementId?: string;
  activeAudioUrl?: string;
  activeTitle?: string;
  activeClipId?: string;
  activePreviewImageUrl?: string;
  queue: CanvasAudioPlaybackSource[];
  activeQueueIndex: number;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  spectrumLevels: number[];
  pulseLevel: number;
  error?: string;
}
```

## Implementation Outline

1. 新增共享音频播放状态与控制器
2. 新增 `audio-node` 元素类型、渲染组件和缩放插件
3. 将音频插入链从图片元素切换为 `audio-node`
4. 将音频节点与顶部浮层收敛到 Stitch 对齐的视觉语言
5. 为共享播放服务补齐队列、上一首 / 下一首和音量状态
6. 为当前激活节点补齐实时频谱与低频脉冲
7. 为任务队列与自动插入链保持 clip 元数据透传

## Risks / Trade-offs

- 风险: 播放逻辑散落在画布、任务队列和浮层之间
  - Mitigation: 统一走单个播放控制器

- 风险: 组件化节点与画布命中/拖拽交互冲突
  - Mitigation: 节点交互尽量走受控按钮与事件透传，避免阻断普通选中与移动

- 风险: 远程音频 URL 失效导致卡片可见但无法播放
  - Mitigation: 本次先做错误提示与退化行为，后续再考虑音频缓存

- 风险: 画布点击交互与现有双击逻辑冲突
  - Mitigation: 单击处理播放，移除或弱化双击外跳逻辑
