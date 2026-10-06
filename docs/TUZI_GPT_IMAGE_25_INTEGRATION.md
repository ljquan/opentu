# Tuzi GPT Image 2.5 接入说明

## 支持模型

OpenTu 内置以下三个 Tuzi 图片模型：

- `gpt-image-2.5-1k`
- `gpt-image-2.5`
- `gpt-image-2.5-vip`

同时支持 OpenAI 官方 GPT Image 2.5 两个独立模型：

- `gpt-image-2.5-sunburst`（高精度生成与编辑）
- `gpt-image-2.5-flare`（高速日常生成）

上述模型均复用现有图片生成 Provider、价格读取和请求适配流程，不需要专用 Token 或数据库逻辑。

## 模型能力

| 模型组 | 模型 | 尺寸 | 画质 |
| --- | --- | --- | --- |
| Tuzi 固定尺寸型号 | `gpt-image-2.5-1k` | 三种固定像素尺寸 | `auto`、`low`、`medium`、`high` |
| Tuzi VIP 型号 | `gpt-image-2.5-vip` | 扩展比例及 1K/2K/4K | `auto`、`low`、`medium`、`high`、`xhigh` |
| Tuzi 映射型号 | `gpt-image-2.5` | 扩展比例及 1K/2K/4K | `auto`、`low`、`medium`、`high`、`xhigh` |
| OpenAI 官方型号 | `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare` | 扩展比例及 1K/2K/4K | `auto`、`low`、`medium`、`high`、`xhigh` |

画质菜单最高提供“超高清”（`xhigh`），不再提供“最高”（`max`）。历史偏好中的 `max` 在恢复时回退为自动；请求适配器仍保留旧任务的 `max` 兼容能力。

Sunburst 面向最高生成与编辑精度，Flare 面向高质量、低延迟的日常生成。两者均支持文本和图片输入、图片输出。

## 背景参数

Image 2.5 的五个模型在基础参数下方提供“高级功能”开关，默认关闭，Image 2 与其他模型不显示。开启后展示输出格式、压缩质量、内容审核和用户标识及说明；关闭会清除这些高级参数。未设置高级参数时不额外发送默认值。压缩质量只发送给 JPEG/WebP，PNG 忽略该字段；透明背景与 JPEG 冲突时在提交前报错。当前不开放流式与阶段图片控件，因为图片结果解析尚未支持 SSE。

Tuzi generations 请求另支持客户端传递 `output_format`（png/jpeg/webp）、`output_compression`（0–100）、`moderation`（auto/low）和 `user`。工作流原生参数面板提供对应控件；任务显式 `outputFormat`、`outputCompression` 优先于 params 字段，未设置或非法值不发送，压缩值 0 保留。base64 响应按请求的输出格式解析，服务端返回的格式信息优先。是否实际生效取决于 Tuzi 渠道，不保证所有模型支持。不增加 stream、partial_images、mask 或 input_fidelity。

GPT Image 2.5 的参数菜单提供“图片背景”：自动（`auto`，默认）、透明（`transparent`）、不透明（`opaque`）。GPT Image 2 仅提供自动和不透明；其余图片模型不显示此参数。

背景选择按模型与 Provider 作用域保存，独立于尺寸、分辨率和画质。官方与 Tuzi 适配器均传递顶层 `background` 字段，文本生成及带参考图的请求一致。Tuzi 优先读取任务显式 `background`，其次读取 `params.background`；缺失或非法值不传递，界面恢复非法历史值时回退为自动。

根据实际服务端报错，Image 2 不接受 `transparent`。Image 2 普通、VIP 及 `gpt-image2` 别名的旧透明偏好恢复为自动；Tuzi 适配器按最终绑定模型过滤旧任务的透明字段，保留 `auto` 和 `opaque`。这不会使已有不透明图片变成透明，也不保证旧提示词中“透明图”的生成效果。

Image 2 的限制按模型 ID 家族匹配，覆盖 `gpt-image-2-*`、`gpt-image2-*`、`image-2`、`image2` 及其后缀变体，不仅限于静态目录。`2.5` 单独识别，运行时同步的图片模型同样适用；这些变体的名字匹配不代表已逐个验证服务端能力。

输入栏选择透明背景并提交图片任务时，在提交提示词末尾另起一行追加“透明图”，同时保留 `background: transparent` 参数。末尾已有“透明图”时也追加；自动和不透明选项不改写提示词，输入框原始文本保持不变。

本次修复验证客户端选项、偏好保存和请求构造，未调用真实 Provider；透明输出的实际支持情况和 alpha 通道仍需在对应渠道验收。不新增配置、依赖或迁移。

## 尺寸规则

### Tuzi 固定尺寸型号（1k）

模型只接受 Tuzi 支持的三个像素尺寸：

- `1024x1024`
- `1024x1536`
- `1536x1024`

图片工具中的比例会映射到最接近的可用尺寸：`1:1`、`2:3`、`3:2` 直接映射；`3:4`、`4:5`、`9:16` 映射到 `1024x1536`；`4:3`、`5:4`、`16:9` 映射到 `1536x1024`。无法合理匹配的比例保持自动尺寸。

请求适配器会过滤其他像素尺寸，避免将 Tuzi 不支持的值发送到接口。

### Sunburst、Flare 与 gpt-image-2.5

