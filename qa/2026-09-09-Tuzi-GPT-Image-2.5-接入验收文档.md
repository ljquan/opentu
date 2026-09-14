# Tuzi GPT Image 2.5 接入验收

**更新日期**：2026-09-10

**实现规则**：[Tuzi GPT Image 2.5 接入说明](../docs/TUZI_GPT_IMAGE_25_INTEGRATION.md)

**关联文档**：[图片 Request ID 与网络中断结果恢复人工测试文档](./2026-08-07-图片请求ID与网络中断结果恢复-人工测试文档.md)

## 前置条件

- 执行 `pnpm start:lan`，使用终端实际显示的 `Local` 或 `Network` 地址；端口被占用时 Vite 会自动递增。
- 配置 Tuzi Provider 地址。
- 配置完整格式的 `sk-...` Key。
- Provider 账户已具备对应图片模型渠道和余额。

## 模型目录验收

| 编号 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 打开图片模型选择器 | 可看到旧三型号及 `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare` |
| 2 | 查看 Sunburst 和 Flare 参数 | 提供扩展比例、1K/2K/4K 以及 `auto` 至 `max` 六个画质档位 |
| 3 | 查看旧三型号参数 | 仍只提供三种固定像素尺寸，不出现 1K/2K/4K 档位 |
| 4 | 从 Tuzi 运行时模型列表同步 | 即使上游 `category` 为文本，五个型号仍显示为图片模型 |

## 尺寸与请求验收

| 编号 | 模型与操作 | 预期请求 |
| --- | --- | --- |
| 1 | 旧三型号选择 `1:1`、`2:3`、`3:2` | 分别为 `1024x1024`、`1024x1536`、`1536x1024` |
| 2 | 旧三型号选择其他纵向或横向比例 | 映射到最接近的固定尺寸，不发送非法像素值 |
| 3 | Sunburst/Flare 选择 1K + `16:9` | `size: 1360x768` |
| 4 | Sunburst/Flare 选择 2K + `1:1` | `size: 2048x2048` |
| 5 | Sunburst/Flare 选择 4K + `16:9` | `size: 3840x2160` |
| 6 | Sunburst/Flare 选择 `max` | 请求透传 `quality: max` |
| 7 | Sunburst/Flare 使用参考图编辑 | 保留所选模型、尺寸和画质，走图片编辑能力 |
| 8 | 在本机和局域网地址分别生成 | 两端复用同一 Provider 配置与价格，不依赖额外 Key 或数据库同步 |

## 同源代理与 Request ID 验收

在 `opentu.ai`、`pr.opentu.ai`、Vercel 或 Netlify 部署中，选择六个普通可信 Tuzi 节点之一并生成一次图片，同时开启浏览器 Network 的“保留日志”。

| 编号 | 检查项                                             | 预期结果                                                                                        |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1    | 检查正式请求 URL                                   | 只产生一次 `POST /__opentu_tuzi_proxy__/<节点>/v1/images/generations`，不直接跨域请求上游       |
| 2    | 检查请求头                                         | 同时存在 `Authorization` 和唯一的 `X-Request-Id`，Request ID 与当前提交任务一致；记录时必须脱敏 |
| 3    | 模拟缺少 Request ID                                | 正式请求在发送前被阻断，Network 中不出现无法恢复的图片 `POST`                                   |
| 4    | 模拟 `Failed to fetch` 或响应体中断                | 不发送第二个图片 `POST`，使用相同 Request ID 查询原节点结果                                     |
| 5    | 让代理返回 HTML                                    | 明确提示同源代理未生效，不把 HTML 当作图片响应，不切换节点或直连重发                            |
| 6    | 使用 `bus`、`bus2`、`bus3` 或 `business.tu-zi.com` | 保持直连并携带 Request ID，不误改写到固定代理                                                   |
| 7    | 执行文本、音频、视频任务                           | 不进入图片固定代理，既有路由不变                                                                |

## 鉴权与异常验收

- 使用完整 `sk-` Key 请求时，不应被 OpenTu 改写为无前缀 Key。
- Key 无效时显示 Tuzi 原始鉴权错误，不应误报为尺寸错误。
- 上游渠道不可用时显示 Provider 的渠道错误，不应将其归因于模型未注册。
- 生成失败卡片中的重试操作应复用原模型、比例和尺寸参数。

## 自动化验证

本次实现已覆盖：

- 模型配置与可见性测试
- Sunburst/Flare 扩展比例、1K/2K/4K 和 `xhigh`/`max` 画质测试
- GPT Image 2.5 请求尺寸过滤测试
- 比例到尺寸偏好迁移测试
- 运行时模型发现测试
- GPT Image 尺寸解析测试
- GPT Image 2.5 从 adapter context 到 Provider Transport 的同源代理组合测试
- 缺少 Request ID 的发送前阻断测试
- 代理 HTML 响应、单次提交及同 Request ID 恢复测试

2026-09-14 本次增量自动化结果：

- 模型配置、尺寸解析、Tuzi 请求体、运行时发现和图片巡检：`103/103` 通过；
- Drawnix TypeScript 类型检查通过；
- `git diff --check` 通过。

2026-09-10 自动化结果：

- Provider 路由、Tuzi GPT Image adapter 与图片恢复服务：`174/174` 通过；
- Provider 路由最终回归：`114/114` 通过；
- Drawnix TypeScript 类型检查通过；
- `git diff --check` 通过。
