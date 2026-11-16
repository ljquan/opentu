# Seedream 5.0 Flash 本地 QA

## 2026-11-08：前端真实模型回归

在本地 7201 开发服务和独立浏览器画板，通过 default 分组主站各提交一次无参考图、单张图片生成。三次任务均完成，画布均显示图片，任务队列显示已完成 3、失败 0。

| 模型 | 接口响应时间 | 画布完成时间（相对接口正文） | 浏览器解码尺寸 |
| --- | --- | --- | --- |
| doubao-seedream-5-0-flash-260915 | 约 17.7 秒 | 约 6.0 秒 | 1024 × 1024 |
| gpt-image-2 | 约 26.0 秒 | 约 15.5 秒 | 1448 × 1086 |
| gpt-image-2.6-1k | 约 40.6 秒 | 约 6.8 秒 | 1448 × 1086 |

GPT Image 2 在接口响应后经历了“正在显影”和“正在显现”，最终完成插入；图片详情显示 1448 × 1086 px。两个 GPT 图片的画布资源可读取为 PNG，文件签名与 PNG 一致。Flash 图片可由浏览器显示并解码，直接通过页面 fetch 读取该画布图片源失败，因此未验证其原始文件字节或下载功能。工具栏可见删除和图片详情按钮。三个请求的实际账单金额未核实。

本轮未覆盖多张并发生成、参考图、透明 PNG、下载及刷新后恢复；不能据此推断这些场景的线上表现。合并后 20 个相关测试文件共 715 项通过，Drawnix 类型检查和 Web Vite 构建通过；构建保留 Sass、Browserslist 和大 chunk 等提示。

初次验证日期：2026-10-26，Asia/Shanghai。工作区 `/Users/lkj/Desktop/working/opentu1`，分支 `dev/fix-selected-previews-and-model-discovery`，功能开始时 HEAD 为 `7bdda3a1`。2026-10-27 经用户授权完整合入 develop，产生本地合并提交 `c77b3b6e`；Flash 接入及附加测试继续保留为未提交改动。未推送、创建 PR 或发布。最新整体验证见文末。

## 范围与环境

- 依据用户提供的 Flash API 1.0 文档及已确认的 `add-seedream-5-flash` 提案。
- Node.js `v26.8.1`、pnpm `10.21.0`，复用现有依赖，不安装或升级依赖。
- 验证 Flash 目录/控件/偏好、v3 路由、旧 binding、请求白名单、尺寸、参考图、PNG alpha、URL/Base64、错误、原生客户端/MCP/工作流/执行器及相邻模型。
- 所有生成和外部参考图读取使用模拟接口。图片解码调用使用单元测试替身；透明通道测试包含已知 RGBA/RGB PNG 字节。
- 任务前已有 `packages/drawnix/src/data/image.test.ts` 未提交修改，本次保持原样。

## 实际结果

| 检查 | 预期与实际结果 |
| --- | --- |
| Flash 专项适配器 | 50 项全部通过，包含精确 ID、独立参数、尺寸边界、参考图数量、原始缓存字节、PNG alpha、解码失败、URL/JPEG Base64、HTTP 错误和不确定提交不重试 |
| 扩展回归 | 14 文件、516 项：493 通过，23 失败；12 个文件全部通过。23 个失败名称与未改动 HEAD 快照一致，无新增失败 |
| 旧 Seedream | 别名合同 4 项及路由集成 21 项通过，旧 2K/3K 参数继续按既有合同执行 |
| 分层回归 | 现有 Provider 分层 13 项通过，Flash 未加入拆图入口，也未替换本地/Pro 路径 |
| 参数和工作流 | 参数组件 19 项、工作流 76 项、MCP 9 项、原生服务 22 项通过；Flash 偏好隔离及解析档位测试也通过 |
| 参考图和任务执行器 | 上传组件 21 项、辅助函数 40 项、执行器 29 项通过，覆盖 Flash 缓存/内联/公开 URL 不经过通用压缩 |
| TypeScript | `tsc -p tsconfig.lib.json --noEmit` 退出码 0 |
| Web 构建 | 显式 Vite 构建退出码 0，34.18 秒；仍有已有的大 chunk 提示 |
| 修改文件 ESLint | 全量结果有 67 errors、70 warnings，未通过；每个报错文件的 HEAD 原文经相同配置复查，新增 error 为 0 |
| 循环依赖 | 原脚本因 tsconfig 尾逗号解析失败；用仅作用于检查进程的 TypeScript JSONC 解析兼容后，运行时 2 组、含类型 3 组循环均与 HEAD 报告完全一致，无新增循环 |
| OpenSpec/差异 | `add-seedream-5-flash --strict` 通过；最终空白差异检查通过 |

