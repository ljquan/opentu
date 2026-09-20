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
| 2 | 查看 Sunburst 和 Flare 参数 | 提供扩展比例、业务 1K/2K/4K 以及 `auto` 至 `xhigh` 五个画质档位 |
| 3 | 查看普通 `gpt-image-2.5` 和 VIP 参数 | 两者均提供扩展比例、业务 1K/2K/4K；普通型号五档画质，VIP 保留四档；1k 型号保持固定尺寸 |
| 4 | 从 Tuzi 运行时模型列表同步 | 即使上游 `category` 为文本，五个型号仍显示为图片模型 |

## 尺寸与请求验收

| 编号 | 模型与操作 | 预期请求 |
| --- | --- | --- |
| 1 | 1k 型号选择 `1:1`、`2:3`、`3:2` | 分别为 `1024x1024`、`1024x1536`、`1536x1024` |
| 2 | 1k 型号选择其他纵向或横向比例 | 映射到最接近的固定尺寸，不发送非法像素值 |
| 3 | Sunburst/Flare 选择 1K + `16:9` | `size: 1360x768` |
| 4 | Sunburst/Flare 选择业务 2K + `1:1` | `size: 1024x1024` |
| 5 | Sunburst/Flare 选择业务 4K + `16:9` | `size: 2736x1536` |
| 6 | Sunburst/Flare 选择超高清 | 请求透传 `quality: xhigh`；菜单不提供 `max` |
| 7 | Sunburst/Flare 使用参考图编辑 | 保留所选模型、尺寸和画质，走图片编辑能力 |
| 8 | 在本机和局域网地址分别生成 | 两端复用同一 Provider 配置与价格，不依赖额外 Key 或数据库同步 |

## 直连与 Request ID 验收

2026-09-20 业务档位调整验证：在 `packages/drawnix` 执行
`NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/constants/__tests__/model-config.test.ts src/services/__tests__/ai-generation-preferences-service.test.ts src/services/__tests__/tuzi-gpt-image-adapter.test.ts`，73/73 通过。
覆盖菜单档位、旧最高分辨率偏好回退、尺寸与画质请求适配；`git diff --check` 通过。
恢复独立自动选项后，在上述命令中追加 `src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts --silent`，96/96 通过；覆盖业务 1K 的独立保存和旧自动请求语义。
测试环境存在 IndexedDB 缺失日志，未验证真实持久化、页面交互、上游出图或账单。
菜单保留独立自动选项，业务 1K/2K/4K 分别对应内部 `billing-1k/1k/2k`；业务 1K 保留原自动档请求方式。明确比例下前两档可能发送相同尺寸，输出尺寸和实际费用由服务端决定。
下文历史验证记录中的 K 档位与最高画质指当时的内部请求值，不代表当前菜单。

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

2026-09-20 PR #266 隔离冲突处理（最新验收记录）：

- 基于远程 PR `5b600182`，合并 `origin/develop` 的 `84b5e01f`；不纳入原目录的两条本地回退提交及五个未提交文件。
- 按用户确认，图片参数以远程 PR #266 为准：保留业务 1K/2K/4K 到 `billing-1k/1k/2k` 的映射、默认业务 1K、原画质选项和尺寸转换；不采用 `84b5e01f` 的独立 resolution 传参、全系列六档画质及固定 1k 型号扩展。保留 develop 的 MiniMax 与其他无关更新及对应测试。
- 在隔离目录 `packages/drawnix` 使用 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run`，指定 model-config、image-size-quality-resolver、tuzi-gpt-image-adapter、gpt-image-adapter、ai-generation-preferences-service、image-inspection-pure、default-image-adapter、media-api/image-api、minimax-h3-regeneration-service、minimax-h3-video-workflow 共 10 个测试文件，附加 `--testTimeout 20000 --silent`：195/195 通过。
- `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json` 通过；`pnpm exec vite build --config apps/web/vite.config.ts` 通过（59.05 秒）；差异空白检查通过，无未解决冲突。
- 额外执行 runtime-model-discovery.test.ts：14 通过、1 失败，失败项为“主端点浏览器 fetch 失败时会尝试 tuzi-api 候选端点获取模型”，预期直连而实际使用同源会话代理。已在独立的纯 develop `84b5e01f` 工作区复现相同失败，未修改该上游问题；不得据此宣称全部测试或 CI 通过。
- 构建保留 Sass 弃用、Browserslist 数据过期、混合导入和大 chunk 警告。未做页面测试、真实计费生图、全仓测试或全仓 lint；供应商实际输出与计费仍待验收。
- DOC 的业务参数说明保持有效，无需改变规则；本记录覆盖下方较早阶段的同步与测试结果。

2026-09-20 同步 develop 后最终验证：

- 分支：`fix/gpt-image-25-resolution-tiers`。显式 fetch 并 merge `origin/develop`（`b730d01125423ae261b596142c5c24b9fc3efebf`），结果 Already up to date，无冲突。
- 环境：Node.js 26.8.1、pnpm 10.21.0。在 `packages/drawnix` 执行 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/constants/__tests__/model-config.test.ts src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts src/services/__tests__/tuzi-gpt-image-adapter.test.ts src/services/__tests__/gpt-image-adapter.test.ts src/services/__tests__/ai-generation-preferences-service.test.ts src/services/__tests__/image-inspection-pure.test.ts src/services/__tests__/default-image-adapter.test.ts src/utils/__tests__/runtime-model-discovery.test.ts --testTimeout 20000 --silent`：8 文件、190 项通过。
- 根目录执行 `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json`、`pnpm exec vite build --config apps/web/vite.config.ts`、`git diff origin/develop...HEAD --check` 均通过；构建耗时 49.49 秒。
- 构建存在 Sass 弃用、Browserslist 数据过期、静态/动态混合导入和大 chunk 警告；未在本任务扩大范围处理。
- 未执行全仓测试、全仓 lint、页面交互和真实计费生图；上游最终图片尺寸、计费和实际偏好持久化仍待人工验收。以下“人工验收”均为待执行步骤，并非已通过记录。
- DOC 已同步。另一个待合并 PR #265 涉及同一尺寸解析器，其自动比例 + 显式 K 档位策略与本次自动转正方形不同；后续合并须统一策略，本次未修改或合并该 PR。

