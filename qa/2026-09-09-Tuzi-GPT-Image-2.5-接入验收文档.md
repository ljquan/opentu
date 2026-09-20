# Tuzi GPT Image 2.5 接入验收

**更新日期**：2026-09-20

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
| 2 | 查看 `gpt-image-2.5`、VIP、Sunburst 和 Flare 参数 | 提供扩展比例、1K/2K/4K 以及 `auto` 至 `max` 六个画质档位 |
| 3 | 查看 `gpt-image-2.5-1k` 参数 | 提供完整扩展比例、仅 1K 分辨率以及 `auto` 至 `max` 六个画质档位 |
| 4 | 从 Tuzi 运行时模型列表同步 | 即使上游 `category` 为文本，五个型号仍显示为图片模型 |

## 尺寸与请求验收

| 编号 | 模型与操作 | 预期请求 |
| --- | --- | --- |
| 1 | 任一 2.5 型号依次选择完整比例 | `auto`、`1:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9` 均可保存和恢复 |
| 2 | `gpt-image-2.5`、VIP、Sunburst 或 Flare 选择 1K + `16:9` | `size: 1360x768`，分辨率为 `1k` |
| 3 | 上述四型号选择 2K + `1:1` | `size: 2048x2048`，分辨率为 `2k` |
| 4 | 上述四型号选择 4K + `16:9` | `size: 3840x2160`，分辨率为 `4k` |
| 5 | 从 4K 型号切换至 `gpt-image-2.5-1k` | 历史 2K/4K 自动回退至 1K，相同比例映射到 1K 尺寸 |
| 6 | 任一 2.5 型号选择 `max` | 请求透传 `quality: max` |
| 7 | 任一 2.5 型号使用参考图编辑 | 保留所选模型、比例、分辨率和画质，走图片编辑能力 |
| 8 | API 站接收 `size: auto` 与独立 `resolution` | 参数不丢失，按分辨率选择渠道；降档时同步改写 `resolution` |
| 9 | 绕过界面向 `gpt-image-2.5-1k` 请求 2K/4K | API 站按模型上限钳制为 1K，不进入 2K/4K 渠道 |
| 10 | 在本机和局域网地址分别生成 | 两端复用同一 Provider 配置与价格，不依赖额外 Key 或数据库同步 |

## 直连与 Request ID 验收

在本机、局域网及 `opentu.ai`、`pr.opentu.ai`、Vercel 或 Netlify 部署中，分别选择普通可信 Tuzi 节点和 Request-ID-CORS 兼容节点生成图片，同时开启浏览器 Network 的“保留日志”。

| 编号 | 检查项                                             | 预期结果                                                                              |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1    | 检查正式请求 URL                                   | 只产生一次直连当前 Provider API 的图片 `POST`，URL 中不出现 `/__opentu_tuzi_proxy__/` |
| 2    | 检查普通六节点请求头                               | 存在 `Authorization`，不携带 `X-Request-Id`                                           |
| 3    | 使用 `bus`、`bus2`、`bus3` 或 `business.tu-zi.com` | 保持直连并可携带唯一 Request ID，不改写到任何中间代理                                 |
| 4    | 模拟 `Failed to fetch` 或响应体中断                | 不发送第二个图片 `POST`，使用保存的 Request ID 直连原节点查询结果                     |
| 5    | 刷新页面                                           | 只发送 `GET /v1/images/generations/result?request_id=...` 并有界轮询，不重新提交图片  |
| 6    | 普通节点持续返回 `processing_or_not_found`         | 继续有界轮询直至 15 分钟总时限；允许最终超时，不切换节点或补发 POST                   |
| 7    | 执行文本、音频、视频任务                           | 既有路由不变                                                                          |

## 鉴权与异常验收

- 使用完整 `sk-` Key 请求时，不应被 OpenTu 改写为无前缀 Key。
- Key 无效时显示 Tuzi 原始鉴权错误，不应误报为尺寸错误。
- 上游渠道不可用时显示 Provider 的渠道错误，不应将其归因于模型未注册。
- 生成失败卡片中的重试操作应复用原模型、比例和尺寸参数。

## 自动化验证

本次实现已覆盖：

- 模型配置与可见性测试
- 五个 GPT Image 2.5 型号的扩展比例与六档画质测试
- 四个多分辨率型号的 1K/2K/4K 请求映射测试
- `gpt-image-2.5-1k` 的 UI、请求适配与服务端 1K 上限测试
- 比例到尺寸偏好迁移及 21:9 恢复测试
- 运行时模型发现测试
- GPT Image 尺寸解析测试
- GPT Image 2.5 从 adapter context 到 Provider Transport 的直连组合测试
- 普通节点移除 `X-Request-Id`、兼容节点保留该头的边界测试
- 单次提交、刷新后直连原节点及同 Request ID 有界恢复测试

2026-09-14 本次增量自动化结果：

- 模型配置、尺寸解析、Tuzi 请求体、运行时发现和图片巡检：`103/103` 通过；
- Drawnix TypeScript 类型检查通过；
- `git diff --check` 通过。

## Log

### 2026-09-20：补齐 GPT Image 2.5 参数能力

- 问题描述：`gpt-image-2.5`、VIP 和 1K 型号仍沿用三种固定像素尺寸；API 站未显式接收独立 `resolution`，自动比例请求可能无法按 2K/4K 路由。
- 修复思路：五个 2.5 型号统一完整比例和六档画质；除 `gpt-image-2.5-1k` 外提供 1K/2K/4K，1K 型号在前后端双重封顶；API 站接收、路由并透传独立分辨率。
- 更新代码架构：OpenTu 由模型能力配置统一驱动所有参数入口，resolver 负责比例矩阵和 1K 钳制；API 站由有界流式尺寸需求解析、渠道能力选择和请求归一化共同处理 `resolution`。
- 自动化结果：OpenTu 本次相关 `120/120` 通过，Drawnix 类型检查通过；API 站新增及相关回归用例在 `dto`、`service`、`relay/helper`、`relay` 四个包中通过；两个仓库 `git diff --check` 通过。
- 已知基线：API 站禁用缓存执行上述四包全量测试时，仍有 7 个与本次接入无关的既有失败（GPT Image 3 通用档位 2 项、异步重试等待时间 3 项、service 既有测试 2 项），本次未扩大范围处理。

2026-09-10 自动化结果：

- Provider 路由、Tuzi GPT Image adapter 与图片恢复服务：`174/174` 通过；
- Provider 路由最终回归：`114/114` 通过；
- Drawnix TypeScript 类型检查通过；
- `git diff --check` 通过。
