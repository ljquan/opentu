# GPT Image 2.6 1K 接入验收

本文按时间保留各阶段记录。当前四型号适配范围与提交前检查以文末“GitHub 提交前最终验证（2026-11-08）”为准；前文的“仅 -1k”“未提交”等描述属于对应阶段。

日期：2026-11-05（Asia/Shanghai）。基线：develop `f6a3e0cf`；实现分支：`codex/add-gpt-image-2-6-1k`。

## 实现范围

- 注册精确型号及完整元数据，型号简码 `gpt261k`；默认模型保持不变。
- 新型号单独分类，不继承 GPT Image 2/2.5、Gemini 的分辨率或画质参数。尺寸反馈复测后，界面支持自动、1:1、2:3、3:2、16:9、9:16；GIF 动效可用提示词描述。
- GPT、Tuzi、基础兼容路径均隔离旧参数，保留用户选择的已验证尺寸（默认 `auto`），固定单次请求 `n=1`、`response_format=b64_json`。用户的批量任务仍由现有任务队列调度；不改写为 2.5 或切换供应商凭证。
- 解析时按文件签名保留 GIF/SVG 格式，修正错误的 PNG MIME 提示；拒绝内部 sandbox 链接和非媒体内容，并保留可用 URL 回退。
- 旧单文件下载入口复用原文件缓存下载，避免服务工作线程不可用时将 HTML 页面保存为图片。
- 未新增持久化字段、数据库变更、依赖或默认计费配置。

## 真实接口验证

使用参考聊天中用户指定的 Tuzi 接口和型号；凭证未写入代码、提交内容或本报告。

| 项目 | 结果 | 证据与边界 |
|---|---|---|
| 静态生图 | HTTP 200 | 返回真实 PNG，1254×1254；实际尺寸不等于型号后缀中的 1k |
| Tuzi JSON 参考图编辑 | HTTP 200 | 输入蓝色圆形，返回红色圆形 PNG，1254×1254 |
| Multipart 参考图编辑 | HTTP 200 | 使用应用构建的 model/prompt/response_format/size/n/image[] 表单字段发送 `/v1/images/edits`，返回图片并经应用解析；未据此宣称所有蒙版功能均已实测 |
| 浏览器界面 GIF 生成 | HTTP 200 | 从实际输入栏提交，返回 GIF89a，357×357，12 个不同帧，305466 字节 |
| SVG 生成 | **未通过，上游限制** | HTTP 400，`accepted=true`、`retryable=false`，错误内容只有 `sandbox:/mnt/data/…svg` 内部链接，没有可下载文件。客户端显示失败原因，不把请求标记为成功 |

参考聊天此前生成的 9 张 GIF 亦有不同尺寸和帧率，因此文案不承诺 GIF 固定为 553×309 或固定帧率。内部链接不能用于浏览器直接下载，也不应通过切换模型掩盖失败。

本轮共发起 6 次图像接口测试请求，其中另一次浏览器 multipart 验证因开发服务器热更新被中断，未计入通过；其上游最终结果未知。未查询实际账单，不推算总费用。

## 浏览器验证

在独立 Chromium 会话中运行当前 Vite 应用，测试设置与用户浏览器隔离。

- 模型列表显示新型号及渠道说明；初轮只有“自动（原始尺寸）”，尺寸复测修正见末节；刷新后模型选择保持。
- 初轮自动尺寸的实际网络请求只包含当前型号、提示词、`response_format=b64_json`、`size=auto`、`n=1`，未携带旧 4K、质量或 PNG 强制输出参数。
- 实际 GIF 入画布，浏览器读取的自然尺寸为 357×357；两次画布图片截图内容不同，证明动画在播放。
- GIF 以 `image/gif` 和 `.gif` 存入本地缓存；刷新恢复后仍可解码和显示。
- 正式下载入口按实际格式修正过时的 `.png` 文件名，下载内容与缓存 GIF 逐字节一致。
- 修复后的旧单文件下载入口也读取相同原文件，不下载 HTML。
- SVG **使用本地测试样本**验证响应解析、`image/svg+xml`、缓存、画布、刷新和下载，字节保持一致；图片内的测试脚本未执行。该测试不等同于上游 SVG 生成成功。
- 验证过程中未观察到未捕获的浏览器异常。

## 自动化检查

