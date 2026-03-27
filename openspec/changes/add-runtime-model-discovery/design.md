## Context

设置页已经保存 `gemini.apiKey` 与 `gemini.baseUrl`，但模型选择器仍然依赖静态模型表。
动态发现模型会影响设置页、AI 输入栏、图片生成弹窗、视频生成弹窗等多个入口，因此需要抽成独立的运行时模型发现层，而不是在单个组件内临时请求。

`/v1/models` 的返回结构在不同兼容平台上通常接近 OpenAI：

- `data[].id`
- `data[].owned_by`
- `data[].supported_endpoint_types`（部分平台特有）

但项目内部展示和筛选依赖 `ModelConfig`：

- `type`: `image | video | text`
- `vendor`: 固定枚举
- `label/shortLabel/shortCode/description`

因此本次设计的关键不只是“拉取模型”，而是“把远端模型转成项目内部可消费的运行时模型配置”。

## Goals / Non-Goals

- Goals:
  - 支持通过当前 `Base URL + API Key` 拉取兼容服务的模型列表
  - 兼容 `https://host` 与 `https://host/v1` 两种 Base URL 输入
  - 产出图片、视频、文本三类运行时模型列表，供多个模型选择器共用
  - 基于厂商名称分组展示动态模型
  - 获取失败时可回退到静态模型列表，不影响现有功能
- Non-Goals:
  - 不替换已有静态模型定义文件中的全部元数据
  - 不为所有第三方平台实现完全准确的模型类型识别
  - 不在本次变更中改造价格、额度、健康状态等其它模型元数据来源

## Decisions

- Decision: 新增运行时模型发现模块
  - 提供：
    - Base URL 归一化
    - `/v1/models` 请求
    - 响应解析
    - 动态 `ModelConfig` 适配
    - 内存态/持久态缓存
  - 理由：
    - 设置页、AI 输入栏和图片/视频弹窗都需要同一份发现结果
    - 避免每个组件重复实现一套拉取和分类逻辑

- Decision: 用“显式同步按钮”触发模型发现
  - 设置页在 `API Key` / `Base URL` 输入区域附近提供“获取模型”或“同步模型”操作
  - 理由：
    - 避免用户输入过程中频繁请求
    - 易于呈现加载态、错误态和刷新结果

- Decision: 动态模型继续适配为 `ModelConfig`
  - 对外仍然给 `ModelDropdown` 传 `ModelConfig[]`
  - 理由：
    - 最小化对选择器 UI 的侵入
    - 可复用现有 vendor tabs、搜索、高亮和选择交互

- Decision: 动态模型分类采用“端点类型优先，模型 ID 关键字兜底”
  - 预期规则：
    - 视频：
      - `supported_endpoint_types` 包含视频异步端点
      - 或模型 ID 命中 `veo` / `sora` / `kling` / `video` / `seedance` / `t2v` / `i2v`
    - 图片：
      - `supported_endpoint_types` 包含 `generate` / `edit` / `banana` 类图片端点
      - 或模型 ID 命中 `image` / `banana` / `flux` / `mj` / `seedream` / `gpt-image`
    - 其余默认归为文本
  - 理由：
    - live 返回里并没有稳定的 `type` 字段
    - 仅靠 `owned_by` 不足以判断类型

- Decision: 厂商分类采用“owned_by 映射优先，模型 ID 关键字回退”
  - 预期映射：
    - `openai` -> `GPT`
    - `vertex-ai` -> `GEMINI` 或 `GOOGLE`，优先根据模型 ID 是否以 `gemini` 开头判断
    - `volcengine` / `doubao-video` -> `DOUBAO`
    - `custom` -> 基于模型 ID 关键字映射到 `GEMINI` / `FLUX` / `MIDJOURNEY` / `SORA` / `VEO` / `GPT`
    - 未命中时新增 `OTHER` 分组或回退为一个现有兜底分组
  - 理由：
    - live 数据里的 `owned_by=custom` 占比不低，不能直接作为展示厂商

- Decision: 动态模型发现失败时回退静态模型表
  - 获取失败、401、非 JSON、空列表等情况下，不清空现有可选模型
  - 理由：
    - 保证已有默认体验不受影响

## Risks / Trade-offs

- 风险：不同聚合服务返回的 `/v1/models` 结构不完全一致
  - Mitigation:
    - 解析时做字段存在性保护
    - 只依赖 `id`，其余字段尽量可选

- 风险：模型类型推断不完全准确
  - Mitigation:
    - 分类规则集中在单一适配器，便于后续补关键字
    - 保留手工输入模型 ID 的能力

- 风险：动态模型缺少静态元数据，影响短标签、默认参数、健康状态
  - Mitigation:
    - 未命中静态表时生成保守默认值
    - 若动态模型 ID 命中已有静态模型，则优先复用静态配置中的 `shortCode`、默认参数和标签

## Migration Plan

1. 新增运行时模型发现与适配模块
2. 在设置页引入“同步模型”入口和状态提示
3. 将设置页三个模型选择器切到运行时列表优先
4. 将 AI 输入栏、图片弹窗、视频弹窗改成读取同一份运行时列表
5. 保持默认模型与现有存量设置兼容
6. 补最小测试和手工验证

## Open Questions

- 是否需要把动态发现结果持久化到 localStorage，以便刷新后保留上次同步结果
- 未知厂商是否新增 `OTHER` vendor 枚举，还是暂时回退到 `GOOGLE/GPT` 等已有分组
- 文本模型是否需要排除 embedding / rerank 等非聊天模型
