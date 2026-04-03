## Context

当前标准 Kling 视频接口具有两个明显特征：

- 提交动作分为：
  - `POST /kling/v1/videos/text2video`
  - `POST /kling/v1/videos/image2video`
- 真正执行版本通过请求体 `model_name` 指定，而不是通过发现到的能力 ID 直接调用

同时，运行时发现已经能够识别出能力型视频标识，例如：

- `kling_video`
- `kling_image`
- `kling_effects`
- `kling_extend`
- `kling_lip_sync`
- `kling_virtual_try_on`

这说明 Kling 与 Suno 有相似的结构特征：

- 发现层暴露的是能力入口
- 执行层需要额外版本字段

但当前标准 Kling adapter 仍然主要围绕版本型模型 ID 运转，例如 `kling-v1-6`。这让以下几层出现语义错位：

1. discovery 发现的是能力
2. selector 选中的可能是能力
3. adapter 执行时却把 `model` 理解为可直接提交的执行版本

此外，标准 Kling 视频与 `kling-video-o1`、`kling-video-o1-edit` 不是同一条协议语义：

- 标准 Kling 视频走 `/kling/v1/videos/{action}`
- `o1` 系列是另一类特例模型，不应被标准 Kling 能力路由误吞

## Goals / Non-Goals

- Goals:
  - 让标准 Kling 视频沿用 Suno 式“能力入口 + 执行版本”模式
  - 让 `kling_video` 成为标准 Kling 视频的一等能力模型
  - 让 `model_name` 成为标准 Kling 视频的执行版本字段
  - 让 `text2video / image2video` 的版本限制显式建模
  - 保持旧版本型模型 ID 的兼容，避免历史任务和用户设置立刻失效
- Non-Goals:
  - 本次不抽象所有 Kling 能力为统一多动作产品面板
  - 本次不处理 `o1` 系列的专用协议
  - 本次不一次性把所有 Kling 高级字段做成复杂 UI 控件

## Decisions

- Decision: 区分标准 Kling 能力模型和执行版本

  - `kling_video` 表示标准 Kling 视频能力入口
  - `model_name` 表示具体执行版本，例如 `kling-v3`
  - 发现层与选择层优先使用 `kling_video`
  - 执行层始终向标准接口提交 `model_name`

- Decision: action 继续由请求语义决定，而不是再拆成两个能力模型

  - 显式传入 `klingAction2` 时优先使用
  - 否则：
    - 有参考图 => `image2video`
    - 无参考图 => `text2video`

- Decision: 版本合法性绑定到 action

  - `text2video` 的可选版本：
    - `kling-v3`
    - `kling-v2-6`
    - `kling-v2-1`
    - `kling-v1-6`
    - `kling-v1-5`
  - `image2video` 的可选版本：
    - `kling-v3`
    - `kling-v2-6`
    - `kling-v2-1`
    - `kling-v1-6`
    - `kling-v1-5`

- Decision: 历史版本型模型 ID 作为兼容输入，而不是主路径

  - 若请求模型为 `kling-v1-5` 或 `kling-v1-6`
  - 运行时仍允许提交
  - 但内部按“标准 Kling 能力 + 指定 model_name”解释

- Decision: `o1` 系列与标准 Kling 视频能力显式隔离

  - `kling-video-o1`
  - `kling-video-o1-edit`
  - 不参与标准 `kling.video` binding 推断
  - 不复用 `/kling/v1/videos/{action}` 的标准版本校验

- Decision: UI 先暴露最小必要版本选择

  - 第一阶段保证用户可以为标准 Kling 能力选择：
    - `model_name`
    - `klingAction2`
    - `mode`
    - `cfg_scale`
    - `negative_prompt`
  - `camera_control` 通过平铺字段纳入参数体系：
    - `camera_control_type`
    - `camera_horizontal / vertical / pan / tilt / roll / zoom`
  - `image_tail` 与 `callback_url` 暂不纳入本阶段可视化参数体系