- 初轮 11 个相关 Vitest 测试文件，**459 项通过**；尺寸修正后同范围 **472 项通过**：模型配置、参数解析、GPT/Tuzi/基础适配器、供应商路由、媒体缓存、下载和画布尺寸。
- `tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 修改的业务文件与新增集成测试的 ESLint 检查：无错误；Nx 提示没有缓存 ProjectGraph，因此模块边界规则被跳过。
- `vite build --config apps/web/vite.config.ts`：通过；仍有既有 Sass 弃用及大 chunk 提示。
- `openspec validate add-gpt-image-2-6-1k --strict` 与 `git diff --check`：通过。

测试中补充了 jsdom Blob 的 FileReader 读取路径，避免环境缺少 `Blob.arrayBuffer()` 导致字节一致性用例误报。旧适配器的伪 base64 测试样本改为真实 PNG，以符合新增的无效响应检查。

## 上线边界

图片、参考图编辑、GIF 已有真实接口证据。有效 SVG 的客户端链路已验证，但当前供应商尚未返回可下载 SVG；只有渠道修复并通过真实生成回归后，才能在产品描述中承诺 SVG 生成可用。

## 容量错误复测（2026-11-05 15:30–15:39，Asia/Shanghai）

用户反馈静态图失败、GIF 可用。使用原指定渠道、相同凭证和精确型号，额外发起 7 次真实请求，复现了 HTTP 429：`error.code=image_request_capacity_exceeded`、`error.type=new_api_error`、`image request disk budget exceeded`。

| 路径 | 结果 |
|---|---|
| 直接 API，普通静态猫咪图片 | HTTP 200，PNG 1254×1254 |
| OpenTu 实际输入栏，同提示词、无参考图，第一次 | HTTP 429，磁盘预算超限；上游请求 ID `202611050733366911797638268d9d6NdSkJ4Ci` |
| OpenTu 实际输入栏，同场景 GIF | HTTP 200，GIF 439×390，9 帧；已入画布并从原始 blob 取回验证 |
| 直接 API，相同静态提示词，加 `ch=2` 和独立 `X-Request-Id` | HTTP 200，PNG 1402×1122 |
| 直接 API，相同静态提示词，加 `ch=2`、不带 `X-Request-Id` | HTTP 200，PNG 1254×1254 |
| OpenTu 已选中 GIF 时的参考图编辑 | HTTP 200，PNG 1254×1254；此轮实际采用参考图重绘提示词，单独计为编辑，不纳入相同提示词对照 |
| OpenTu 取消图片选中后，同静态提示词、无参考图，再次生成 | HTTP 200，PNG 1230×1278，已显示在画布 |

静态图两次实际 UI 请求的 URL、模型、提示词、参数及凭证一致，独立任务的请求 ID 不同；期间没有改动业务代码或请求参数。失败来自生成接口的错误响应，发生在客户端图片解析、缓存和展示之前。现有证据支持服务端容量/资源状态导致间歇性失败，不能据此断言具体节点磁盘已满、GIF 享有特殊配额，或静态生图完全不可用。需要渠道方按上述请求 ID 检查实际磁盘预算、预留容量和节点状态。没有移除恢复请求头或新增自动重发来掩盖错误。

GIF 的 DevTools 响应体旁路采集曾失败，应用正常完成；验证依据为实际画布中的原始 GIF blob。详细脱敏请求摘要、失败响应与画布截图保存在本地 `gpt-image-26-retest` 证据目录，未提交图片、凭证或临时响应文件。

### 远程 CI 状态补充

PR #325 的首次 GitHub CI（run `41979472011`）失败：Drawnix 全量测试 56 项失败、3931 项通过、2 项跳过，另有 1 个未处理错误；新增 2.6 集成测试 21 项通过。本报告此前的 459 项通过是相关范围测试，不代表全量 CI 通过。尚未完成与 develop 基线的失败对照，不能将所有远程失败归为既有问题；PR 在该问题查明前不应视为已通过完整合并验收。

## 显式尺寸补测与修正（2026-11-05，Asia/Shanghai）

用户指出缺少尺寸选择。初版只测试了 `auto` 并将所有尺寸覆盖为 `auto`，验证不足；自动尺寸成功不能证明渠道不支持显式尺寸。此轮增加 7 次真实请求，修正过度限制：

| 请求与路径 | HTTP | 实际媒体 |
|---|---|---|
| 静态图 `1536x1024` | 200 | PNG 1536×1024 |
| 静态图 `1024x1536` | 200 | PNG 1024×1536 |
| 静态图 `1024x1024` | 200 | PNG 1254×1254，像素没有严格匹配请求 |
| 静态图 `16x9` | 200 | PNG 1677×938，接近所选比例 |
| 静态图 `9x16` | 200 | PNG 941×1672，接近所选比例 |
| GIF `1536x1024` | 200 | 多帧 GIF 508×337，保留原始媒体，不拉伸到请求像素 |
| 实际 OpenTu 界面选择 2:3 竖版 | 200 | 网络请求 `size=1024x1536`，PNG 1024×1536 正常入画布；刷新后选择仍保持 |

前五个静态请求使用完全相同、不含比例要求的提示词。当前界面开放自动、1:1、2:3、3:2、16:9、9:16，展示比例而不承诺固定像素；GIF 建议使用自动尺寸。GPT、Tuzi、基础兼容适配器及 multipart 编辑表单保留已验证的尺寸，不再统一覆盖为 `auto`。未验证的 2K/4K、画质档位继续不开放，未新增持久化字段。

修正后 11 个相关测试文件 **472 项通过**，包括显式尺寸、比例别名、遗留 4K 参数隔离、两条 multipart 编辑路径及基础兼容路径；类型检查、生产构建通过，ESLint 无错误（保留既有警告，Nx 模块边界规则因没有缓存 ProjectGraph 被跳过）。远程全量 CI 状态与上述本地范围验证独立，不能据此宣称 CI 已修复。

本地 `gpt-image-26-size-probe` 证据目录包含逐次接口响应、原始图片、尺寸菜单截图、画布截图和 `ui-validation.json`；没有将密钥或生成产物提交至仓库。

## Flare / Sunburst 型号补齐（2026-11-08，Asia/Shanghai）

依据用户提供的渠道截图，在既有 2.6 适配中补齐精确型号 `gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`。保留 `-1k` 与当前默认模型。扩展统一型号列表，使新型号复用请求归一化、自动/比例尺寸、生成与编辑路径，避免落入 Gemini 参数组或继承其他型号的画质、格式及 4K 配置。不新增接口、持久化字段、依赖或部署步骤。

使用方式：在图片模型选择中选择对应型号，实际可用性取决于所选供应商及当前 API Key 权限。保留原模型 ID 和供应商绑定，不改写为 `-1k`。default / Codex 分组的 GIF 按截图通过提示词触发。SVG 支持依分组而异；本轮没有官方分组 GIF 参数或 SVG 请求合同，未增加相关输出格式控件，也不宣称已验证分组能力。新型号沿用现有尺寸选项，实际上游接受情况尚待实测。

本轮本地验证（macOS、Node.js 26.8.1、pnpm 10.21.0）：

- 2.6 参数化集成与尺寸解析：2 文件、147 项通过，覆盖三个型号的目录/参数分类、遗留配置隔离、生成、multipart 编辑、供应商绑定、GIF/SVG 返回解析和上游拒绝；使用模拟响应。
- GPT、Tuzi、基础适配器与供应商路由回归：4 文件、238 项通过。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 变更的两个 TypeScript 文件 ESLint：0 错误、3 条既有警告（未用常量、非空断言、恶意 URL 测试夹具）。
- `git diff --check`：通过。
- 测试存在 localStorage / indexedDB 初始化警告和 Node 弃用提示，未导致上述用例失败，不能据此验证真实浏览器存储。
- 未执行真实供应商调用、收费生图、分组 GIF/SVG 能力测试、页面测试、生产构建、远程 CI 或部署。上文 `-1k` 的实测结果不代表新型号已实测。

QA/DOC 沿用本文件，不新增根目录文件。回退本轮型号配置可撤回新入口，不涉及数据迁移。本轮未提交或推送。

## GIF / SVG 输出协议补齐（2026-11-08，Asia/Shanghai，最终状态）

用户补充 Sunburst 渠道详情截图，确认 `/v1/images/generations` 的两种 GIF 协议与官方分组 SVG 协议。本节记录补齐后的最终实现与验证，替代上一节本日型号配置补齐时的验证边界；不将旧 `-1k` 的实测结果套用到新型号。

### 使用与实现

- Flare / Sunburst 参数面板提供“自动”“GIF（提示词）”“GIF（官方参数）”“SVG（官方分组）”。选择不会切换令牌、供应商或分组；提示词 GIF 对应 default / Codex，参数 GIF 与 SVG 需官方 / 官方优惠分组令牌。前端未自动探测分组权限。
- 提示词 GIF：仅在提交时补充一次“生成 GIF 图”要求，不发送 `output_format` 或 `frame_count`。原始任务提示词不变，重复归一化不会追加多次。
- 官方 GIF：发送 `output_format=gif`；高级选项中可填正整数 `frame_count`，留空省略该字段，使用渠道默认值。没有根据示例中的 9 帧推断其他上下限。
- SVG：发送 `output_format=svg`、`svg.model` 和 `stream=false`。高级选项默认 SVG 编写模型为渠道示例的 `gpt-5.5`；其他模型需用户自行确认上游支持。
- 原 `-1k` 提供自动与提示词 GIF，不推定支持新截图中的官方参数协议。
- 官方参数 GIF / SVG 本轮仅接入文字生图；参考图、蒙版或编辑模式在提交前明确拒绝，未宣称这些格式的编辑接口支持已被确认。静态图与原有编辑路径保留。
- 复用现有任务 `params` 保存输出意图和格式选项，默认 `auto`；历史任务无这些参数时沿用原行为，不新增数据库字段或迁移。队列拆分出的每条任务保留选项，单次请求仍为 `n=1`，未更改并发或恢复期限。
- GPT、Tuzi 和基础兼容路径均保留所选供应商、精确型号及格式字段。修正主线程基础兼容执行分支绕过 2.6 归一化而丢失格式参数的问题。内部 UI 选项不直接发送到上游。
- 返回处理继续复用现有 GIF/SVG 字节与 MIME 解析、缓存、预览和原文件下载。显式选择 GIF/SVG 后收到其他格式时报告 `IMAGE_OUTPUT_FORMAT_MISMATCH`，适配器不自动重新提交；不把 PNG 标为 GIF 成功。本轮未改动缓存、画布或下载模块。

### 实际验证

- 本地 macOS / Node.js 26.8.1 / pnpm 10.21.0；10 个测试文件 **535 项通过**：2.6 集成与输出协议、GPT/Tuzi/基础适配器、路由、主线程执行器、尺寸解析、参数组件交互、工作流队列参数透传。最后文案和 GIF 前缀调整后，受影响的 3 文件 **57 项再次通过**。
- 以上使用模拟响应；组件交互使用 jsdom。覆盖成功返回、格式不符、非法帧数、未接入编辑模式的提交前拦截、供应商保持、遗留参数隔离、重复归一化和旧型号回归。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- `pnpm exec vite build --config apps/web/vite.config.ts`：通过（41.28 秒）；保留既有 Sass 弃用及大 chunk 提示。
- 8 个变更业务/协议文件 ESLint：2 错误、19 警告。两错误位于 `gpt-image-adapter.ts`、`default-adapters.ts` 已有的 `@aitu/utils` 静态导入，报 `@nx/enforce-module-boundaries` 的 lazy-loaded library 约束。分别用 `git show HEAD:<path>` 通过 ESLint stdin 核对，修改前同一位置同样各有 1 错误；本轮未扩大修复范围。未将此检查表述为通过。
- `git diff --check`：通过。7205 根地址 HTTP 200，本地开发服务保持运行。
- 未执行：真实/收费供应商调用、新型号实际动画帧检查、官方分组权限、实际 GIF/SVG 生成功能、页面/浏览器测试、远程 CI、部署。存储初始化警告与 Node 提示仍出现在模拟测试中，不能据此宣称真实浏览器存储已验证。

QA/DOC 更新本文件及现有变更说明、规格，无新根目录文档、依赖或配置迁移。回退本轮输出参数与协议改动即可撤回入口；无数据库回滚。代码仅保存在本地，未提交、推送或创建 PR。

规格验证补充：尝试 `openspec validate add-gpt-image-2-6-1k --strict`，本机返回 `command not found: openspec`，因此本轮规格严格校验未完成；未安装额外 CLI。此项与上文历史轮次的通过结果独立。

## 官方分组 Key 的真实接口验证（2026-11-08 11:03，Asia/Shanghai）

用户明确提供官方分组 Key 并授权测试。本轮通过当前应用 Tuzi GPT 图片适配器的实际请求构建、传输和响应解析链路调用 `https://api.tu-zi.com/v1`，使用 Sunburst 进行官方 GIF、SVG 各 1 次生成测试；另进行 1 次只读 `/v1/models` 检查。没有浏览器页面交互，没有配置或替换用户浏览器中的凭据，也没有将 Key 写入仓库、测试源码或输出记录。

