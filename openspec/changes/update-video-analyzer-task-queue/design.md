## Context

爆款视频生成工具当前是一个三步工作流：

- 第 1 步：分析视频，生成结构化 `analysis`
- 第 2 步：基于 `analysis` + `productInfo` 改编镜头脚本
- 第 3 步：根据镜头脚本生成首尾帧和视频

其中第 3 步已经广泛复用了现有任务队列，但第 1、2 步仍然是组件内直连异步调用。这样做的问题是：

- 没有统一任务态，用户看不到排队/处理中状态
- 页面刷新后分析/改编过程无法恢复
- 失败后没有任务级重试语义
- 历史记录只有“结果”，缺少“可恢复输入”

## Goals / Non-Goals

- Goals:
  - 让视频分析与脚本改编进入统一任务队列
  - 让分析结果和改编结果能在任务完成后稳定回写到 `AnalysisRecord`
  - 让历史记录可恢复 YouTube URL 与本地视频输入
- Non-Goals:
  - 不将本地视频上传到远端持久化
  - 不引入新的云存储或后端 API
  - 不重构现有视频生成素材链路

## Decisions

### Decision: 复用 `TaskType.CHAT`，通过任务元数据区分视频分析器内部动作

分析和脚本改编本质上都属于文本模型调用，不新增新的 `TaskType`，继续复用 `TaskType.CHAT`。

但普通聊天任务与视频分析器内部任务的行为不同，因此在任务参数中增加元数据，例如：

```ts
videoAnalyzerAction?: 'analyze' | 'rewrite'
videoAnalyzerRecordId?: string
videoAnalyzerSource?: 'upload' | 'youtube'
```

这样可以复用现有执行链，同时在 `AnalyzePage` / `ScriptPage` 监听任务完成事件，按动作类型回写对应记录。

### Decision: 视频分析继续使用专用 `video-analyze` 工具，而不是强行改造成普通 `generate_text`

视频分析依赖 `google.generateContent` 的视频输入能力，既支持 `inline_data`，也支持 `file_uri`。
普通 `generate_text` 目前只覆盖文本 + 图片输入，无法直接承载视频。

因此本变更中：

- `video-analyze` 增加 `queue` 模式
- 入队任务仍使用 `TaskType.CHAT`
- 执行时由任务执行器识别 `videoAnalyzerAction === 'analyze'` 并走专用视频分析链

### Decision: 历史输入源分成“轻来源”和“本地缓存来源”

为避免把大体积 base64 直接塞进记录：

- YouTube：持久化原始 URL
- 本地上传：把视频 `Blob` 缓存到本地缓存层，并在记录中仅保存缓存 key、文件名、MIME、大小

建议新增：

```ts
type AnalysisSourceSnapshot =
  | { type: 'youtube'; youtubeUrl: string }
  | {
      type: 'upload';
      cacheUrl: string;
      fileName: string;
      mimeType: string;
      size: number;
    };
```

分析页重新载入历史记录时：

- YouTube 直接回填输入框
- 本地上传通过缓存 URL 拉回 `Blob`，重建 `File`，恢复预览和重新分析能力

### Decision: 结果回写由页面监听任务事件完成，任务结果本身只存最小必要数据

为避免把完整 `analysis` 或完整镜头 JSON 既写入任务结果、又写入历史记录导致冗余过大：

- 任务结果可以保留结构化文本或最小 JSON
- 页面在收到完成事件后解析并回写 `AnalysisRecord`
- 本地视频的首尾帧缓存提取仍在分析结果落库后异步进行

## Risks / Trade-offs

- 本地视频缓存会占用浏览器本地存储空间
  - Mitigation: 只缓存原始视频引用所需数据，不额外复制多份；保留后续清理入口
- `TaskType.CHAT` 复用后，任务列表里会出现“分析视频”“改编脚本”这类文本任务
  - Mitigation: 通过任务标题/提示词前缀/元数据区分，确保用户能识别
- 页面刷新后如果缓存被浏览器清理，本地视频恢复可能失败
  - Mitigation: 降级为提示用户原视频不可恢复，但保留分析结果

## Migration Plan

1. 扩展 `AnalysisRecord` 的输入源快照结构
2. 为旧记录补兼容：YouTube 回退到 `sourceLabel`，上传记录视为“仅显示文件名，不可恢复视频”
3. 为 `video-analyze` 增加 queue 模式
4. 为脚本改编增加基于任务队列的执行入口
5. 在分析页/脚本页监听任务完成事件并回写记录

## Open Questions

- 任务列表是否需要为视频分析器内部任务显示更明确的标题文案
- 本地视频缓存是否需要在历史删除时同步清理源文件缓存
