# Change: 接入 Tuzi gpt-image-2.6-1k

## Why

用户要求在最新 develop 的 OpenTu 中接入 `gpt-image-2.6-1k`，参考聊天“添加 gpt-image-2.6-1k 描述”（01a1a9fb-435e-79f3-819b-741af4a88036）。该聊天中用户已说明只有 `-1k` 上线，GIF 通过提示词“生成 GIF 图”请求；渠道文案说明图片保留实际返回尺寸，不能把 1k 当作固定 1024×1024。

当前目录没有此型号。`isGPTImage2ModelId` 会把 2.6 识别成 2；若只追加模型条目而不维护 GPT 参数分组，新型号还会进入 Gemini 参数列表。底层已有 GIF/SVG MIME 识别，但尚未完成该型号的实际请求、缓存、预览和下载验证。

## What Changes

- 注册精确型号、显示名称、简码和渠道能力说明，补齐所有必填元数据；不增加未上线的 2.6 其他后缀。
- 独立定义 2.6-1k 的型号判断和参数能力，修复与 GPT Image 2、Gemini 的误分类；不直接复制 2.5 的固定尺寸集合、画质或高分辨率参数。
- 复用现有按供应商配置选择的图片适配器，保持请求模型 ID 和供应商绑定一致；不自动改写为 2.5，也不切换用户凭证。
- 默认采用自动尺寸；仅开放经渠道合同或实测确认的参数，清理切换模型时遗留的不兼容参数。按返回媒体实际尺寸入画布。
- 验证静态图片、提示词生成 GIF、SVG 的实际响应形式，完善必要的解析、缓存、预览及原文件下载处理，保留 MIME、扩展名和 GIF 动画帧。
- 增加型号分类、参数切换、请求路由、返回格式及旧型号回归测试，并记录真实接口与浏览器验证结果。SVG 作为图片资源展示，不直接插入不可信 SVG DOM。
- 不引入新持久化字段；若实现确需新增字段，先补齐默认值、序列化、读取兼容和迁移验证。

## Options

| 方案 | 优势和适用场景 | 缺点、维护成本和风险 |
|---|---|---|
| 最小配置接入 | 变更少，适合先提供静态生图入口 | 仍需修复分类；GIF/SVG 未形成验收闭环，后续可能补修 |
| 完整接入与格式回归（推荐） | 覆盖用户引用的图片、GIF、SVG 能力及保存下载链路 | 测试范围较大；渠道不支持或返回协议不明确的能力需明确标注，不能宣称通过 |

## Impact

- Affected specs: `image-generation`, `runtime-model-discovery`。
- Affected code: `packages/drawnix/src/constants/model-config.ts`、图片参数解析器、GPT/Tuzi 图片适配器及其路由测试；根据验证结果调整 `packages/utils/src/url`、媒体缓存、画布展示和下载链路。
- 与已有 `update-default-model-catalog`、`update-image-api-compatibility-modes`、`add-gpt-image-profile-compatibility` 共享代码；以当前 develop 的实现为基准，不重做路由体系。
- 不变更默认模型、既有型号尺寸规则、数据库或计费配置。

## Approval and Validation

用户于 2026-11-05 明确批准“完整接入（推荐）”。客户端实现及验证已完成，详细结果见 `validation.md`。真实 SVG 生成被上游以 HTTP 400 拒绝，目前只确认有效 SVG 返回值的客户端处理可用，不宣称渠道 SVG 生成功能已经可用。验收区分模拟测试与真实接口测试，不把单次成功等同于上游永久可用。