| 项目 | 实际结果 | 耗时与说明 |
|---|---|---|
| `GET /v1/models` | HTTP 200 | 返回列表包含 `gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`；仅证明认证及模型可见，不等同于生成渠道可用性验证 |
| Sunburst 官方 GIF | HTTP 400，`service_error` | 约 21 秒；请求包含 `output_format=gif`、`frame_count=9`、`n=1`、`response_format=b64_json`、`size=auto`；返回“服务暂时不可用，请稍后重试” |
| Sunburst 官方 SVG | HTTP 400，`service_error` | 约 2 秒；请求包含 `output_format=svg`、`svg.model=gpt-5.5`、`stream=false`、`n=1`、`response_format=b64_json`、`size=auto`；返回“服务暂时不可用，请稍后重试” |

接口请求 ID（以响应头为准）：

- GIF：`202611080303284834930128268d9d6DmUxegi7`
- SVG：`202611080303492221444378268d9d61A5KQqUh`

共发出 **2 次生成 POST**，没有自动重试，没有生成可用媒体文件。没有实际 GIF 帧数、动画播放、SVG 内容或原文件下载成功证据；没有实测 Flare，也没有测试参考图编辑。未读取账单，因此不推断本轮是否扣费。通用错误没有指出具体字段或原因，不能据此断定是模型不支持、Key 分组不符或某个参数错误，需使用请求 ID 结合服务端日志定位。

初次测试运行受到 jsdom 与 Node 原生 fetch 的 AbortSignal 类型差异阻断，在 RequestInit 校验阶段失败，**没有发出网络请求**；改用 Node 测试环境后才执行上述两次实际 POST。临时付费测试文件已移除，后续常规单测不会执行这些真实调用。

脱敏证据保存在本地可视化工作目录的 `gpt26-official-20261108-s3bu9544/summary.json` 与 `model-access.json`，未提交生成记录、凭据或其他敏感信息。之前“未执行真实接口验证”的描述仅对应此前阶段；本节为真实接口验证的最新状态，结果仍为未通过。业务代码没有因通用 `service_error` 而调整请求协议。

## 上游参数错误定位与修复（2026-11-08，官方日志补充）

用户提供服务端日志截图：官方渠道上游返回 HTTP 400，错误码 `unknown_parameter`，错误类型 `invalid_request_error`，明确提示 `Unknown parameter: 'response_format'`。这证明官方兼容请求存在具体的参数拒绝问题；此前客户端仅收到通用 `service_error`，不能将其直接归因为临时服务故障。截图请求 ID 与本文件此前两条测试的响应头 ID 不同，未将截图当作两条历史请求的完整日志关联证据。

实现更正：原归一化逻辑将 `response_format=b64_json` 固定用于所有 2.6 型号，这是兼容性错误。现对 Flare / Sunburst 的自动、提示词 GIF、官方参数 GIF、SVG 以及编辑请求统一省略此字段，包括任务保存的遗留值。前端不能根据型号判断令牌所属分组，因此不能只修正官方 GIF/SVG 两个选项。原已验证的 `-1k` 渠道继续保留 `response_format=b64_json`；其他 GPT 型号不受本轮修改影响。

`output_format=gif/svg` 与 `response_format` 是不同字段，本轮保留文档明确要求的 `output_format`、`frame_count`、`svg.model`、`stream=false`。响应继续按真实内容解析 Base64 或 URL；省略请求字段不代表放弃读取 `data[].b64_json`。

