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
| Tuzi VIP 型号 | `gpt-image-2.5-vip` | 扩展比例及 1K/2K/4K | `auto`、`low`、`medium`、`high` |
| Tuzi 映射型号 | `gpt-image-2.5` | 扩展比例及 1K/2K/4K | `auto`、`low`、`medium`、`high`、`xhigh` |
| OpenAI 官方型号 | `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare` | 扩展比例及 1K/2K/4K | `auto`、`low`、`medium`、`high`、`xhigh` |

画质菜单最高提供“超高清”（`xhigh`），不再提供“最高”（`max`）。历史偏好中的 `max` 在恢复时回退为自动；请求适配器仍保留旧任务的 `max` 兼容能力。

Sunburst 面向最高生成与编辑精度，Flare 面向高质量、低延迟的日常生成。两者均支持文本和图片输入、图片输出。

## 尺寸规则

### Tuzi 固定尺寸型号（1k）

模型只接受 Tuzi 支持的三个像素尺寸：

- `1024x1024`
- `1024x1536`
- `1536x1024`

图片工具中的比例会映射到最接近的可用尺寸：`1:1`、`2:3`、`3:2` 直接映射；`3:4`、`4:5`、`9:16` 映射到 `1024x1536`；`4:3`、`5:4`、`16:9` 映射到 `1536x1024`。无法合理匹配的比例保持自动尺寸。

请求适配器会过滤其他像素尺寸，避免将 Tuzi 不支持的值发送到接口。

### Sunburst、Flare 与 gpt-image-2.5

`gpt-image-2.5-vip` 同样使用下述比例和分辨率映射，但保留原有四档画质。请求保留 VIP 模型名。

根据后端映射约定，`gpt-image-2.5` 使用 Sunburst/Flare 的参数能力。请求仍发送 `model: gpt-image-2.5`，具体上游型号由后端选择。`resolution` 在客户端结合比例转换为 `size`，不作为独立字段发送。

普通 `gpt-image-2.5`、VIP、Sunburst 和 Flare 显示“自动 / 1K / 2K / 4K”，内部值对应 `auto / 1k / 2k / 4k`，默认自动。旧任务的 `billing-1k` 保留兼容解析，但不再显示在菜单中。该调整不改变 `gpt-image-2` 和固定 1k 型号。

界面提供 `1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9` 和自动比例，并提供 1K、2K、4K 分辨率档位。适配器会把比例和档位映射为符合 OpenAI 约束的像素尺寸；例如：

| 界面计费档位（内部值） | `1:1` 请求尺寸 | `16:9` 请求尺寸 | `9:16` 请求尺寸 |
| --- | --- | --- | --- |
| 自动 (`auto`) | `1024x1024` | `1360x768` | `768x1360` |
| 1K (`1k`) | `1024x1024` | `1360x768` | `768x1360` |
| 2K (`2k`) | `1920x1920` | `2560x1440` | `1440x2560` |
| 4K (`4k`) | `2880x2880` | `3840x2160` | `2160x3840` |

选择明确分辨率后，自动比例按该档方图请求。自动分辨率配合自动比例时省略 `size`。2K 根据用户提供的计费表达式限制为总像素大于 1,048,576 且不超过 3,686,400，不改写 `quality`。其余 2K 比例为：2:3 = 1536x2304、3:4 = 1632x2176、4:5 = 1664x2080、21:9 = 2912x1248，反向比例交换宽高。所有尺寸保持精确比例且宽高为 16 的倍数。1K、4K 及自动映射保持原样；实际输出和最终账单仍以服务端为准，其他供应商规则未实测。

直接输入像素尺寸时，最长边不得超过 `3840px`，两边必须为 `16px` 的倍数，长短边比例不得超过 `3:1`，总像素须在 `655360` 至 `8294400` 之间。

## 接口与路由

### GPT Image 2 的 2K 兼容调整

`gpt-image-2`、`gpt-image-2-vip` 及 `gpt-image2`、`gpt-image2-vip` 别名的 2K 比例映射使用上述相同的计费安全尺寸表，生成与编辑请求一致。1K、4K、自动和合法显式像素尺寸的行为不变，`gpt-image-2-1k` 不使用此覆盖逻辑。此调整位于共享尺寸解析器，因此官方与 Tuzi 适配器都会使用新映射；它依据所提供的 Tuzi 计费表达式，不代表其他供应商计费规则。`quality` 仍表示画质，未改写为 K 档位。

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
