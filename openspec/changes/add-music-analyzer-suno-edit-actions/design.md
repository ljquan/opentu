## Context

当前音频生成链路已经支持：

- `music` 与 `lyrics` 两类 Suno 提交动作
- 统一通过 `/suno/submit/music` 或 `/suno/submit/lyrics` 提交
- 统一通过 `/suno/fetch/{task_id}` 轮询
- 将音乐结果标准化为 `primaryClipId / clipIds / clips`

同时，项目已有两个关键前提：

- 爆款音乐工具倾向使用统一工作流，而不是拆散成多个独立工具
- `clip_id` 才是 Suno 续写所需的真实片段标识，不能退化成列表层的 `id`

## Goals / Non-Goals

- Goals:
  - 在统一表单中支持新生成、续写、Infill 三类音乐动作
  - 根据动作自动约束和显隐 `continue_clip_id / continue_at / infill_start_s / infill_end_s`
  - 把轮询里发现的 `clip_id` 串到续写和 Infill 请求
  - 尽量复用现有 `/suno/submit/music` 与轮询标准化逻辑
- Non-Goals:
  - 本次不引入新的独立音乐编辑工具
  - 本次不实现 clip 拼接 `concat`
  - 本次不实现音频波形编辑器

## Decisions

- Decision: 统一入口 + 动作切换

  - 在 `GeneratePage` 中增加动作枚举，例如 `generate | continue | infill`
  - 表单仍保持单页结构，但根据动作切换展示不同字段

- Decision: 参数按动作严格约束

  - `generate`
    - 使用 `prompt / title / tags / mv`
    - 不发送 `continue_clip_id / continue_at / infill_start_s / infill_end_s`
  - `continue`
    - 必须有 `continue_clip_id`
    - 必须有 `continue_at`
    - 可继续使用 `prompt / title / tags / mv`
    - 不发送 `infill_start_s / infill_end_s`
  - `infill`
    - 必须有 `continue_clip_id`
    - 必须有 `continue_at`
    - 必须有 `infill_start_s / infill_end_s`
    - 要求 `infill_start_s < infill_end_s`

- Decision: 续写目标优先来自已生成片段

  - 每个 `GeneratedClip` 必须稳定保存轮询得到的真实 `clip_id`
  - 点击片段上的“续写 / Infill”入口时，自动把目标 `clip_id` 带入表单
  - 若当前任务还没有真实 `clip_id`，则禁止进入续写动作

- Decision: 仍走同一 Suno submit 接口

  - 三种动作都沿用 `POST /suno/submit/music`
  - 通过 body 中是否携带 `continue_clip_id / continue_at / infill_start_s / infill_end_s` 决定服务端行为

## Data Model

```ts
type SunoMusicEditAction = 'generate' | 'continue' | 'infill';

interface MusicAnalysisRecord {
  continueFromClipId?: string | null;
  continueAt?: number | null;
  infillStartS?: number | null;
  infillEndS?: number | null;
  musicEditAction?: SunoMusicEditAction | null;
}

interface AudioGenerationRequest {
  prompt: string;
  title?: string;
  tags?: string;
  mv?: string;
  continueClipId?: string;
  continueAt?: number;
  params?: {
    infillStartS?: number | null;
    infillEndS?: number | null;
  };
}
```

## UI Strategy

- 在“爆款音乐生成 -> 生成”页面增加动作切换区：
  - `新生成`
  - `续写`
  - `Infill`
- 在已生成片段卡片上增加快捷入口：
  - `续写`
  - `Infill`
- 字段展示策略：
  - `新生成`：标题 / 风格标签 / 歌词 / 版本 / 调用次数
  - `续写`：目标片段 / 续写起点秒数 / 标题 / 风格标签 / 歌词 / 版本 / 调用次数
  - `Infill`：目标片段 / 续写起点秒数 / Infill 开始秒数 / Infill 结束秒数 / 标题 / 风格标签 / 歌词 / 版本 / 调用次数
- 表单校验失败时，错误提示继续贴近提交按钮

## Risks / Trade-offs

- 风险：统一表单状态过多，切动作时容易串值
  - Mitigation：将动作相关字段单独建模，并在切换动作时只保留兼容字段

- 风险：用户不知道 `continue_at` 与 `infill_start_s/end_s` 的区别
  - Mitigation：UI 文案明确区分“续写起点”和“局部重绘窗口”

- 风险：早期轮询返回有 `clip_id`、最终结果缺 `clip_id`
  - Mitigation：在轮询层缓存并回填真实 `clip_id`

## Open Questions

- 是否需要在第一版允许手动输入 `continue_clip_id`，还是只允许从已生成片段选择
- 是否要在统一表单中直接支持“续写完成后自动拼接完整音频”，还是留到后续 `concat` 能力再做