本轮本地验证：

- GPT 2.6 集成、输出协议、GPT/Tuzi/基础适配器共 5 个测试文件 **247 项通过**。覆盖继承的 `response_format` 被清除、自动模式、两种 GIF 路径、官方 SVG、编辑请求、重复归一化、Base64 GIF/SVG 解析及 `-1k`/其他 GPT 型号回归。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 本轮修改的 4 个 TypeScript 文件 ESLint：0 错误、2 条既有测试警告（非空断言、恶意 URL 夹具）。
- `git diff --check`：通过。7205 开发服务可访问。
- 未追加收费或真实生成请求，未进行浏览器页面测试，未重复生产构建；此前失败的真实生成结果没有因此改记为成功。还需真实接口复测确认移除字段后是否存在其他上游限制。

QA/DOC 沿用本文件；未提交、推送或部署。

## SVG 编写模型下拉选择（2026-11-08）

用户确认将手动填写 `svg_model` 改为可搜索模型下拉，并保留自定义 ID。最终实现复用项目已有 TDesign Select 和运行时供应商模型目录：

- 在 SVG（官方分组）的高级功能中，搜索模型 ID 或名称并选择文本模型；输入列表外 ID 后选择创建选项，也可用方向键/Enter 确认。
- 候选来自当前生图供应商已加载目录中的文本模型，合并目录与发现结果并按精确 ID 去重；不把图片模型或其他供应商的模型混入列表。模型目录可见不证明 SVG 编写接口一定接受，控件保留此能力边界说明。
- 控件不修改模型目录、不触发额外模型发现请求、不切换供应商或凭据。当前目录为空时仍可使用已保存值和自定义 ID；若供应商目录更新，候选随现有订阅更新。
- `svg_model` 继续作为原有字符串参数传递，无新的请求字段或数据库迁移。默认仍为 `gpt-5.5`；切换供应商不会无故重置当前值，即使该值暂未出现在新目录中也作为当前值保留。
- 参数面板增加可选的 `modelRef`，主输入框、聊天生成控制、单图/批量生图及复用该面板的漫画、MV、视频分析图像入口传入实际模型归属，保证候选对应同一生图供应商。
- 下拉浮层挂在参数面板内部，采用固定定位避免被滚动区域裁切；选项点击不触发外层关闭，输入/选择键盘事件不冒泡到参数面板快捷键。

验证：

- `SvgWriterModelSelect.test.tsx`、参数面板、工作流转换、2.6 输出协议与集成共 **5 文件、232 项通过**。覆盖供应商隔离、文本模型筛选、重复目录条目、名称搜索、鼠标选择、自定义 ID、空目录、供应商切换、键盘确认、禁用态、外层面板保持和任务/请求参数透传。
- TypeScript 检查：`pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 通过。
- 新选择组件及参数面板的 4 个 TS/TSX 文件 ESLint：0 错误，3 条既有警告（原面板未使用导入、Hook 依赖、原测试 Fragment）。
- `pnpm exec vite build --config apps/web/vite.config.ts`：通过，49.49 秒；保留既有 Sass 弃用和大 chunk 提示。
- `git diff --check` 通过，7205 HTTP 200。
- 键盘测试使用 jsdom，补齐其缺少的 `HTMLElement.scrollTo` 测试桩并在测试后恢复；最终运行没有未捕获异常。已有 localStorage / IndexedDB 初始化、Browserslist 和 Node 提示不影响测试通过。
- 未进行页面/浏览器测试、真实或收费接口调用，也未验证其他 SVG 编写模型的渠道可用性；本轮没有修改生图请求协议。

QA/DOC 更新现有记录与规格，不新增根目录文档。改动保留在本地，尚未提交、推送或部署。

## SVG 候选列表错误修正（2026-11-08，最新状态）

用户截图发现 SVG 编写模型下拉列出了 `AiHubmix-Phi-4-mini-reasoning`、`AiHubmix-mistral-medium` 等通用文本模型。根因是上一节实现将当前供应商的通用文本目录作为 SVG 候选来源；模型目录存在某型号不能证明 SVG 编写接口接受该型号，给所有通用模型提供候选入口会误导用户。

最终更正：下拉自动推荐仅使用渠道说明明确给出的 SVG 编写型号，目前为 `gpt-5.5（渠道示例）`。不从通用文本目录自动推断 SVG 能力，不按 GPT、Mistral、Phi 等名称或厂商猜测支持范围。保留搜索与自定义 ID 创建、已保存的自定义值；自定义项标记“自定义，未验证”，不会擅自替换用户旧选项。渠道示例仍不等同于本轮已通过真实生成验证。

选择组件不再依赖供应商模型目录，上一节为查目录增加的 `modelRef` 参数与 7 处入口传递已撤回，仅移除本任务新增内容。仍通过原有 `svg_model` 字符串发送 `svg.model`，不变更生图型号、供应商、Key、请求协议、存储或任务并发。

本轮验证：选择组件、参数面板及 2.6 输出协议共 3 文件 **57 项通过**，覆盖推荐项、自定义值保留、搜索与创建、方向键/Enter、禁用态、外层面板保持及请求参数透传。TypeScript 检查通过；变更的 3 个 TS/TSX 文件 ESLint 0 错误、2 条既有面板警告；`git diff --check` 通过。无新收费请求、无页面测试，本轮未重复生产构建。QA/DOC 和规格以本节为最新状态，原 232 项测试及构建结果属于前一实现阶段。代码尚未提交、推送或部署。

## SVG 画布现场恢复与补插防重（2026-11-08）

用户反馈 localhost:7205 的 SVG 任务已有预览，但画布占位仍为“正在显影”。本轮复用用户已经生成的任务 `83cb1ed7-289e-4000-ab32-2b5ffd04cd14` 诊断，没有提交新的生成请求、重新计费、清理缓存或修改凭据。

### 现场证据及恢复边界

- 任务使用 `gpt-image-2.6-flare`，SVG 编写参数为 `gpt-5.5`，状态为 completed。原文件已在 `drawnix-images` 缓存中，29293 字节、`image/svg+xml`，尺寸 1312×1199。XML 解析和浏览器 Blob 解码成功；未发现 script、foreignObject 或外部资源引用。这是该既有 Flare 任务的有效 SVG 证据，不代表所有型号或编写模型均已验证。
- 最初持久化画板只找到关联占位，没有该任务的结果图片，任务也未标记 insertedToCanvas。异常位于生成完成后的插入/状态同步链路，不能归为 SVG 文件丢失或浏览器不支持 SVG。
- 开发热更新期间观察到多个带不同版本查询串的任务队列、工作区服务实例，任务集合不一致。但诊断性动态导入也可能产生额外实例；刷新后仍未立即恢复，因此没有将热更新确认为最初卡住的唯一根因，也没有改造全局单例或宣称首次自动插入问题已彻底解决。
- 通过该已完成任务的“插入”操作复用原缓存，随后画布显示 SVG，“正在显影”消失，任务标记为已插入，图片自然尺寸为 1312×1199。恢复操作同时触发了自动插入，现场确认出现一个关联原占位的结果及一个手动副本；仅撤回本轮诊断产生的手动副本，保留原位置的结果。没有触碰 7200 站点或其他生成任务。

### 本地修补

确认的相关竞态是：手动插入期间更新任务结果会发出完成态更新，自动插入将旧任务对象放入分组缓冲；手动操作稍后写入 insertedToCanvas，缓冲执行时却没有重新检查，导致重复入画布。

在 `useAutoInsertToCanvas` 的缓冲执行入口读取最新任务的 insertedToCanvas；已插入则释放本次预留并记录完成，不再插入，也不阻塞同组其余结果。没有改变 SVG 请求、文件、尺寸、渲染器、缓存协议或存储结构。此修补针对已确认的补插防重竞态，不作为最初自动插入卡住的完整根因修复证明。

### 实际验证

- 新增 4 项用例：SVG/GIF/PNG 在排队后手动完成插入时跳过旧快照；同组其余图片继续正常插入。修补前 4 项均失败，修补后通过。原 LRU 用例同步更新模拟队列状态，使事件与实际存储一致。
- `pnpm exec vitest run --config vitest.config.ts src/hooks/__tests__/useAutoInsertToCanvas.test.ts src/hooks/__tests__/useImageGenerationAnchorSync.test.ts src/services/canvas-operations/canvas-insertion.test.ts src/plugins/components/image.loading.test.tsx`（packages/drawnix）：**4 文件、100 项通过**，包括成功、失败、超时、画板切换、恢复和既有替换行为。
- 扩展运行 `src/data/image.test.ts`：13 项通过、1 项失败。失败为“缓存图片解码失败时回退到生成接口返回的原始地址”的测试断言调用 Blob.arrayBuffer()，当前 jsdom Blob 无该方法；该用例单独运行仍失败，image.ts 和 image.test.ts 均与 HEAD 无差异。本轮没有修改此环境/夹具问题，也不声称扩大范围全部通过。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 本轮 Hook 和测试文件 ESLint：0 错误、44 条警告；`git diff --check`：通过。
- 浏览器仅针对该既有结果做诊断及恢复确认；恢复截图保存在本地临时证据文件，不提交用户图片。没有追加收费生成、完整页面回归、生产构建、远程 CI、部署或其他浏览器验证；防重修补的验证依据为上述自动化用例。

QA/DOC 沿用本文件，无新根目录文档或配置迁移。改动仅在本地，未提交或推送。

## 官方 GIF 48 帧实测（2026-11-08 12:10，Asia/Shanghai）

用户明确要求测试 48 帧。本轮使用 localhost:7205 已配置的 `tuzi-origin` 凭据，仅向 `https://api.tu-zi.com/v1/images/generations` 发出 **1 次 POST**；通过当前应用的 `buildTuziGPTImageRequestBody` 构建请求。型号为 `gpt-image-2.6-sunburst`，请求包含 `output_format=gif`、`frame_count=48`、`size=auto`、`n=1`，未包含 `response_format`。提示词要求湖边成年女性转头、头发飘动，约 2 秒、48 个连续帧；使用文字生成，没有参考图或蒙版。

