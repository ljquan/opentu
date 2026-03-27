# Change: 增加多供应商配置与默认模型预设

## Why

当前设置体系只有单一 `gemini` 配置，模型发现、已添加模型、默认模型选择也都基于这一份全局状态。
当用户需要同时接入多个兼容供应商时，这种结构会带来三个直接问题：

- 不同 `Base URL + API Key` 无法并存，用户只能反复覆盖配置
- 模型目录无法区分来源，已添加模型与系统模型的关系容易混乱
- 调用时无法按“文本 / 图片 / 视频”切换到不同的接入方案

此外，当前交互把“配置供应商”“获取并选择模型”“绑定默认调用”拆成多个分离视图，用户容易误以为添加模型后就已自动生效；而在设置页直接展示已添加模型清单的方式也不适合模型数较多的场景，信息密度过高，容易把主设置页撑爆。

## What Changes

- 引入 `Provider Profile`，允许用户维护多个供应商接入配置
- 将模型发现结果改为按 `profileId` 隔离，形成各自独立的模型目录
- 将“获取模型”和“添加模型”收敛为供应商详情内的统一“管理模型”流程，不再作为独立一级视图
- 引入 `Default Model Preset`，允许用户为文本、图片、视频分别指定默认模型引用，作为未显式选择模型时的默认值
- 调整运行时请求解析逻辑，在用户显式选择模型时优先按该模型所属供应商解析 `baseUrl + apiKey`，只有在没有显式模型引用时才回退到默认模型预设
- 为现有单一 `gemini` 配置提供自动迁移路径，升级后生成默认 Profile 和默认 Preset

## Impact

- Affected specs:
  - `provider-profiles`
  - `model-routing-presets`
  - `runtime-model-discovery`
- Affected code:
  - `packages/drawnix/src/utils/settings-manager.ts`
  - `packages/drawnix/src/utils/runtime-model-discovery.ts`
  - `packages/drawnix/src/components/settings-dialog/*`
  - `packages/drawnix/src/components/ai-input-bar/*`
  - `packages/drawnix/src/components/ttd-dialog/*`
  - `packages/drawnix/src/services/model-adapters/*`
  - 任务创建与模型路由相关的请求服务

## Relationship To Existing Changes

- 本变更扩展并重构了 `add-runtime-model-discovery` 的方向
- 模型发现能力仍然保留，但其作用域将从“全局单实例”升级为“按 Profile 管理的模型目录”
- 相比最初的多供应商提案，本次进一步将“调用方案”降级为“默认模型预设”，真实路由以模型引用所属供应商为准，以减少重复配置和用户误解