2026-09-20 补齐 Sunburst/Flare 的自动尺寸修正（同步前阶段结果）：

- 普通 2.5、VIP、Sunburst、Flare 共用 `GPT_IMAGE_25_EXTENDED_MODEL_IDS`，统一自动/1K/2K/4K 参数、界面选择归一化、旧偏好恢复和生成/编辑尺寸转换；image-2 与固定 1k 型号保持原行为。
- `packages/drawnix` 下执行 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/constants/__tests__/model-config.test.ts src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts src/services/__tests__/tuzi-gpt-image-adapter.test.ts src/services/__tests__/gpt-image-adapter.test.ts src/services/__tests__/ai-generation-preferences-service.test.ts --testTimeout 20000 --silent`：5 文件、127 项通过。
- `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json`、`git diff --check` 通过。
- 新增 Sunburst/Flare 的自动及旧尺寸 + K 档位、缺省尺寸、编辑尺寸、最高画质和请求模型名保留验证。
- 人工验收：Sunburst/Flare 选择 4K + 自动比例时变为 1:1，生成和编辑均携带 `size: 2880x2880`；4K + 16:9 为 `3840x2160`；自动分辨率 + 自动比例省略 `size`；刷新后保留选定档位。
- 未运行页面交互、构建或真实计费生图，不能据此确认上游最终图片尺寸。DOC 已同步，以下为之前阶段记录。

2026-09-19 修正 4K + 自动尺寸：

- 范围：普通 2.5 和 VIP。分辨率新增自动档，默认自动；选 K 档位时自动比例变为 1:1，旧像素尺寸按比例重新计算。保留 `image-2`、Sunburst/Flare 和固定 1k 型号的原逻辑。
- 在 `packages/drawnix` 执行 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run`，指定模型配置、尺寸解析器、Tuzi 请求体、偏好服务四个测试文件，87 项通过。
- 同命令执行 `src/services/__tests__/gpt-image-adapter.test.ts --testTimeout 20000`，29 项通过。最初默认 5 秒时限导致两个等待图片尺寸读取 15 秒兜底的测试超时；仅调整本次命令时限后通过，未改业务超时逻辑。
- 仓库根目录执行 `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json` 通过；`git diff --check` 通过。
- 覆盖：自动/缺失/旧像素尺寸 + 1K/2K/4K、保留自动分辨率、自定义像素透传、生成与编辑请求、偏好恢复、旧模型兼容。
- 人工验收：普通版/VIP 选择 4K，比例应从自动变为 1:1；请求应保留模型名且携带 `size: 2880x2880`。改成 16:9 应发送 `3840x2160`；分辨率及比例均选自动时才省略 `size`。刷新后 4K 与比例仍应保留。
- 未运行页面交互、构建和计费生图；真实上游输出尺寸仍待验收。测试中的 IndexedDB 后台写入日志不代表持久化已验证。

2026-09-19 VIP 分辨率补充及最终回归：