## 已复现的基线问题

使用 `git archive HEAD` 创建独立临时快照，复用现有依赖，以该快照的 `vite.config.ts` 运行相同旧测试，未替换或重置当前工作区文件。

- `ai-input-parser.test.ts` 有 22 项旧标记、数量、尺寸、场景和文本默认提示词断言失败。
- `ai-generation-preferences-service.test.ts` 有 1 项 Seedance 2.5 旧分辨率迁移断言失败：期望空字符串，实际为 `1080p`。
- 当前和 HEAD 的 23 个失败名称完全一致。本任务新增的 Flash 参数偏好、输入解析用例通过。
- lint 基线 errors 分布：MCP 图片测试 1、媒体执行器测试 63、默认适配器 1、输入解析测试 1、原生服务 1。包括旧导入位置、模块边界及既有测试规则问题；没有通过关规则或跳过测试掩盖失败。
- `check-cycles.js` 用 `JSON.parse` 读取含尾逗号的 `tsconfig.base.json`，原命令在当前树和 HEAD 都失败。临时兼容脚本只在检查进程内用 TypeScript 解析该文件，未修改仓库脚本或配置；兼容后的静态循环报告完全一致，包含已有分层、Tuzi 嵌入配置及类型依赖循环。

初期回归发现 Flash 继承重复尺寸、以及 GPT Image 邻近控件匹配受新增背景参数影响，均已修正后重跑；它们不属于上述保留失败。

## 复验命令

从 `packages/drawnix` 执行：

```bash
node ../../node_modules/vitest/vitest.mjs run \
  src/services/__tests__/seedream-flash-adapter.test.ts \
  src/services/__tests__/seedream-alias-parameters.test.ts \
  src/services/__tests__/image-routing-adapter-integration.test.ts \
  src/services/__tests__/provider-routing.test.ts \
  src/services/__tests__/media-executor.test.ts \
  src/services/__tests__/ai-generation-preferences-service.test.ts \
  src/services/media-executor/fallback-utils.test.ts \
  src/services/layer-decomposition/provider.test.ts \
  src/components/ai-input-bar/ParametersDropdown.test.tsx \
  src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  src/components/ttd-dialog/shared/ReferenceImageUpload.test.tsx \
  src/mcp/tools/__tests__/image-generation.test.ts \
  src/utils/gemini-api/services.test.ts \
  src/utils/__tests__/ai-input-parser.test.ts

node ../../node_modules/typescript/bin/tsc -p tsconfig.lib.json --noEmit
```

从 `apps/web` 执行 `node ../../node_modules/vite/bin/vite.js build`。显式构建不运行版本写入脚本或手册截图流程。

日志：`/tmp/opentu1-seedream-flash-tests.log`、`/tmp/opentu1-seedream-flash-baseline-tests.log`、`/tmp/opentu1-seedream-flash-types.log`、`/tmp/opentu1-seedream-flash-build.log`、`/tmp/opentu1-seedream-flash-lint.json`、`/tmp/opentu1-seedream-flash-lint-comparison.json`。

循环检查复验：仓库根目录执行 `node scripts/check-cycles.js` 和 `node scripts/check-cycles.js --include-types` 可复现原脚本配置解析失败；本次兼容命令为 `node /tmp/opentu1-seedream-flash-cycle-check.cjs /Users/lkj/Desktop/working/opentu1`，含类型时追加 `--include-types`。兼容检查日志为 `/tmp/opentu1-seedream-flash-current-cycles-jsonc.log` 和 `/tmp/opentu1-seedream-flash-current-cycles-types-jsonc.log`，对应 HEAD 日志文件名将 `current` 替换为 `baseline`。

## 未执行项与验收边界

