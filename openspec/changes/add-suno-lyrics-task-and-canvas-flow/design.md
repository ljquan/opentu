## Context

仓库当前已经为 Suno 音乐生成铺好了主路径：

- `runtime-model-discovery` 会把 `lyrics`、`music`、`suno` 等标识统归到 `audio`
- `provider-routing` 会为 Suno 推断 `tuzi.suno.music` 绑定
- `audio-api-service` 负责提交 `/suno/submit/music`、轮询 `/suno/fetch/{taskId}` 并提取音频 URL
- 任务队列、自动插入和任务面板会把 `TaskType.AUDIO` 默认当成“可播放音频资产”

这条链路在音乐生成场景下是成立的，但在歌词场景下不成立：

- 歌词任务仍然属于 Suno 的异步任务
- 但 fetch 结果里的核心字段是：
  - `data.data.text`
  - `data.data.title`
  - `data.data.tags`
- 没有 `audio_url`

因此，当前代码里“路由类型 = 结果类型 = 画布落地方式”的隐含绑定需要被拆开。

## Goals / Non-Goals

- Goals:
  - 在不新增独立模态的前提下支持 Suno `lyrics` 动作
  - 保持 `audio` 路由、默认预设和主入口不变
  - 显式区分 Suno 的提交动作和最终结果类型
  - 让歌词任务进入现有任务队列、恢复、重试和画布插入链路
  - 最大化复用现有文本插入能力，而不是新造歌词节点系统
- Non-Goals:
  - 不把歌词能力改造成独立 `lyrics` 模态
  - 不在本次中实现歌词编辑器、版本对比或歌词协作能力
  - 不覆盖所有 Suno 高级动作
  - 不重构整个任务系统为严格的 discriminated union 体系

## Decisions

- Decision: 歌词能力继续归属 `audio` 路由族

  - 预设配置仍然只维护 `audio` 路由
  - AI 输入栏也仍然通过 `音频` 模式进入
  - 通过 `sunoAction = 'music' | 'lyrics'` 区分当前执行动作

- Decision: 显式拆分“提交动作”和“结果类型”

  - `music` 与 `lyrics` 决定 submit path、请求字段和结果提取器
  - `resultKind` 决定任务队列展示和画布落地方式
  - `TaskType` 首批保持为 `AUDIO`，避免把歌词任务拆成新的队列大类

- Decision: `lyrics` 走独立 submit，但继续共用 fetch

  - `music -> POST /suno/submit/music`
  - `lyrics -> POST /suno/submit/lyrics`
  - 两者都通过 `GET /suno/fetch/{task_id}` 获取状态与结果

- Decision: 任务结果模型以增量字段扩展为主

  - 保持现有图片、视频、音频路径影响最小
  - 为任务结果新增：
    - `resultKind`
    - `lyricsText`
    - `lyricsTitle`
    - `lyricsTags`
  - `url` 对歌词结果不再视为必填

- Decision: 歌词落画布复用现有文本插入链

  - 任务面板点击“插入”时，把歌词结果格式化成 markdown / text 内容
  - 自动插入同样走文本插入能力
  - 不创建音频节点，也不伪造音频卡片

- Decision: UI 参数按动作分域

  - `music` 保留现有参数：
    - `mv`
    - `title`
    - `tags`
    - `continueSource`
    - `continueClipId`
    - `continueAt`
  - `lyrics` 只需要：
    - `prompt`
    - 可选的内部 `notifyHook`
  - 音乐专属参数在歌词动作下不显示、不提交

## Proposed Data Shape

```ts
type SunoAction = 'music' | 'lyrics';

type SunoResultKind = 'audio' | 'lyrics';

interface SunoGenerationRequest {
  prompt: string;
  model?: string;
  modelRef?: ModelRef | null;
  sunoAction?: SunoAction;
  notifyHook?: string;
  title?: string;
  tags?: string;
  mv?: string;
  continueClipId?: string;
  continueAt?: number;
  params?: Record<string, unknown>;
}

interface TaskResult {
  resultKind?: 'image' | 'video' | 'audio' | 'lyrics' | 'chat';
  url?: string;
  urls?: string[];
  format: string;
  size: number;
  title?: string;
  previewImageUrl?: string;
  providerTaskId?: string;
  primaryClipId?: string;
  clipIds?: string[];
  clips?: AudioClipResult[];
  lyricsText?: string;
  lyricsTitle?: string;
  lyricsTags?: string[];
}
```

## Provider Binding Direction

首批不建议为 `lyrics` 新增独立模态 binding，而是在现有 audio binding metadata 上增加动作表：

```ts
interface ProviderAudioBindingMetadata {
  defaultAction?: 'music';
  supportedActions?: Array<'music' | 'lyrics' | string>;
  actions?: Record<
    string,
    {
      submitPath: string;
      resultKind: 'audio' | 'lyrics';
      requestFields: string[];
    }
  >;
  versionField?: string;
  versionOptions?: string[];
  defaultVersion?: string;
  supportsContinuation?: boolean;
  supportsUploadContinuation?: boolean;
  supportsTags?: boolean;
  supportsTitle?: boolean;
}
```

对 Suno 的首批映射可收敛为：

```ts
{
  operation: 'audio',
  protocol: 'tuzi.suno.music',
  pollPathTemplate: '/suno/fetch/{taskId}',
  metadata: {
    audio: {
      defaultAction: 'music',
      supportedActions: ['music', 'lyrics'],
      actions: {
        music: {
          submitPath: '/suno/submit/music',
          resultKind: 'audio',
          requestFields: ['prompt', 'mv', 'title', 'tags', 'continue_clip_id', 'continue_at']
        },
        lyrics: {
          submitPath: '/suno/submit/lyrics',
          resultKind: 'lyrics',
          requestFields: ['prompt', 'notify_hook']
        }
      }
    }
  }
}
```

## Canvas Formatting Strategy

歌词插入画布时优先生成语义化文本，而不是直接丢一大段纯文本：

```md
# 战斗进行时

标签: EDM, 激烈的

[Chorus]
...
```

这样可以直接复用现有：

- markdown 解析为卡片
- 纯文本回退为文本元素

两条路径。

## Risks / Trade-offs

- 风险: `TaskType.AUDIO` 继续承载歌词任务会让部分旧代码仍然误判为音频资产
  - Mitigation: 统一改为优先判断 `result.resultKind`

- 风险: 把 `url` 改为非必填会触发较多类型修正
  - Mitigation: 先用增量字段方式扩展，聚焦实际消费点改造

- 风险: 任务队列过滤仍归入“音频”类，用户可能会觉得歌词不是音频
  - Mitigation: 在 item 级别增加明确的动作标签，如“歌词”

- 风险: 画布文本插入格式不稳定，影响可读性
  - Mitigation: 在服务层统一生成 markdown 模板，不把格式拼装分散到多个组件里

## Implementation Outline

1. 扩展 Suno 请求和 binding metadata，加入 `lyrics` 动作
2. 抽出共享 fetch 轮询与 action-specific 结果提取器
3. 扩展任务结果模型与 IndexedDB 读写结构
4. 让 AI 输入栏按动作切换参数面板
5. 让任务队列、恢复与重试按 `resultKind` 分支
6. 让手动插入与自动插入把歌词结果落到文本插入链路
