## Context

`opentu` 当前的生成体系围绕三类模态构建：

- `text`
- `image`
- `video`

这三个模态已经贯穿以下层级：

- `model-config` 中的静态模型类型
- `settings-manager` 中的默认路由 preset
- `provider-routing` 中的 operation 与 binding
- `model-adapters` 中的适配器接口
- `task-queue` 与历史记录中的任务类型与结果结构
- `AIInputBar` 与设置页中的模型/模式切换

因此“增加音频层”并不是简单地再加一个 UI 选项，而是需要把音频模态接入整条调用链。

Suno 的特殊点在于，它暴露的是一组能力动作，而不是一组可以直接照抄提交的模型：

- 发现能力示例：
  - `suno_music`
  - `suno-continue`
  - `suno-continue-uploaded`
  - `suno-remix`
  - `suno-remix-uploaded`
  - `suno-infill`
  - `suno-lyrics`
  - `suno-tags`
  - `suno_act_tags`
  - `suno_act_timing`
- 真实音乐生成提交接口：
  - `POST /suno/submit/music`
- 真实版本切换字段：
  - `mv`
- 真实状态查询接口：
  - `GET /suno/fetch/{task_id}`

因此，如果把 `suno_music` 这类标识直接当成“可调用模型 ID”，最终会出现两个问题：

1. UI 上看到的能力动作和请求里真正需要的 `mv`、续写参数混在一起
2. 运行时发现层与执行层之间失去稳定映射

## Goals / Non-Goals

- Goals:
  - 为 `opentu` 增加一等音频生成模态
  - 为 Suno 建立“能力动作 -> 执行规则 -> 版本参数”的明确映射
  - 复用现有多供应商路由和任务轮询思路，而不是单独再造一套音频系统
  - 先跑通音乐生成和单任务查询闭环
- Non-Goals:
  - 本次不一次性覆盖 Suno 全量能力
  - 本次不实现完整的画布音频后处理编辑器
  - 本次不让发现到的所有 Suno 能力都自动出现在 UI 主路径中

## Decisions

- Decision: 引入 `audio` 作为一等模态

  - `ModelType`、`GenerationType`、`TaskType`、`ProviderOperation`、默认 preset 都增加 `audio`
  - 音频不再借用文本或视频通道透传

- Decision: 区分“能力动作”和“执行版本”

  - `suno_music`、`suno-continue` 等发现项表示能力或操作入口
  - `mv` 表示真实执行使用的 Suno 版本，例如 `chirp-v3-0`、`chirp-v3-5`
  - 续写上传场景通过 `mv + '-upload'` 表达

- Decision: Suno 初始切片只做 `music submit + fetch`

  - 首批只支持 `POST /suno/submit/music`
  - 首批只支持 `GET /suno/fetch/{task_id}`
  - 其余 Suno 动作先作为已发现但未激活的能力保留在元数据层

- Decision: UI 不直接展示所有发现能力

  - 用户主路径先暴露统一的 `音频` 模式
  - 进入音频模式后，再根据绑定能力展示当前支持的生成方式和字段
  - 避免让用户直接面对一串 `suno-*` 能力代号

- Decision: 任务轮询采用 provider-specific 标准化

  - `/suno/fetch/{task_id}` 返回的 `status/progress/data` 需要统一转换成内部任务状态
  - 不能强制复用视频任务的原始响应结构

## Proposed Data Model

```ts
type ModelType = 'text' | 'image' | 'video' | 'audio';

type SunoAction =
  | 'music'
  | 'continue'
  | 'continue-uploaded'
  | 'lyrics'
  | 'tags'
  | 'remix'
  | 'remix-uploaded'
  | 'infill'
  | 'infill-uploaded';

interface ProviderAudioBindingMetadata {
  action: SunoAction | string;
  versionField?: string;
  versionOptions?: string[];
  defaultVersion?: string;
  supportsContinuation?: boolean;
  supportsUploadContinuation?: boolean;
  supportsLyricsPrompt?: boolean;
  supportsTags?: boolean;
  supportsTitle?: boolean;
  taskIdField?: string;
  resultAudioUrlPath?: string;
}

interface AudioGenerationRequest {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  title?: string;
  tags?: string;
  mv?: string;
  continueClipId?: string;
  continueAt?: number;
  params?: Record<string, unknown>;
}

interface AudioGenerationResult {
  url: string;
  title?: string;
  duration?: number | null;
  waveformUrl?: string;
  raw?: unknown;
}
```

