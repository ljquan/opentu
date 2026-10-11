# Change: 补齐 Top 50 媒体模型的 Gemini 别名与 Veo 参数

状态：用户已以“启动”批准实施，后续授权提交 PR；按最新要求撤回 Image 2 扩展及本次新增水印。范围仅限既定 21 个图片和 5 个视频 ID。

## Why

GPT Image 2.5 背景和高级参数已经存在。榜单中的四个 Gemini 精确别名缺少一致参数元数据，Veo 四项高级字段缺少最终请求映射。Seedance 2.5 draft/priority 无可靠官方合同，应从可选参数和请求中移除。

## What Changes

- 四个 Gemini 别名复用既有参数元数据，实际请求模型 ID 和 profile 身份保持。
- veo3.1 直接开放 negative_prompt、generate_audio、seed、person_generation，写入两条既有 Tuzi multipart 路径的 metadata；可选布尔使用默认/关闭/开启三个按钮。
- 工作流同步消费者、白名单和可选渠道取值限制；视频偏好按 profile/model 保存，快照只保留允许的能力字段。
- Seedance 2.5 移除 draft/priority，保留原有 watermark/output_format，补齐工作流 output_format 消费。
- Image 2 扩展及本次所有新增水印取消；已有水印行为保留。
- 维护 26-ID 对账、QA/DOC 和受影响回归；真实供应商、浏览器和部署验收另列。

## Scope And Impact

- Affected specs: runtime-model-discovery、image-generation、provider-routing、ai-input-generation。
- 当前代码基线：647e378d。Tuzi 参考代码仅为契约研究依据，不证明生产部署或供应商消费。
- 不新增供应商引擎、静态别名选择器条目、请求 ID 重写、依赖、迁移或收费请求。
- Seedream 条件能力、Seedance 任务控制、H3 音频、原生 Gemini 视频高级路径和 Veo 后端媒体转换不在当前交付。

完整模型清单及原方案取舍见 [design.md](./design.md)，最终实现以 [DOC](../../../docs/top50-media-model-parameters.md) 和 [tasks.md](./tasks.md) 为准。条件工作包不得作为已经实现的能力发布。

## Dependencies And Risks

Veo 按用户明确要求直接开放，客户端类型校验不能证明每个 Tuzi 渠道支持。Seedance output_format 继续沿用已有请求行为，真实格式未实测。回滚功能提交即可，无需清空历史任务或用户素材。