- 接口 HTTP 200，约 29.78 秒返回 Base64 GIF。客户端请求 ID：`6390f490-6a9d-469a-9091-c3de501cef27`；浏览器未取得响应头请求 ID，不将客户端 ID 冒充服务端 ID。
- 原始媒体为 GIF89a、512×512、1219954 字节，**实际只有 9 帧**。Pillow 逐帧解码确认 9 个完整帧哈希均不同，非同一帧重复计数；每帧停留 200 毫秒，总时长 1800 毫秒，名义帧率 **5 fps**，无限循环。
- 因此，本次接口生成成功，但“48 帧输出”验收未通过。确实发送 48 帧参数且提示词也要求 48 帧，输出仍为 9 帧；现有证据不能区分渠道忽略、限制或上游覆盖参数，也不能推断所有型号必定固定 9 帧。没有追加 Flare 或其他帧数测试。
- 原文件、脱敏请求结果、逐帧分析和接触表保存在本地可视化目录 `gif48-20261108/`，不提交用户生成图片或凭据。测试结果单独保存，没有加入用户画布、修改模型偏好或重试生成。未查询账单，不推断实际扣费。

本轮未修改业务代码，仅补充真实测试记录；不使用此前单测或构建结果替代本次渠道实测结论。

## 无后缀 gpt-image-2.6 适配（2026-11-08）

用户提供模型列表截图并要求适配精确 ID `gpt-image-2.6`。该 ID 此前没有注册在 2.6 图片模型列表内，截图显示通用 GPT 文本家族说明；现补齐图片类型、名称、简码 `gpt26` 及渠道能力边界说明。

### 最终实现与兼容性

- 将无后缀型号纳入共享 2.6 列表，自动复用尺寸、自动输出、提示词 GIF、官方参数 GIF/SVG 的现有入口与请求归一化。清理旧画质、分辨率、response_format 等遗留参数；实际请求保持 `gpt-image-2.6` 和用户所选供应商，不改写为 Flare、Sunburst 或 2.5。
- 默认尺寸为 auto，可选择已有 1:1、2:3、3:2、16:9、9:16 比例。输出按实际媒体格式和尺寸处理。官方参数请求及 SVG 编写模型沿用既有字段；前端提供参数不代表该无后缀型号的渠道能力已通过真实验证。
- 运行时发现将已注册 2.6 图片类型置于通用文本分类之前。自动保存的 marketplace / models-endpoint 目录恢复时同步更新图片元数据和说明，保留选择项与供应商归属，不需要额外网络请求；明确标记 manual 的配置继续保留。此次修正限定为已注册的精确 2.6 型号，不扩展未知后缀或改写其他模型的远程分类规则。
- 两个业务文件为 model-config.ts 和 runtime-model-discovery.ts；参数组件、GPT/Tuzi/基础兼容适配器和队列均通过共享型号规则复用，没有新增数据库字段、依赖、配置或凭据。

### 实际验证

