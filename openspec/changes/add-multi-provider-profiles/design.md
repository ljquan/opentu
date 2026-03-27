## Context

当前实现已经具备“输入 Base URL + API Key 后获取模型列表”的基础能力，但运行时状态仍然是全局单例：

- 只有一份供应商配置
- 只有一份已发现模型列表
- 只有一份已添加模型集合
- 所有生成入口默认共享同一组模型来源

这一结构不适合继续扩展到多供应商场景。

同时，当前已经落地的多供应商雏形仍然保留了较强的“两段式”心智：

- 用户先进入供应商配置
- 再切换到模型管理视图获取并选择模型
- 最后再到默认模型预设里选择默认模型

这会把一个本应连续的操作链拆成多段，增加理解负担，也容易让用户误以为“添加模型以后就已经生效”。

## Goals / Non-Goals

- Goals:
  - 支持多个供应商接入配置并存
  - 支持每个接入配置拥有独立模型目录
  - 支持按文本、图片、视频分别路由到不同供应商下的默认模型
  - 支持用户在运行时切换默认模型预设
  - 在用户显式选择模型时，按模型所属供应商自动完成调用路由
  - 保证旧版单配置数据可自动迁移
- Non-Goals:
  - 本次不实现云端同步多个供应商配置
  - 本次不做供应商自动健康探测与自动故障切换
  - 本次不统一不同供应商的计费展示

## Decisions

- Decision: 将现有单一 `gemini` 配置升级为 `profiles + presets + catalogs`

  - `profiles` 解决“怎么连”
  - `catalogs` 解决“这个接入源有哪些模型”
  - `presets` 解决“在未显式选择模型时当前默认用哪个模型”

- Decision: 模型发现结果必须按 `profileId` 隔离

  - 同一个模型 ID 在不同供应商下可能具有不同支持能力
  - 同一供应商的模型添加/删除不应影响其它供应商

- Decision: “获取模型”和“添加模型”合并为供应商详情中的统一“管理模型”流程

  - 用户在供应商详情中完成连接、测试、获取并选择模型
  - 不再保留单独的“模型管理”一级页签
  - 主设置页只展示摘要，不展示完整已添加模型清单

- Decision: 请求路由以“模型引用”优先，而不是“Profile 显式选择”优先

  - `Preset` 仅为每种任务类型配置默认模型引用
  - 模型引用包含 `profileId + modelId`
  - 用户在主界面或方案里显式选择某个模型时，请求应优先按该模型所属供应商解析凭证
  - 只有在没有显式模型引用时，才回退到 Preset 默认模型或 legacy 配置

- Decision: 兼容迁移采用“懒迁移”

  - 启动时检测旧结构
  - 自动生成 `legacy-default` Profile 与 `default` Preset
  - 将旧的默认模型选择映射到对应 Preset 路由

- Decision: `ProviderType`、`AuthType`、`capabilities` 需要下沉到适配层，而不仅停留在表单层
  - 模型发现与实际请求应通过统一的 provider transport / adapter 构造请求
  - 避免继续在各个 service 中写死 `/models` 与 `Authorization: Bearer`

## Proposed Data Model

```ts
interface ProviderProfile {
  id: string;
  name: string;
  providerType: 'openai-compatible' | 'gemini-compatible' | 'custom';
  baseUrl: string;
  apiKey: string;
  authType: 'bearer' | 'header';
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  capabilities: {
    supportsModelsEndpoint: boolean;
    supportsText: boolean;
    supportsImage: boolean;
    supportsVideo: boolean;
    supportsTools: boolean;
  };
}

interface ProviderCatalog {
  profileId: string;
  discoveredAt: number | null;
  discoveredModels: ModelConfig[];
  selectedModelIds: string[];
}

interface ModelRef {
  profileId: string | null;
  modelId: string | null;
}

interface DefaultModelPreset {
  id: string;
  name: string;
  isDefault?: boolean;
  text: { defaultModelRef: ModelRef | null };
  image: { defaultModelRef: ModelRef | null };
  video: { defaultModelRef: ModelRef | null };
}
```

## UI Structure

- `供应商配置`
  - 列表显示所有 Profiles
  - 支持新增、编辑、删除、启用/停用、测试连接
  - 在供应商详情内提供“管理模型”入口
  - 管理模型进入抽屉或独立工作区，自动同步后直接筛选、勾选、保存
- `默认模型预设`

  - 列表显示所有 Presets
  - 每个 Preset 分别配置文本、图片、视频默认模型
  - 模型选择器按供应商分组展示，选择模型时自动绑定其所属供应商
  - 支持切换当前激活 Preset 作为默认值来源

- `主界面模型选择器`
  - 继续支持图片、视频、文本选择
  - 选项按供应商分组
  - 用户一旦显式选择某个模型，请求优先按该模型所属 `profileId` 路由
  - 当前显式选择不会要求用户额外配置供应商路由

## Risks / Trade-offs

- 风险: 设置存储结构变化较大

  - Mitigation: 提供兼容迁移与兜底默认值

- 风险: 运行时需要稳定知道“某个模型属于哪个供应商”

  - Mitigation: 为运行时模型和选择器统一引入 `ModelRef` 结构，不再只传裸 `modelId`

- 风险: `ProviderType` / `AuthType` 目前只存在于设置表单中

  - Mitigation: 新增 provider adapter 层，统一处理鉴权头、模型发现路径和能力校验

- 风险: 模型发现和模型选择的状态来源从单例变成多实例，复杂度上升
  - Mitigation: 将 `runtime-model-discovery` 抽象为按 `profileId` 的 catalog store

## Migration Plan

1. 保留旧 `gemini` 字段读取能力
2. 启动时若检测不到 `profiles/presets`，自动从旧配置生成默认 Profile 和 Preset
3. 将 Preset 的旧 `profileId + defaultModelId` 结构迁移为 `defaultModelRef`
4. 首次保存新设置后，优先写入新结构
5. 所有请求入口先读取新结构；若新结构不存在，再回退旧结构

## Open Questions

- 主界面的 Preset 切换器放在顶部全局栏还是 AI 输入栏附近
- 当用户临时选择了与当前 Preset 默认模型不同的模型时，是否需要显式提示“本次调用将按所选模型所属供应商执行”
