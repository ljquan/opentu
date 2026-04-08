# Change: 增加 Suno 歌词任务与画布落地适配

## Why

当前仓库已经具备 Suno 音乐生成的基础闭环：

- `audio` 已经是一等生成模态
- Suno 音乐提交与轮询已经有专门的 adapter / service
- 任务队列、自动插入和画布音频节点都已经围绕“音频资产”建立了展示和落地路径

但 `suno lyrics` 会打破当前实现里的一个默认前提：

- 它沿用 Suno 的提交与查询链路
- 但最终产物不是音频 URL，而是 `title / tags / text` 形式的文本结果

如果继续沿用当前“`audio` 任务必然产出可播放 URL”的假设，就会出现三类问题：

- 提交层无法选择 `/suno/submit/lyrics`
- 结果提取层会因缺少 `audio_url` 而把任务判定为无结果
- 任务队列、自动插入和画布会把歌词结果错误地当成音频卡片处理

因此需要把 Suno 的“提交动作”和“最终结果类型”显式拆开，并把歌词任务融入现有队列与画布能力中。

## What Changes

- 在现有 `audio / suno` 路由体系内新增 `lyrics` 动作
- 让 Suno 请求显式区分：
  - 提交动作：`music` / `lyrics`
  - 结果类型：`audio` / `lyrics`
- 新增 `POST /suno/submit/lyrics` 提交适配，并继续复用 `/suno/fetch/{task_id}` 轮询
- 为歌词查询结果增加标准化提取，保留 `text / title / tags / providerTaskId`
- 调整任务结果模型与持久化结构，使文本歌词结果不再依赖媒体 URL
- 在任务队列中为歌词任务提供独立展示与操作，而不是复用音频卡片假设
- 在画布中将歌词结果插入为文本或 markdown 卡片，而不是音频节点
- 在音频输入模式中增加动作切换，并让音乐专属参数只在 `music` 动作下展示

## Scope

### In Scope

- `lyrics` 动作的 submit / fetch / normalize 闭环
- 继续复用现有 `audio` 默认路由，不新增独立的 `lyrics` 默认路由
- 新增 `sunoAction` 和歌词结果字段
- 任务队列中的歌词任务展示、重试、恢复和插入能力
- 画布文本插入路径对歌词结果的适配
- 自动插入路径根据结果类型在音频卡片与文本内容之间分流

### Out Of Scope

- 独立的歌词编辑器或画布内富文本歌词组件
- 一键把歌词任务自动串联成音乐生成任务
- `suno-tags`、`suno_act_tags`、`suno-midi` 等其他 Suno 辅助动作
- 为歌词结果新增独立的默认模型类型或独立的产品入口页

## Impact

- Affected specs:
  - `audio-generation`
  - `generation-task-queue`
  - `canvas-generated-text`
- Affected code:
  - `packages/drawnix/src/services/audio-api-service.ts`
  - `packages/drawnix/src/services/model-adapters/*`
  - `packages/drawnix/src/services/provider-routing/*`
  - `packages/drawnix/src/types/shared/core.types.ts`
  - `packages/drawnix/src/services/task-queue-service.ts`
  - `packages/drawnix/src/services/task-storage-reader.ts`
  - `packages/drawnix/src/services/media-executor/task-storage-writer.ts`
  - `packages/drawnix/src/components/ai-input-bar/*`
  - `packages/drawnix/src/components/task-queue/*`
  - `packages/drawnix/src/hooks/useAutoInsertToCanvas.ts`
  - `packages/drawnix/src/services/media-result-handler.ts`
  - `packages/drawnix/src/services/sw-capabilities/handler.ts`

## Relationship To Existing Changes

- 建立在 `add-audio-generation-suno-routing` 已定义的 `audio` 模态与 Suno 路由方案之上
- 与 `add-canvas-audio-playback` 互补：
  - 音乐结果继续进入音频节点
  - 歌词结果进入文本插入链路
- 本变更不会把歌词能力建成新的模态，而是在现有 `audio` 能力族中补齐新的动作和结果类型