- 在 packages/drawnix 运行 Vitest：gpt-image-26-integration、gpt-image-26-output、default-image-adapter、media-executor、ParametersDropdown、workflow-converter、runtime-model-classification、runtime-model-discovery、provider-model-catalog，**9 文件、359 项通过**。
- 覆盖新增型号的图片注册与参数隔离、GPT/Tuzi 生成和编辑请求、GIF/SVG 请求与格式不符失败、禁止未接入的官方格式编辑、供应商/模型 ID 保持、基础兼容与任务队列参数透传、文本元数据误分类及两种历史目录恢复；同时保留旧型号与手动配置回归。缓存分类文件整理后单独复测 **12 项通过**。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- `pnpm exec vite build --config apps/web/vite.config.ts`：通过，45.26 秒；有 Sass 弃用、CSS 优化及大 chunk 提示。
- 本轮 9 个业务/测试文件 ESLint 共 63 错误、19 警告。63 错误均位于 media-executor.test.ts 的已有空测试桩；通过 `git show HEAD:<path>` 的源码传入 ESLint stdin，基线同样为 63 错误、8 警告。本轮仅为其参数表增加该型号，不扩大清理测试桩。其他 8 个文件 ESLint 为 0 错误、11 警告，未将完整 ESLint 表述为通过。
- `git diff --check`：通过；7205 HTTP 200。测试中仍有 Node/localStorage/IndexedDB 环境提示，模拟测试通过不能代替真实浏览器存储验收。
- 未执行页面交互、真实或收费生成、无后缀型号的实际 GIF/SVG/编辑能力、远程 CI 或部署。此前 Sunburst 48 帧请求返回 9 帧的事实不变，也不外推为该型号已支持任意帧数。

QA/DOC 更新现有 proposal、规格、tasks 与本记录，不新增根目录文档。OpenSpec CLI 在本会话此前检查时不可用，未安装额外 CLI、未宣称严格规格校验通过。本轮改动仅在本地，未提交、推送或创建 PR。

## 透明背景与静态图片参数补齐（2026-11-08）

用户要求继续补齐 2.6 的透明图、输出格式等参数。之前的归一化会将 background、outputFormat、outputCompression、inputFidelity 及全部质量字段清除，导致这些选项即使从其他入口传入，也不能到达最终请求。本轮将现有非流式图片兼容字段接入无后缀 `gpt-image-2.6`、Flare、Sunburst，保留 `-1k` 独立路由别名的原契约。

### 资料核对与证据边界

- 只读获取当前 `https://api.tu-zi.com/api/pricing` 中四个 2.6 条目。Flare / Sunburst 说明确认文字生图、官方参数 GIF/SVG 与 default / Codex 提示词 GIF 的差异；`-1k` 明确为按次图像路由别名，不能当作 OpenAI 官方型号。
- 无后缀型号的公共目录仍标记为通用文本家族、OpenAI-Chat 端点，并且价格不可用。该目录不能提供无后缀型号的完整图片参数契约，不能把本地图片分类修正当成渠道已上线或原生支持的证明。
- 实际读取渠道生成文档 `https://tuzi-api.apifox.cn/343647071e0` 及编辑文档 `https://tuzi-api.apifox.cn/343647072e0`。生成文档提供 PNG/JPEG/WebP、JPEG/WebP 压缩 0–100、auto/low/medium/high 质量等通用字段；模型枚举没有 2.6，且混有旧型号说明，不是 2.6 专属的完整参数表。
- 背景、审核、用户标识和保真度沿用项目既有兼容请求字段，并核对本地 Tuzi `dto/openai_image.go` 的接收字段。通用文档和 DTO 接收不等同于每个型号/分组的上游实际支持。本轮没有追加收费或真实生成测试，不能宣称透明 alpha、所有格式、质量或保真度已通过渠道验收。
- 资料检索的 Exa CLI 本机不可用；Jina 直连超时，随后通过本机既有代理读取渠道页面，并从公开 Apifox 文档页面数据核对字段。临时网页与响应只保存在 `/tmp`，未修改代理配置或安装工具。

### 最终用户效果与请求行为

| 参数 | 本地接入行为 |
|---|---|
| 图片背景 | auto / transparent / opaque；透明且未指定格式时请求 PNG |
| 静态输出格式 | PNG / JPEG / WebP；透明背景与 JPEG 的冲突在发送前报错 |
| 压缩质量 | JPEG / WebP 允许整数 0–100，保留 0；空白或 PNG 时不发送，适用格式下非法值提前报错 |
| 图片画质 | auto / low / medium / high；不恢复旧 4K 档位或 xhigh/max 遗留值 |
| 参考图保真度 | low / high，仅携带参考图时发送；JSON 兼容编辑与 multipart 均保留，multipart 只写入一次 |
| 内容审核与用户标识 | 可选 auto/low 与非空 user，通过现有高级参数发送 |
| 数量和尺寸 | 沿用已有比例选择与批量任务队列，单次上游 n=1 |
| GIF / SVG | 继续使用既有专用模式；切换后隐藏并清理请求中的静态参数，帧数和 SVG 编写模型按模式显示 |

共享 ParametersDropdown 的主输入栏、聊天生成控制、单图/批量及复用该组件的创作入口均从同一模型参数配置读取。静态参数沿既有 params 记录进入任务，不新增持久化字段。GPT/Tuzi JSON 和 multipart、基础兼容路径都保留选中的供应商与精确型号；基础客户端不能转发的字段复用现有 native-compatible 图片请求，不静默丢弃。

显式选择 PNG/JPEG/WebP 后，如果实际媒体格式不同，报告 `IMAGE_OUTPUT_FORMAT_MISMATCH`，保留真实媒体判定，不改 MIME 伪装成功、不重新提交。提示词透明图补充继续复用原有工作流行为。

未开放 stream、partial_images、DALL-E style 和未经证实的固定 4K 档位。当前结果链路消费完整媒体响应，缺少 2.6 渠道的相应能力依据，不能为了“所有参数”增加无法处理的请求。`response_format` 仍按先前已确认的上游拒绝行为省略，`-1k` 保留原有 b64_json 协议。

### 实际测试、回归与限制

