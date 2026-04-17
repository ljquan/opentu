# Change: 为爆款音乐工具增加统一的续写与 Infill 动作

## Why

当前“爆款音乐工具”已经具备：

- 从零创作歌词
- 提交 Suno 音乐生成
- 轮询获取音乐生成结果

但还缺少两类核心后续编辑能力：

- 基于已生成片段继续续写
- 基于已生成片段对局部时间窗口进行 Infill

而且这些能力依赖一组强约束参数：

- `continue_clip_id`
- `continue_at`
- `infill_start_s`
- `infill_end_s`

如果只是把这些字段直接堆进现有“新生成”表单，会产生三个问题：

- 用户难以理解哪些参数在什么动作下必填
- UI 容易形成无效参数组合，例如普通生成时误填续写字段
- 续写依赖的 `clip_id` 与展示层 `id` 容易混淆，导致后续调用失败

因此需要在现有统一入口中，引入显式动作模型，并把参数约束、轮询回填和后续调用链打通。

## What Changes

- 在爆款音乐工具的统一入口下新增音乐动作选择：
  - 新生成
  - 续写
  - Infill
- 统一沿用现有 Suno `/suno/submit/music` + `/suno/fetch/{task_id}` 链路，不拆分成独立工具
- 为 `continue_clip_id / continue_at / infill_start_s / infill_end_s` 建立动作级参数约束与 UI 显隐规则
- 将轮询结果中的 `clip_id` 作为续写和 Infill 的真实目标 ID 持久化保存
- 在已生成片段区域增加“继续创作”入口，自动带入目标片段与默认参数
- 扩展音频请求模型与结果模型，使 unified 表单能安全表达新生成、续写、Infill 三类请求

## Impact

- Affected specs:
  - `audio-generation`
- Affected code:
  - `packages/drawnix/src/components/music-analyzer/pages/GeneratePage.tsx`
  - `packages/drawnix/src/components/music-analyzer/types.ts`
  - `packages/drawnix/src/components/music-analyzer/storage.ts`
  - `packages/drawnix/src/components/music-analyzer/task-sync.ts`
  - `packages/drawnix/src/services/audio-api-service.ts`
  - `packages/drawnix/src/services/model-adapters/types.ts`
  - `packages/drawnix/src/services/model-adapters/default-adapters.ts`
  - `packages/drawnix/src/services/task-queue-service.ts`
  - `packages/drawnix/src/mcp/tools/audio-generation.ts`
  - `packages/drawnix/src/utils/suno-model-aliases.ts`