- 按用户协作规范未执行页面点击、浏览器自动化、截图或端到端测试。
- 未调用真实生成接口、读取 API Key、核实费用、CORS、账户权限、限流或实际生成透明效果。
- mock 测试证明客户端路径和字段，不证明服务支持或产物质量。公开 URL 的真实大小/可访问性仍由服务侧决定。
- 没有完整仓库测试或全仓库 lint 通过声明；保留上述经 HEAD 复现的问题。
- Flash 原生拆图自动定位未实施，需补齐边界框格式、坐标基准、normalized 尺度、底图和层级约定。

后续人工验收：在有模型权限的 Provider 下选择 Flash，确认三个尺寸档位和 PNG/JPEG、水印控件；先按明确授权进行一次普通生图，再用原始透明 PNG 验证透明模式、尺寸和返回文件。遇超时先核对控制台请求 ID 与使用记录，再决定是否重试。该步骤尚未执行，不应当作本次通过项。

无需新增环境变量、迁移或部署顺序。回滚本任务差异即可恢复原目录和路由；原有缓存及其他模型配置继续使用公共读取路径。

## 2026-10-27：详情尺寸未记录补修

用户截图显示 Flash 任务成功而详情尺寸未记录。代码检查确认 Flash 原实现只读取 `data[0].size`，缺少图片自然尺寸兜底；当前详情面板也未补读原图。没有取得该次请求的原始响应，因此不能据截图断言服务未返回尺寸。

修改范围：Flash 适配器在缺少合法尺寸时复用 `resolveGeneratedImageDimensions`；从 `origin/develop` 引入已有的详情原图尺寸读取、自然尺寸元数据和对应测试，并在图片工具栏传入当前 board。尺寸实现已在后续完整 develop 合并时按内容去重，浏览器工具栏显隐偏好未改写。

本轮实际验证：

- 7 个文件、124 项测试全部通过：Flash 适配器 50 项、新增尺寸回归 2 项、原图尺寸和来源投影、详情组件及原生图片服务。详情组件新增 Flash 任务无尺寸时显示解码像素的用例。
- 覆盖接口没有 `size` 时读取自然像素；解码失败仍保留生成图片且不重发请求；缓存原图读取与临时 URL 释放；缺原图不取缩略图；刷新后恢复；画板/原图/关闭状态变化不写回；原有本地缩放和其他媒体详情回归。
- `tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 通过。
- Web Vite 构建通过，34.63 秒，保留已有大 chunk 警告。
- 本轮相关文件 ESLint 为 2 errors、38 warnings；2 个 error 均来自 `popup-toolbar.tsx`，以 HEAD 原文输入同一配置复现相同规则和消息，新增 error 为 0。最终差异检查通过，不宣称全量 lint 通过。
- 本轮未执行页面交互或真实生成，未读取 API Key；截图对应图片的实际像素尚未在用户页面核验。修复后重新打开详情即可触发读取，无需重新生成。

定向测试在 `packages/drawnix` 执行：

```bash
node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts \
  src/services/__tests__/seedream-flash-adapter.test.ts \
  src/services/__tests__/seedream-flash-dimensions.test.ts \
  src/utils/canvas-image-dimensions.test.ts \
  src/utils/canvas-generation-details-source.test.ts \
  src/utils/canvas-image-details.test.ts \
  src/components/toolbar/popup-toolbar/image-details-button.test.tsx \
  src/utils/gemini-api/services.test.ts