- 核心 5 文件 **331 项通过**：2.6 集成与输出协议、基础兼容适配器、参数组件、工作流转换。覆盖背景/格式/质量/压缩/保真度的构建与传递、0 和 100、非法压缩、透明 JPEG 预拦截、模式切换、重复归一化、编辑及格式不符后只请求一次。
- 共享旧功能的 4 文件 **276 项通过**：GPT 适配器 32、Tuzi 适配器 76、尺寸质量解析 48、供应商路由 120。以上合计 **9 文件、607 项通过**。最后补充空白压缩和不支持字段检查后，受影响的输出协议/尺寸解析 **2 文件、127 项再次通过**。
- 扩大至 ai-input-parser.test.ts：29 项通过、22 项失败。使用 git archive 导出独立 HEAD 源码，临时目录复用已安装依赖后单独运行，结果同样为 29 通过、22 失败；22 个失败用例名称完全一致。没有重置或覆盖当前工作区；临时基线目录已自动清理。未修改该原有解析器问题，不能把扩大后的全部测试表述为通过。
- 最终 `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 最终 `pnpm exec vite build --config apps/web/vite.config.ts`：通过，33.59 秒；仍有 Sass 弃用、CSS 优化和大 chunk 提示。
- 11 个变更业务/测试文件 ESLint：1 错误、17 警告。错误为 default-adapters.ts 原有 `@aitu/utils` 静态导入触发 `@nx/enforce-module-boundaries`；以 HEAD 源码通过 ESLint stdin 对照，同一文件同样为 1 错误、3 警告。本轮未扩大处理模块边界配置，不将完整 ESLint 记为通过。
- `git diff --check`：通过。没有进行页面/浏览器测试、实际 alpha 通道验证、真实供应商生成、收费请求、远程 CI 或部署。测试中的存储环境警告不代表实际浏览器存储已验收。

QA/DOC 更新现有 proposal、规格、tasks 及本记录，没有新增根目录文档、依赖、配置或数据库迁移。保持本地未提交状态。

## default 分组参数支持说明修正（2026-11-08，用户实测反馈）

用户反馈：官方参数方式在 default 分组 Key 下也可以使用，但 SVG 不可用。这是用户提供的最新实测证据；本轮没有追加生成请求，也没有将其描述为代理逐项实测。此前文档和界面将参数 GIF 与 SVG 一起限定为官方/官方优惠分组的说法过于严格，以本节为当前说明，保留前文作为历史阶段记录。

- 确认现有请求代码没有根据 Key 分组拦截参数 GIF 或静态图片参数，因此无需改动参数传输或切换用户分组。
- 将“GIF（官方参数）”改为“GIF（参数）”，“官方 GIF 帧数”改为“GIF 帧数”；模型介绍和输出类型说明明确 default 分组也可采用参数方式，SVG 继续注明官方/官方优惠分组要求。
- 已保存的内部模式值 `gif_official`、请求字段及任务记录不变，没有迁移或凭据变更；原 `-1k` 独立契约、格式编辑限制和实际文件格式校验保持既有行为。
- 用户此次反馈不构成所有静态参数逐项验证、所有型号或 Codex 分组支持证明，也不改变先前 Sunburst `frame_count=48` 实际返回 9 帧的结果。

验证：参数组件与 2.6 输出协议共 **2 文件、106 项通过**；TypeScript 检查通过；3 个本轮 TS/TSX 文件 ESLint **0 错误、2 警告**；`git diff --check` 通过。测试继续验证新显示名称对应原参数值，未新增模拟结果来冒充渠道实测。本轮为分组说明和错误提示修正，没有页面测试、新收费请求或重复生产构建。QA/DOC 更新既有记录与规格，未提交或推送。

## 全部 2.6 型号覆盖透明等静态参数（2026-11-08）

用户明确“2.6 都覆盖”，并进一步限定为“透明的这些参数”。本轮将上一阶段排除的 `gpt-image-2.6-1k` 也纳入共享静态参数规则；现在覆盖 `gpt-image-2.6`、`gpt-image-2.6-1k`、`gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`。此前仅为前三个非 1k 型号开放静态字段的描述，以本节为最新范围。

- 四个型号统一提供自动/透明/不透明背景、PNG/JPEG/WebP、JPEG/WebP 压缩质量 0–100、auto/low/medium/high 画质、参考图保真度，以及已有审核与用户标识高级字段。
- 移除共享静态参数配置、请求归一化和画质解析中对 `-1k` 的单独排除。透明背景未指定格式时请求 PNG；透明与 JPEG 冲突、压缩边界、GIF 模式清理静态参数和格式不符不重发的行为继续适用于全部型号。
- GPT/Tuzi JSON 与 multipart、基础兼容请求以及工作流批量任务继续使用原有字段、精确型号与所选供应商。共享参数菜单覆盖主输入栏、聊天、单图/批量及现有复用入口，不需要逐个复制配置。没有新增存储结构或迁移。
- `-1k` 仍保留 `response_format=b64_json` 和提示词 GIF；本次静态参数范围扩展不开放它的参数 GIF 或 SVG。其他型号及 default 分组参数 GIF 说明保持上一阶段结果。

本轮实际验证：

- Vitest **8 文件、514 项通过**：gpt-image-26-integration、gpt-image-26-output、default-image-adapter、ParametersDropdown、workflow-converter、gpt-image-adapter、tuzi-gpt-image-adapter、image-size-quality-resolver。将静态界面、请求、编辑和基础兼容用例扩展为四型号表驱动覆盖，并验证四型号的批量透明参数透传；包括透明 PNG、透明 JPEG 预拦截、WebP 压缩 0/100/非法值、仅编辑发送保真度、1k 原返回格式及 GIF 行为、静态格式不符只请求一次和旧 GPT 型号回归。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 本轮 8 个业务/测试文件 ESLint：**0 错误、11 警告**。
- `pnpm exec vite build --config apps/web/vite.config.ts`：通过，33.91 秒；保留 Sass 弃用、CSS 优化和大 chunk 提示。
- `git diff --check`：通过；7205 HTTP 检查成功。未重复运行本次未修改的输入解析器测试，不改变上一阶段记录的 22 项 HEAD 基线失败。
- 未执行页面/浏览器交互、真实供应商请求、收费生成或输出 Alpha 验收。以上结果证明客户端字段覆盖，不宣称所有型号与分组均已实际生成透明图片。没有读取或更换凭据、提交、推送或部署。

QA/DOC 更新现有 proposal、规格、tasks 和本文件，不新增根目录文档。改动保存在本地。

## GIF（参数）模式透明背景不可见修复（2026-11-08）

用户截图中已选中“GIF（参数）”，但参数面板只显示输出类型、尺寸和折叠的高级功能。根因是上一阶段将 background、quality、moderation、user 与静态编码字段统一限定为 auto 模式；四型号静态参数覆盖的测试未涵盖用户实际选中的 GIF 场景。此处为代码模式过滤问题，不能要求用户反复刷新来掩盖。

最终修正：

- 在参数 GIF（无后缀、Flare、Sunburst）和提示词 GIF（全部四型号）模式保留背景和画质入口，两项基础控件无需开启高级功能；既有 moderation/user 高级字段也允许随适用 GIF 请求发送。
- 请求归一化保留选定背景、质量等通用图片字段。透明背景的自动 PNG 规则仅适用于 auto 静态输出；GIF 透明请求继续使用 GIF 输出意图，参数 GIF 保留 `output_format=gif`、frame_count，提示词 GIF 不增加静态格式字段。
- 保存的 PNG/JPEG/WebP、静态压缩与参考图保真度继续在 GIF 模式排除，避免旧 JPEG 与透明设置产生无关冲突或覆盖 GIF。SVG 仍只使用现有专用参数，不将这些图片字段混入矢量请求。
- 改动使用现有共享参数过滤与请求函数，继续适用于各复用入口；不修改供应商、Key、模式存储值、任务结构或 `-1k` 的参数 GIF/SVG 限制。前文“GIF 隐藏并清理所有静态参数”的描述，以本节的字段区分为准。

实际验证：

- 核心 **5 文件、376 项通过**：ParametersDropdown、workflow-converter、gpt-image-26-integration、gpt-image-26-output、default-image-adapter。新增截图同态用例验证参数 GIF、高级关闭时透明与高清按钮可见可选；覆盖三型号参数 GIF、四型号提示词 GIF、GIF 透明不强制 PNG、保留 GIF 意图而排除旧 JPEG/压缩、SVG 隔离、基础兼容实际请求构造及批量参数透传。
- GPT/Tuzi 旧适配器与尺寸质量解析 **3 文件、156 项通过**；合计 **8 文件、532 项通过**。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 本轮 7 个业务/测试文件 ESLint：**0 错误、11 警告**。
- `pnpm exec vite build --config apps/web/vite.config.ts`：通过，37.07 秒；保留既有 Sass 弃用、CSS 优化及大 chunk 提示。
- `git diff --check`：通过，7205 HTTP 200。按项目默认规则未进行真实页面交互或视觉验收；“可见”证据来自上述组件状态测试，未冒充浏览器现场截图。
- 没有新增收费生成、原始 GIF 透明度/Alpha 实测、远程 CI 或部署；本地显示与请求字段修复不代表供应商已经返回透明 GIF。原输入解析器 22 项 HEAD 基线失败和未修改文件的历史 lint 状态仍按前文记录。

QA/DOC 更新原 proposal、规格、tasks 和本记录，无新根目录文档、配置或依赖。保留本地改动，未提交或推送。

## GitHub 提交前最终验证（2026-11-08）

### 交付范围与兼容性

- 实现提交：`648aacf9`，`feat(image): 补齐 GPT Image 2.6 输出模式和透明参数`；分支 `dev/gpt-image-26-output-options`。
- 提交前独立备份全部 26 个修改/新增文件，逐文件 SHA-256 对照归档内容验证成功；源码、测试与已有 OpenSpec 记录均属于本轮 2.6 适配，没有纳入生成图片、凭据或构建产物。
- 已显式执行 `git fetch origin develop` 和 `git merge --no-edit origin/develop`。远程基线为 `b742f593`，合并结果 Already up to date，没有冲突；最终构建使用同一份实现源码。
- 注册四个精确型号 `gpt-image-2.6`、`gpt-image-2.6-1k`、`gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`，修正自动发现及历史目录的文本误分类，保留手动配置、供应商和精确模型 ID。
- 四型号共享背景、静态格式、压缩、画质、参考图保真度及既有审核/用户标识字段；GIF 模式保留适用背景与画质，隔离静态编码。无后缀、Flare、Sunburst 接入参数 GIF/SVG；`-1k` 保留提示词 GIF 和 `b64_json` 契约。
- SVG 编写模型只推荐渠道示例 `gpt-5.5`，自定义/历史 ID 标记未验证。格式不符明确失败且不自动重发；待插入队列在插入前重新读取任务的手动插图完成状态，避免重复插图。没有将最初 SVG 自动插入卡住的完整根因描述为已确认。
- 继续复用既有任务参数和 `gif_official` 存储值，无新依赖、环境变量、数据库或存储迁移。本次没有扩展 2K/4K 尺寸或流式预览等额外参数。

### 实际检查结果

环境：macOS，Node.js `26.8.1`，pnpm `10.21.0`，已安装工作区依赖。

| 检查 | 实际结果 |
|---|---|
| 相关 Vitest 回归 | **18 文件、821 项通过**；首组 17 文件 701 项，补充供应商路由 1 文件 120 项 |
| drawnix TypeScript | `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 通过 |
| Web 生产构建 | `pnpm exec vite build --config apps/web/vite.config.ts` 通过，33.53 秒；保留 Sass 弃用、CSS 优化及大 chunk 提示 |
| 全部变更 TS/TSX 的 ESLint | **20 文件、65 错误、81 警告**，不宣称完整 lint 通过；错误基线对照见下文 |
| 差异与冲突检查 | 暂存差异及 `git diff origin/develop...HEAD --check` 通过，`git ls-files -u` 无输出 |
| 新增内容凭据检查 | 修改新增行及 3 个新文件未匹配 API Key、GitHub Token、私钥特征；没有读取测试凭据 |
| OpenSpec 严格校验 | 实际执行 `openspec validate add-gpt-image-2-6-1k --strict`，本机无该命令，退出 127；未安装工具或声称通过 |