- Decision: Kling 数值参数同时在 UI 元数据和 adapter 层校验

  - `cfg_scale` 取值范围固定为 `[0, 1]`
  - `camera_control` 的六个数值字段固定为 `[-10, 10]` 且必须是整数
  - 参数面板与 MCP schema 暴露相同的边界信息
  - adapter 仍负责最终校验，避免 workflow / MCP 直接绕过 UI

## Proposed Data Model

```ts
interface ProviderVideoBindingMetadata {
  allowedDurations?: string[];
  defaultDuration?: string;
  durationMode?: 'request-param' | 'model-alias';
  durationField?: string;
  durationToModelMap?: Record<string, string>;
  strictDurationValidation?: boolean;
  resultMode?: 'inline-url' | 'download-content';
  downloadPathTemplate?: string;

  versionField?: string;
  versionOptions?: string[];
  defaultVersion?: string;
  versionOptionsByAction?: Record<string, string[]>;
}

interface KlingResolvedRequest {
  action: 'text2video' | 'image2video';
  modelName: string;
}
```

标准 Kling 视频 binding 期望类似：

```ts
{
  operation: 'video',
  protocol: 'kling.video',
  requestSchema: 'kling.video.auto-action-json',
  submitPath: '/kling/v1/videos/{action}',
  pollPathTemplate: '/kling/v1/videos/{action}/{taskId}',
  metadata: {
    video: {
      versionField: 'model_name',
      defaultVersion: 'kling-v1-6',
      versionOptions: [
        'kling-v3',
        'kling-v2-6',
        'kling-v2-1',
        'kling-v1-6',
        'kling-v1-5'
      ],
      versionOptionsByAction: {
        text2video: ['kling-v3', 'kling-v2-6', 'kling-v2-1', 'kling-v1-6', 'kling-v1-5'],
        image2video: ['kling-v3', 'kling-v2-6', 'kling-v2-1', 'kling-v1-6', 'kling-v1-5']
      }
    }
  }
}
```

## Execution Flow

1. 发现层识别到 `kling_video`
2. 选择器保留 `profileId::kling_video`
3. 运行时 planner 解析到标准 Kling 视频 binding
4. adapter 根据请求判断 action：
   - `text2video`
   - `image2video`
5. adapter 从以下来源解析执行版本：
   - `params.model_name`
   - binding `defaultVersion`
   - 历史兼容的 `request.model === kling-v*`
6. adapter 按 action 校验版本是否允许
7. adapter 构造标准 Kling 请求体并提交

## Compatibility Strategy

### Discovery / Selection

- 新发现到的 `kling_video` 应作为标准主路径能力模型
- 老的静态版本型模型可以继续存在，但不再作为未来扩展的主心智

### Runtime

- 当请求模型是 `kling_video` 时：
  - 必须解析 `model_name`
- 当请求模型是 `kling-v1-5` 或 `kling-v1-6` 时：
  - 直接将该值视为显式执行版本
  - 同时仍走标准 Kling adapter

### UI

- 若当前选择的是 `kling_video`
  - 参数区应能选择 `model_name`
- 若当前选择的是旧版本型模型
  - UI 可以继续工作
  - 但内部行为应与显式 `model_name` 一致

## Risks / Trade-offs

- 风险: 运行时同时支持 `kling_video` 和 `kling-v*`，可能产生双轨心智
  - Mitigation: 将 `kling_video` 作为主路径，仅保留 `kling-v*` 兼容输入

- 风险: Kling 版本集合仍按 action 维护，后续若再次分叉，UI 或 workflow 可能产生非法组合
  - Mitigation: 在 adapter 层做最终校验，并在参数层尽量按 action 过滤

- 风险: `o1` 系列误被标准 Kling 识别规则吞掉
  - Mitigation: 明确在 binding inference 和 adapter 匹配中排除 `kling-video-o1*`

## Open Questions

- 默认版本是否应从 `kling-v1-6` 逐步切换到 `kling-v3`
- `image_tail` 是否在第一阶段就进入 UI 参数面板
- `mode / cfg_scale / camera_control` 是否应在后续改为动态 binding 参数，而不是继续依赖静态透传
