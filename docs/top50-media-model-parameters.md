# Top 50 媒体模型参数补齐

本次范围为用户给定的 21 个图片和 5 个视频模型，排除 Sora。基线为 `647e378d`，功能分支为 `dev/complete-top50-media-parameters`。本文按最新要求描述最终交付；Image 2 扩展和本次新增水印均已取消。

## 最终交付

| 模型 | 最终行为 |
| --- | --- |
| GPT Image 2 / VIP / 2-1k | 保持基线；不新增高级字段或固定 1K 静态注册 |
| GPT Image 2.5 五型号 | 保留原有背景和高级输出字段；2.5-1k 不增加扩展分辨率 |
| nano-banana / nano-banana-2 / gemini-3.1-flash-image / gemini-3-pro-image | 精确复用对应 Gemini 参数元数据，保留请求模型 ID 和 profile 身份；未知相似 ID 不匹配 |
| 其他 Gemini 图片型号 | 保留已有参数，固定 2K/4K 不新增可变档位 |
| doubao-seedream-5-0-260128 | 撤回本次图片水印；适配器保持基线 |
| Seedance 2.0 / Fast | 撤回本次水印扩展，保持基线 |
| Seedance 2.5 | 移除无可靠官方支持证据的 draft/priority；保留原有 watermark 和 output_format，工作流接通 output_format 消费 |
| MiniMax-H3 | 撤回本次 aigc_watermark；生成、再生成及 Context IR 保持基线 |
| veo3.1 | 直接开放四项高级参数，通过两条既有 Tuzi multipart 路径写入 metadata |

26 个精确模型 ID 由 `constants/__tests__/top50-media-parameters.test.ts` 对账。参数元数据复用不新增静态选择器条目，也不改写实际请求 ID。

## Veo 使用与请求

在 Veo 参数菜单的“高级功能”中配置：

| 参数 | 请求 metadata 字段 | 校验 |
| --- | --- | --- |
| negative_prompt | negativePrompt | 字符串，空白省略 |
| generate_audio | generateAudio | boolean，保存的 true/false 字符串转换为 boolean |
| seed | seed | 非负安全整数；可配置渠道上限 |
| person_generation | personGeneration | 默认 dont_allow / allow_adult / allow_all；可配置渠道枚举 |

生成音频使用“默认 / 关闭 / 开启”三个等宽按钮。“默认”清空字段并沿用上游行为，关闭发送 false，开启发送 true。已有带固定默认值的开关保持原行为。高级功能关闭时清空高级字段。

仅 `veo3.1` 使用此映射；缺省不增加 metadata，显式 false 和 0 保留，未知字段不发送。复用 `ProviderModelBinding.metadata.video.veoAdvancedParameters`：

```json
{
  "video": {
    "veoAdvancedParameters": {
      "supportedParameters": ["negative_prompt", "generate_audio", "seed", "person_generation"],
      "seedMax": 100,
      "personGenerationOptions": ["allow_adult"]
    }
  }
}
```

该示例只展示配置结构，数值不是默认渠道限制。supportedParameters 仅作为记录，按用户要求不再控制是否开放；seedMax 和 personGenerationOptions 仍用于取值校验。未配置时种子上限为 Number.MAX_SAFE_INTEGER。

## 保存恢复与模块

视频工具按 selectionKey 中的 profile/model 筛选并保存偏好，避免同名模型套用默认供应商参数。任务路由快照保存允许的能力元数据，不保存嵌入的凭据字段。

- `constants/model-config.ts`：Gemini 精确别名和 Veo 参数定义，删除 Seedance 2.5 draft/priority。
- `utils/veo-parameters.ts`：Veo 白名单、类型校验和 metadata。
- `services/video-api-service.ts`、`services/media-api/video-api.ts`：两条 multipart 提交路径。
- `services/model-adapters/seedance2-adapter.ts`：保留已有水印/格式，忽略遗留 draft/priority。
- `workflow-mode/host/native-parameters.ts`、`native-models.ts`：消费者、白名单和渠道取值限制。
- `services/task-invocation-route.ts`、`ai-generation-preferences-service.ts`：无凭据快照和供应商作用域。

## 限制与维护

本地参数展示和模拟请求构造通过不代表 Tuzi 生产渠道或供应商实际支持。Veo 直接开放后，具体渠道仍可能忽略或拒绝字段；Seedance output_format 沿用现有实现，未确认真实渠道格式生效。

没有新增 Gemini 原生视频高级 parameters 路径，也未实现 Seedream 提示词优化/序列生成/图层拆解、Seedance 任务控制、H3 参考音频或 Tuzi Veo 尾帧转换。这些属于另行确认的工作包。

不需要依赖、环境变量或数据迁移；保留现有任务、偏好和素材。回滚按本功能提交撤回，不清空用户数据。测试和已知基线失败详见 [QA 记录](./qa-top50-media-model-parameters.md)。