ESLint 的 63 条错误位于 `media-executor.test.ts` 的既有空测试桩，另 2 条分别为 `default-adapters.ts` 与 `gpt-image-adapter.ts` 既有静态导入触发的 `@nx/enforce-module-boundaries`。逐文件使用本轮实现前 HEAD 源码经 ESLint stdin 对照，三文件分别仍为 63/1/1 条错误，规则及错误消息完全一致。警告按本轮完整数量记录，没有将历史局部 lint 数量替代当前范围。

相关回归在 `packages/drawnix` 执行 `pnpm exec vitest run --config vitest.config.ts`，文件范围为：

```text
src/services/__tests__/gpt-image-26-integration.test.ts
src/services/__tests__/gpt-image-26-output.test.ts
src/services/__tests__/default-image-adapter.test.ts
src/components/ai-input-bar/ParametersDropdown.test.tsx
src/components/ai-input-bar/__tests__/workflow-converter.test.ts
src/services/__tests__/gpt-image-adapter.test.ts
src/services/__tests__/tuzi-gpt-image-adapter.test.ts
src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts
src/components/ai-input-bar/SvgWriterModelSelect.test.tsx
src/services/__tests__/media-executor.test.ts
src/utils/__tests__/runtime-model-classification.test.ts
src/utils/__tests__/runtime-model-discovery.test.ts
src/services/provider-model-catalog.test.ts
src/services/__tests__/provider-routing.test.ts
src/hooks/__tests__/useAutoInsertToCanvas.test.ts
src/utils/__tests__/image-generation-anchor-insertion.test.ts
src/plugins/components/image.loading.test.tsx
src/services/canvas-operations/canvas-insertion.test.ts
```

覆盖成功输出、参数验证失败、参考图编辑限制、格式不符不重发、批量透传、基础兼容路由、旧 GPT 型号、自动发现恢复和手动/自动插图竞态。未运行整个仓库测试套件；之前已对照 HEAD 确认的输入解析器 22 项失败及未改动 `image.test.ts` 的 Blob 测试失败继续按原记录保留，本次未扩展修复。Node/localStorage/IndexedDB 测试环境提示不构成真实浏览器存储验收。

### 注意事项与验收边界

- 本轮提交检查没有执行页面交互、收费生成、供应商 Alpha 通道验证、远程 CI 或部署。客户端参数传递通过不等于所有型号/分组均接受这些参数。
- 先前授权 Sunburst 实测发送 `frame_count=48`、实际返回 9 帧的结果不变；不能宣称已支持任意帧数或 48 fps。SVG 的分组要求与其他编写模型的可用性仍以渠道为准。
- 无需新增配置或迁移。非技术验收可在已有供应商配置下选择任一 2.6 型号，查看静态模式背景/格式/压缩入口；切到适用 GIF 模式后确认背景与画质保留，切到 SVG 后确认专用编写模型入口。真正生成与输出透明度应另行进行经授权的渠道验收。
- QA/DOC 复用本变更目录的 proposal、规格、tasks 和本文件，不新增根目录 QA.md/DOC.md。回滚可撤销本分支的功能提交后重新构建，无数据迁移回滚步骤；远程分支提交不代表已合并或已部署。