`gpt-image-2.5-vip` 同样使用下述比例和分辨率映射，并支持至 `xhigh` 的五档画质。请求保留 VIP 模型名。

根据后端映射约定，`gpt-image-2.5` 使用 Sunburst/Flare 的参数能力。请求仍发送 `model: gpt-image-2.5`，具体上游型号由后端选择。明确比例时 `resolution` 在客户端转换为 `size`；Tuzi 自动比例时改用下述独立 `imageSize` 字段保留所选档位。

普通 `gpt-image-2.5`、VIP、Sunburst 和 Flare 显示“自动 / 1K / 2K / 4K”，内部值对应 `auto / 1k / 2k / 4k`，默认自动。旧任务的 `billing-1k` 保留兼容解析，但不再显示在菜单中。该调整不改变 `gpt-image-2` 和固定 1k 型号。

界面提供 `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9` 和自动比例，并提供 1K、2K、4K 分辨率档位。适配器会把比例和档位映射为符合 OpenAI 约束的像素尺寸；例如：

| 界面计费档位（内部值） | `1:1` 请求尺寸 | `16:9` 请求尺寸 | `9:16` 请求尺寸 |
| --- | --- | --- | --- |
| 自动 (`auto`) | `1024x1024` | `1360x768` | `768x1360` |
| 1K (`1k`) | `1024x1024` | `1360x768` | `768x1360` |
| 2K (`2k`) | `1920x1920` | `2560x1440` | `1440x2560` |
| 4K (`4k`) | `2880x2880` | `3840x2160` | `2160x3840` |

自动比例独立于分辨率选择：Tuzi 适配器发送 `size: "auto"`，并把所选 1K/2K/4K 通过 `generationConfig.imageConfig.imageSize` 传递为 `1K/2K/4K`，`quality` 仍表示画质。分辨率也为 auto 时不发送 imageSize。此规则适用于普通、VIP、Sunburst、Flare 的生成和编辑，不改变 Image 2 或固定 1K 型号；官方适配器不发送此 Tuzi 扩展字段。自动比例不限制返回图片的宽高，实际输出和最终账单以服务端为准；字段参与计费不代表已验证上游的尺寸控制效果。

明确比例继续按所选 K 档计算 size。2K 根据用户提供的计费表达式限制为总像素大于 1,048,576 且不超过 3,686,400，不改写 `quality`。其余 2K 比例为：2:3 = 1536x2304、3:4 = 1632x2176、4:5 = 1664x2080、21:9 = 2912x1248，反向比例交换宽高。所有明确比例尺寸保持精确比例且宽高为 16 的倍数，其他供应商规则未实测。

直接输入像素尺寸时，最长边不得超过 `3840px`，两边必须为 `16px` 的倍数，长短边比例不得超过 `3:1`，总像素须在 `655360` 至 `8294400` 之间。

## 接口与路由

### GPT Image 2 的 2K 兼容调整

`gpt-image-2`、`gpt-image-2-vip` 及 `gpt-image2`、`gpt-image2-vip` 别名的 2K 比例映射使用上述相同的计费安全尺寸表，生成与编辑请求一致。明确比例的 1K、4K 和合法显式像素尺寸行为不变，`gpt-image-2-1k` 不使用此覆盖逻辑。此调整位于共享尺寸解析器，因此官方与 Tuzi 适配器都会使用新映射；它依据所提供的 Tuzi 计费表达式，不代表其他供应商计费规则。`quality` 仍表示画质，未改写为 K 档位。

Tuzi 的 Image 2 普通、VIP 及上述别名现在也支持自动比例保留所选 K 档：发送 `size: "auto"` 与 `generationConfig.imageConfig.imageSize: "1K" / "2K" / "4K"`，生成和编辑一致。此扩展与 Image 2.5 四个扩展型号共用逻辑；固定 `gpt-image-2-1k`、`gpt-image-2.5-1k` 和官方适配器不变。实际渠道接受、出图尺寸和计费仍需服务端验证。

- 官方 OpenAI Provider 使用 `/v1/images/generations` 和 `/v1/images/edits`。
- Tuzi Provider 复用现有 `tuzi-gpt-image` JSON 适配器，不新增 Token、数据库或代理层。
- 运行时模型列表即使把上述模型错误标成文本，OpenTu 仍以静态目录的图片类型为准。
- 价格继续读取 Provider 返回的数据，OpenTu 不维护重复价格表。

## Provider 配置

按现有 Provider 配置方式填写 Tuzi API 地址和完整的 `sk-` Key。Key 前缀属于合法鉴权格式，OpenTu 不会删除或重写它。价格由已有模型价格服务按 Provider 返回的价格数据计算。

## 本地与局域网验证

运行 `pnpm start:lan` 后，Vite 绑定 `0.0.0.0`。默认从 `7200` 端口开始；若端口已占用，以终端显示的 `Local` 和 `Network` 地址为准，不要固定使用 `5173`。

完整人工验收见 [Tuzi GPT Image 2.5 接入验收文档](../qa/2026-09-09-Tuzi-GPT-Image-2.5-接入验收文档.md)。

## 官方参考

- [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [GPT Image 2.5 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)
- [OpenAI 图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)

## 非目标

本接入不引入局域网数据库同步、Token 同步、额外站点回退或专用运行实例。局域网开发应使用正常 Provider 地址配置验证，避免把测试环境行为混入正式接入代码。