## Suno Binding Strategy

### Capability Layer

发现层保留原始能力标识，例如：

- `suno_music`
- `suno-continue`
- `suno-continue-uploaded`
- `suno-lyrics`
- `suno-tags`

这些标识用于：

- 推断该 profile 是否支持音频
- 推断该 profile 支持哪些音频动作
- 决定 UI 允许展示哪些高级入口

### Execution Layer

执行层不直接按发现能力 ID 发请求，而是映射成：

- `submitPath`
- `pollPathTemplate`
- `action`
- `mv` 规则
- 字段可用性

例如首批音乐生成统一映射为：

```ts
{
  operation: 'audio',
  protocol: 'tuzi.suno.music',
  submitPath: '/suno/submit/music',
  pollPathTemplate: '/suno/fetch/{task_id}',
  metadata: {
    audio: {
      action: 'music',
      versionField: 'mv',
      versionOptions: ['chirp-v3-0', 'chirp-v3-5'],
      defaultVersion: 'chirp-v3-5',
      supportsContinuation: true,
      supportsUploadContinuation: true,
      supportsTags: true,
      supportsTitle: true,
      supportsLyricsPrompt: true
    }
  }
}
```

当用户选择“续写已上传音频”时，不改 submitPath，而是通过 metadata 规则把：

- `mv=chirp-v3-5`

转换为：

- `mv=chirp-v3-5-upload`

## UI Strategy

### Settings

- 在默认路由 preset 中增加 `audio`
- 音频默认路由保存 `ModelRef`
- 如果当前 provider profile 未发现音频能力，则不允许被选为音频默认路由

### AI Input Bar

- 增加 `音频` 模式
- 进入音频模式后，参数区支持：
  - `mv`
  - `title`
  - `tags`
  - `continue_clip_id`
  - `continue_at`
- 默认交互仍保持与图片/视频一致：
  - 选择模型
  - 输入提示词
  - 提交任务

### Task And History

- 任务类型增加 `audio`
- 历史记录支持展示音频结果
- 结果结构至少包含：
  - 音频 URL
  - 标题
  - 创建时间
  - 执行状态

## Migration Plan

1. 先补核心类型层和 preset 路由层的 `audio`
2. 再补 provider routing / adapter / service 的 Suno 音频闭环
3. 再补 AI 输入栏和设置页入口
4. 最后补任务列表、历史记录和结果回显

## Risks / Trade-offs

- 风险: 音频能力切入口过大，影响现有图片/视频链路
  - Mitigation: 首批只做 `music submit + fetch`，不扩张到所有 Suno 动作

- 风险: 发现能力与执行规则混在一起，导致后续高级动作难扩展
  - Mitigation: 明确拆分 capability layer 和 execution layer

- 风险: UI 直接暴露 `suno-*` 原始能力名，增加理解成本
  - Mitigation: 主路径只暴露 `音频` 模式和人类可理解的操作标签

- 风险: 音频结果结构与视频结果结构不同，历史记录复用成本高
  - Mitigation: 在 `TaskResult` 中增加音频最小字段集，而不是强行套用视频字段

## Open Questions

- 首批是否需要同时支持“仅生成纯音乐”和“包含人声/歌词”的 UI 开关
- `suno_lyrics`、`suno_tags` 是否应该作为后续独立工具，还是继续作为音乐生成前的辅助步骤
- 音频结果进入画布后，第一版是否只作为可播放资源卡片，而不引入完整音频节点编辑器