- VIP 新增扩展比例与 1K/2K/4K，保留四档画质和请求模型名；1k 型号维持固定尺寸。
- Node 直接运行实际尺寸解析器，10 项 VIP 生成、编辑、画质及 1k 兼容断言通过。
- 当前依赖已可用。在 `packages/drawnix` 下使用 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run` 执行 `model-config.test.ts`、`image-size-quality-resolver.test.ts`、`tuzi-gpt-image-adapter.test.ts`、`ai-generation-preferences-service.test.ts`：4 个文件、79 项测试全部通过。
- 初次偏好测试受 Node 26 原生 localStorage 影响而失败，使用上述单次环境变量后解决；修正上一轮 21:9 测试预期，保留实际 `size: 21x9` 和旧图片工具的 `aspectRatio: auto` 行为。
- 测试环境仍输出缺少 IndexedDB 的后台写入日志；数据库持久化不在此次验证覆盖内。
- `git diff --check` 通过；DOC 已同步，未做页面测试、构建及真实生图验证。

2026-09-19 普通 `gpt-image-2.5` 参数对齐：

- 前置约定：后端将该模型映射至 Sunburst/Flare；客户端保留原模型 ID。
- 使用 Node.js 26.8.1 的 `stripTypeScriptTypes` 和 `node:vm` 加载实际尺寸解析器及模型分组，19 项断言通过：普通型号与 Sunburst/Flare 的 1K/2K/4K、编辑尺寸、最高画质一致；1k/vip 型号仍过滤扩展尺寸和最高画质。
- `git diff --check` 通过。
- 已更新配置、尺寸解析、请求体、偏好存储测试；执行 `pnpm exec vitest run` 加上述四个测试文件时因当前目录缺少 Vitest 而未运行，完整回归尚未验证。
- 未执行页面测试、构建和真实生图请求；后端映射依据用户确认，实际输出尺寸待具备运行环境后验证。
- 人工验收：普通型号选择 2K + 1:1 时应发送 `size: 2048x2048`，选择 4K + 16:9 + max 时应发送 `size: 3840x2160`、`quality: max`，模型名均保持 `gpt-image-2.5`。

本次实现已覆盖：

- 模型配置与可见性测试
- Sunburst/Flare 扩展比例、1K/2K/4K 和 `xhigh`/`max` 画质测试
- GPT Image 2.5 请求尺寸过滤测试
- 比例到尺寸偏好迁移测试
- 运行时模型发现测试
- GPT Image 尺寸解析测试
- GPT Image 2.5 从 adapter context 到 Provider Transport 的直连组合测试
- 普通节点移除 `X-Request-Id`、兼容节点保留该头的边界测试
- 单次提交、刷新后直连原节点及同 Request ID 有界恢复测试

2026-09-14 本次增量自动化结果：

- 模型配置、尺寸解析、Tuzi 请求体、运行时发现和图片巡检：`103/103` 通过；
- Drawnix TypeScript 类型检查通过；
- `git diff --check` 通过。

## 2026-09-20 GPT Image 2.5 的 2K 计费边界修正

- 本节替代历史记录中的 2K 尺寸预期。普通、VIP、Sunburst、Flare 的 2K 使用独立尺寸表；固定 1k、image-2、自动、1K、4K 和画质逻辑不在本次尺寸变更范围内。
- 依据用户提供的审计表达式，2K 总像素须大于 1,048,576 且不超过 3,686,400。1:1 为 1920x1920，4:5 为 1664x2080，完整表见接入说明。
- Tuzi 请求体测试覆盖四个模型的全部十种比例：精确比例、宽高为 16 的倍数、总像素上下界、medium 原样传递、自动比例和旧方图尺寸被 2K 档覆盖。尺寸表不包含表达式中的 1K 特殊白名单尺寸。
- 命令（packages/drawnix）：`NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/constants/__tests__/model-config.test.ts src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts src/services/__tests__/tuzi-gpt-image-adapter.test.ts src/services/__tests__/ai-generation-preferences-service.test.ts src/services/__tests__/gpt-image-adapter.test.ts --silent --testTimeout=15000`。
- 结果：129 通过、2 超时。前四个测试文件全通过；gpt-image-adapter 的 stale task model alias、model_not_found 重试用例超时，未修改其业务逻辑，未确认基线结果，不能宣称全套通过。
- `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json` 通过。未执行页面测试、构建或真实付费生图；实际接口对新尺寸的接受及最终账单仍待验证。
- 已同步旧偏好测试：恢复 4K 后不再断言降为 2K，已移除的 billing-1k 偏好回退自动。不新增配置、依赖或迁移；未提交或推送。

## 2026-09-20 GPT Image 2 的 2K 增量调整

- 普通、VIP 及其无连字符别名的 2K 比例映射复用计费安全尺寸表，覆盖生成和编辑；不修改 Image 2 的 1K/4K、自动、合法显式像素尺寸、画质或固定 `gpt-image-2-1k` 行为。此前 Image 2.5 改动保留。
- 回归覆盖四个模型的全部十种比例、精确比例、16 倍数、总像素上下界，以及固定 1K 模型不进入新覆盖逻辑。JSON 生成与 Tuzi 编辑请求同步验证新尺寸。
- 命令（packages/drawnix）：`NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts src/services/__tests__/gpt-image-adapter.test.ts src/services/__tests__/tuzi-gpt-image-adapter.test.ts src/constants/__tests__/model-config.test.ts --silent`。
- 结果：105 通过、2 超时；超时仍为上节列出的 stale task model alias 和 model_not_found 重试用例，未重新执行修改前基线，不能宣称全套通过。
- 根目录 `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json` 与 `git diff --check` 通过。未运行构建、lint、页面测试或真实付费生成，服务端尺寸接受情况和最终账单待验证。
- 现有接入说明已补充共享适配器影响；无需新增配置、依赖或迁移。仅本地修改，未提交或推送。

2026-09-10 自动化结果：

- Provider 路由、Tuzi GPT Image adapter 与图片恢复服务：`174/174` 通过；
- Provider 路由最终回归：`114/114` 通过；
- Drawnix TypeScript 类型检查通过；
- `git diff --check` 通过。
