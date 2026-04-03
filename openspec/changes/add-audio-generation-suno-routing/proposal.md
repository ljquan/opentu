# Change: 增加音频生成模态与 Suno 动作路由适配

## Why

当前 `opentu` 的生成链路默认只支持 `text / image / video` 三类模态：

- AI 输入栏只能切换图片、视频和 Agent
- 默认模型预设只维护文本、图片、视频三条路由
- 任务队列、适配器、历史记录和自动插入逻辑都假设生成结果是图片或视频

这使得“音频生成”无法作为一等能力进入现有架构。

同时，Suno 供应商的调用模式与当前的多供应商模型路由假设存在关键差异：

- 运行时发现到的 `suno_music`、`suno-continue`、`suno-remix`、`suno_lyrics` 等标识，更像“能力动作”而不是可以直接提交调用的裸模型
- 真正的音乐生成接口通过 `/suno/submit/music` 提交
- 实际版本选择通过请求体中的 `mv` 决定，例如 `chirp-v3-0`、`chirp-v3-5`，以及续写上传音频时的 `-upload` 变体
- 任务状态查询通过 `/suno/fetch/{task_id}` 完成，而不是沿用图片/视频侧已有的统一轮询约定

如果继续沿用“发现模型 ID -> 直接提交调用”的现有假设，音频能力会在路由层、适配层和 UI 层同时失真。

## What Changes

- 引入一等 `audio` 模态，贯穿模型类型、默认路由、任务队列、结果结构和历史记录
- 为 Suno 引入“能力动作”和“执行版本”分离的绑定模型
- 新增音频生成服务与轮询链路，首批支持 `POST /suno/submit/music` 与 `GET /suno/fetch/{task_id}`
- 在设置页、AI 输入栏和任务/历史 UI 中增加音频入口与基础参数配置
- 允许将已发现的 Suno 能力集合映射为 UI 可用的音频操作，而不是把每个能力 ID 暴露成一个可直接执行的模型

## Scope

### In Scope

- 增加 `audio` 模态
- 首批支持 Suno 音乐生成提交与单任务轮询
- 首批适配 `mv` 版本选择
- 首批适配音乐生成的核心字段：
  - `prompt`
  - `tags`
  - `title`
  - `mv`
  - `continue_clip_id`
  - `continue_at`
- 在 UI 中增加音频生成模式和对应的基础参数表单

### Out Of Scope

- 本次不实现 Suno 全量高级动作的完整执行链路，例如：
  - `suno-remix`
  - `suno-infill`
  - `suno-overpainting`
  - `suno-midi`
  - `suno-all-stems`
  - `suno-vocal-stems`
- 本次不实现完整的画布音频节点编辑器
- 本次不实现音频波形剪辑、片段拼接或多轨混音

## Impact

- Affected specs:
  - `audio-generation`
- Affected code:
  - `packages/drawnix/src/constants/model-config.ts`
  - `packages/drawnix/src/utils/settings-manager.ts`
  - `packages/drawnix/src/utils/ai-input-parser.ts`
  - `packages/drawnix/src/services/provider-routing/*`
  - `packages/drawnix/src/services/model-adapters/*`
  - `packages/drawnix/src/services/task-queue*`
  - `packages/drawnix/src/components/ai-input-bar/*`
  - `packages/drawnix/src/components/settings-dialog/*`
  - `packages/drawnix/src/components/task-queue/*`
  - `packages/drawnix/src/components/generation-history/*`

## Relationship To Existing Changes

- 本变更建立在 `add-multi-provider-profiles`、`add-runtime-model-discovery` 与 `add-provider-protocol-routing` 的多供应商基础之上
- 本变更不会推翻现有协议路由架构，而是补足新的 `audio` 模态和 Suno 的动作路由规则
- 本变更会首次把“能力标识不等于直接执行版本”明确建模到运行时绑定中