```

本轮日志：`/tmp/opentu1-flash-dimensions-tests.log`、`/tmp/opentu1-flash-dimensions-types.log`、`/tmp/opentu1-flash-dimensions-build.log`、`/tmp/opentu1-flash-dimensions-lint.json`。

## 2026-10-27：完整合入 develop

用户明确要求“全部合并到本地”。显式 fetch 后 `origin/develop` 为 `5ef5e7da9dcd73771c174b39cbabc190c1daba69`。在当前功能分支执行本地合并，提交 `c77b3b6e348883d045ab8e16fa227bfb46f543dd`，父提交为原功能分支 `19a163f7` 和 develop `5ef5e7da`；`git merge-base --is-ancestor origin/develop HEAD` 通过。没有切换、重置其他 worktree 的 develop 分支，也未推送。

合并前对全部 41 个已修改/新增文件保存带 SHA-256 清单的归档，并验证恢复 stash。归档目录为 `/Users/lkj/.codex/backups/opentu1-before-merge-develop-20261027-151201/`；恢复 stash 为 `3b1b4723e82ce764ec44cdfd5051deebe1a5d393`，继续保留。

冲突与恢复结果：

- 主分支合并仅冲突于关联线测试的 Vitest 导入，保留 `beforeEach/afterEach` 与双方用例；提交前两文件 45 项回归通过。
- 恢复本地修改时，详情测试与上游新增 Gemini 用例重合，保留 Gemini 和 Flash 参数化用例。两份原图尺寸工具/测试与上游完全相同，直接使用已合入文件。
- 恢复后 40 个原文件逐字节相同，README 与双方改动的预期三方合并结果相同；原有 `data/image.test.ts` 修改完整保留。恢复完成后再按最终结果更新本 QA/DOC。
- 新合入的 JPEG 缓存用例在当前 jsdom Blob 上调用 `arrayBuffer()` 失败，在干净合并提交也可复现；改用 `FileReader` 读取同一 Blob，保持原始 JPEG 字节断言。该测试兼容修改作为本地未提交改动保留。

最终验证：

| 项目 | 实际结果 |
| --- | --- |
| 28 文件整合回归 | 581 项中 580 通过、1 失败；27 文件完全通过。剩余失败是原有 Seedance 2.5 旧分辨率迁移断言，在不含本地修改的合并 HEAD 快照复现 |
| Flash 输入解析增量 | 定向用例 1/1 通过；同文件其他 51 项未在该定向运行执行 |
| 类型 | drawnix `tsconfig.lib.json` 与 web `tsconfig.app.json` 均通过 |
| Web 构建 | 显式 Vite 构建通过，42.42 秒，保留已有大 chunk 等提示 |
| ESLint | 检查 59 个相关 TS/TSX 文件，71 errors、145 warnings；逐个报错文件对照合并 HEAD，新增 error 为 0。JPEG 测试兼容修改后单独复查无 error |
| 静态循环 | 用此前仅作用于检查进程的 JSONC 兼容脚本扫描，运行时 2 组、含类型 3 组，与干净合并 HEAD 报告完全相同，无新增循环；原始脚本仍有 tsconfig 尾逗号解析问题 |
| Git/OpenSpec | 无未解决冲突、暂存区为空、完整包含 develop；最终差异及 Flash OpenSpec strict 校验通过 |

整合回归使用 `NODE_OPTIONS=--no-experimental-webstorage node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts`，范围包含上游预发布 QA 的 17 个文件、Flash 适配器/尺寸/详情、原生客户端、模型参数、MCP/工作流、执行器、Provider 路由、参考图上传和模型偏好；没有通过跳过失败断言宣称全部通过。

测试日志为 `/tmp/opentu1-full-develop-merge-tests.log`；干净 HEAD 两个原始失败的复现记录为 `/tmp/opentu1-full-develop-merge-baseline-tests.log`。类型、构建、lint、循环比较分别位于同前缀的 `types.log`、`web-types.log`、`build.log`、`lint.json`、`lint-comparison.json` 和 `cycles-*.log`。

本轮未执行页面交互、真实付费接口或服务重启，未改写浏览器设置。7201 的资源响应用于确认服务提供新版工具栏源码，不作为页面视觉验收。刷新后若删除仍位于“更多”，在“设置 → 图片工具栏”勾选“删除”、关闭“显示工具文字”，即可恢复用户要求的紧凑显示配置。

## 2026-10-31：本地 Flash 生成响应跨域读取修复

用户截图显示服务端记录 11 秒、1 张图片及 ¥0.21 用量，而画布任务 `ca2158d8-6667-4f13-aeda-15d7b6296574` 报“未取得确定的生成结果”。该提示来自适配器发送异常分支，尚未进入 URL/Base64 解析；截图未提供该笔请求的原始网络响应，因此不把计费行视为完整产物证据。

### 检查与修复范围

- 非生成请求复现主站 `POST /api/v3/images/generations` 实际错误响应缺少 `Access-Control-Allow-Origin`；同一路径通过现有 7201 Vite 代理能够读取完整状态与正文。此前 OPTIONS 预检通过不代表实际 POST 响应已满足 CORS。
- 修改 `provider-transport.ts`：仅在开发模式及 localhost/127.0.0.1/[::1] 页面中，将精确 HTTPS 主站源、精确 Flash v3 路径的 POST 改写到现有 `/__opentu_tuzi_proxy__/api/` 固定主站代理。仍请求 `/api/v3/images/generations`，不降级到 v1。
- 原始 URL 上完成认证归属检查与 `ch` 标记后才改写浏览器传输地址。保留原请求体、Authorization、取消信号、超时和响应观察；代理请求显式省略浏览器 Cookie。其他域名、端口、协议、路径、请求方法、生产构建和非本地页面不进入此分支。无 window 的服务端调用保持直连。
- 没有新增代理目标、服务、配置或依赖，没有修改后端及线上服务。连接失败仍不自动重放 POST，也不构造未定义的 Flash 结果查询。

### 实际验证

macOS、Node v26.8.1，使用已有依赖。从 `packages/drawnix` 执行：

```sh
NODE_OPTIONS=--no-experimental-webstorage node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --maxWorkers=1 \
  src/services/__tests__/seedream-flash-adapter.test.ts \
  src/services/__tests__/seedream-flash-dimensions.test.ts \
  src/services/__tests__/provider-routing.test.ts \
  src/services/__tests__/image-routing-adapter-integration.test.ts \
  src/services/__tests__/media-executor.test.ts \
  src/utils/gemini-api/services.test.ts \
  src/mcp/tools/__tests__/image-generation.test.ts --silent
