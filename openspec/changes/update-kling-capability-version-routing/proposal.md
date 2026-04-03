# Change: 调整 Kling 视频能力路由为“能力模型 + 执行版本”

## Why

当前 Kling 标准视频链路和 Suno 已经采用的“能力入口 / 执行版本”模式不一致：

- 运行时发现更接近能力标识，例如 `kling_video`
- 实际提交接口要求通过请求体 `model_name` 传入执行版本
- Kling 标准视频仍需要按 action 建模版本合法性，即使当前 `text2video` 与 `image2video` 已共享同一组主版本
- 当前实现仍主要把 `kling-v1-6` 这类版本字符串当作直接调用模型，导致发现层、路由层和执行层的语义混在一起

这会带来几个具体问题：

- 发现到 `kling_video` 时，运行时无法稳定映射到正确的执行版本
- `text2video` 与 `image2video` 的版本约束只能散落在 adapter 条件分支中
- 老的版本型模型 ID 与新的能力型模型 ID 并存时，默认路由和参数表单容易失真
- `kling-video-o1`、`kling-video-o1-edit` 这类特例模型与标准 Kling 视频能力共用识别规则，后续扩展风险高

## What Changes

- 将标准 Kling 视频能力明确建模为能力模型 `kling_video`
- 将真正执行版本明确建模为请求字段 `model_name`
- 为标准 Kling 视频 binding 增加版本字段元数据，包括：
  - `versionField`
  - `defaultVersion`
  - `versionOptions`
  - `versionOptionsByAction`
- 保留 `text2video / image2video` 的 action 分流，但把版本合法性和默认值绑定到 action
- 保持对历史版本型模型 ID 的兼容，例如：
  - `kling-v1-5`
  - `kling-v1-6`
- 显式将 `kling-video-o1` 与 `kling-video-o1-edit` 排除在标准 Kling 视频能力路由之外

## Scope

### In Scope

- 标准 Kling 视频能力 `kling_video` 的路由与执行建模
- `model_name` 版本参数的运行时解析与默认值策略
- `text2video` 与 `image2video` 的版本约束建模
- 旧版本型模型 ID 到新能力型路由的兼容策略
- 最小必要的参数暴露，用于选择标准 Kling 执行版本

### Out Of Scope

- 本次不接入 `kling_effects`
- 本次不接入 `kling_extend`
- 本次不接入 `kling_lip_sync`
- 本次不接入 `kling_virtual_try_on`
- 本次不将 `kling-video-o1` 与 `kling-video-o1-edit` 迁入这套标准 Kling 视频能力模型
- 本次不一次性为 Kling 全量高级字段设计完整可视化表单，例如复杂 `camera_control` 编辑器

## Impact

- Affected specs:
  - `provider-protocol-routing`
- Affected code:
  - `packages/drawnix/src/services/provider-routing/*`
  - `packages/drawnix/src/services/model-adapters/kling-adapter.ts`
  - `packages/drawnix/src/services/model-adapters/registry.ts`
  - `packages/drawnix/src/services/video-binding-utils.ts`
  - `packages/drawnix/src/constants/model-config.ts`
  - `packages/drawnix/src/constants/video-model-config.ts`
  - `packages/drawnix/src/components/ttd-dialog/ai-video-generation.tsx`
  - `packages/drawnix/src/components/ai-input-bar/*`

## Relationship To Existing Changes

- 本变更建立在 `add-provider-protocol-routing` 的协议绑定架构之上
- 本变更复用 `add-audio-generation-suno-routing` 已采用的“能力标识不等于执行版本”设计原则
- 本变更不改变标准 Kling 接口的 submit / poll URL，而是调整运行时如何解释能力模型与版本字段