```

- 最终 7 文件、270 项全部通过。Flash 文件原 50 项加本轮 17 项，共 67 项；新增用例中的 5 项在修改前先复现直连地址错误，修改后通过。
- 新增覆盖根地址/尾部 v1、带 Provider 上下文、原请求体及认证头、`ch`、URL 和 PNG Base64、实际尺寸、响应/提交观察、HTTP 403、网络失败仅一次提交、IPv4/IPv6 本地源、异域凭据不继承、其他接口/GET/自定义域名/相似恶意域名/不同端口与协议/非本地页面/生产模式/无 window 边界。相邻图片路由、原生服务、MCP 和执行器回归通过。
- 并行构建期间一次整合运行中视频存储测试触发原有 15 秒超时；构建结束后使用上述单 worker 命令完整重跑，270 项通过，没有放宽超时或跳过测试。不将这次超时认定为已确认的基线失败。
- Drawnix `tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 和 Web `tsc -p apps/web/tsconfig.app.json --noEmit`：均通过。
- `apps/web` 中直接运行 `node ../../node_modules/vite/bin/vite.js build`：通过，2 分 7 秒；保留已有 Sass、Browserslist、混合导入、大 chunk 等提示。未运行版本写入脚本。
- 本轮两个 TS 文件 ESLint：0 errors；适配器测试保留修改前 454 行内的 4 条告警，传输文件 0 warnings。差异空白检查通过。
- 用已授权的本地凭据，通过 7201 同源代理发送缺少模型与提示词的 `{}`，返回 HTTP 400、`Model name not specified`、`Access-Control-Allow-Origin: http://localhost:7201` 和请求 ID `202610310134527178410698268d9d6eZieezbd`。没有有效生成提交，凭据不写入命令参数、日志、仓库或文档。
- 读取 7201 实际提供的传输源码，确认已包含新代理分支和 Cookie 省略；服务仍为原 PID 53008、当前 opentu1/apps/web 工作区，没有重启其他服务。

日志：`/tmp/opentu1-flash-proxy-before.log`、`/tmp/opentu1-flash-proxy-tests.log`、`/tmp/opentu1-flash-proxy-types.log`、`/tmp/opentu1-flash-proxy-web-types.log`、`/tmp/opentu1-flash-proxy-build.log`、`/tmp/opentu1-flash-proxy-eslint.json`。

### QA/DOC 与验收边界

本文件更新 QA，`docs/seedream-5-flash.md` 更新现有 DOC，不新建重复文档。所有既有本地改动保留，本轮改动未提交、推送或部署。

未进行页面交互、视觉/E2E、收费生成、该次成功响应的抓取或真实图片回填验收。模拟成功响应与实际空请求分别证明解析兼容性和代理可读性，不等同实际出图通过。生产直连及其他节点仍需服务侧正确配置 CORS。

刷新 `http://localhost:7201` 后，后续主站 Flash 请求会使用同源链路，无需重填 Key 或清空数据。已计费的旧失败任务不会自动恢复；已有图片优先从控制台对应记录取回，避免为恢复结果再次生成。若回滚，只撤回本节涉及的传输改写、增量测试与文档段落，保留之前的 Flash 接入及其他工作区差异。
