# 图片分辨率修复 QA

## 高风险审查修复（当前，2026-09-19）

- 范围：只修复 GPT/Seedream 专用渠道无参考图自动比例下的显式高档位丢失，以及批量入口的模型名正则分流。未处理本轮审查的其他中风险项，未提交、推送或部署。
- 前置条件：现有本机 Node/pnpm 和已安装依赖；测试使用模拟传输，不需要真实 API Key，不产生上游收费请求。
- GPT 专用渠道：`auto` 或省略尺寸并选择 2K/4K 时，在请求发出前报错。覆盖官方 JSON、Tuzi JSON、旧 `quality=4k` 兼容输入、自定义模型名以及 Sunburst/Flare。1K 自动比例保留兼容，并不意味着上游输出或账单已经核验。
- Seedream：`auto` 或省略尺寸并显式指定 resolution/seedream_quality 时，在请求发出前报错；覆盖 lite 的 2K/3K 与 4.5/pro 的 4K。未指定档位的自动比例仍允许提交。
- 有参考图或明确比例的原有成功路径保持：1086x1448 首图 + GPT 4K 得到 2480x3312；16:9 + GPT 4K 得到 3840x2160。
- 批量入口：所有非 MJ 模型调用同一个准备函数，不再用大小写敏感正则筛选；保存首图宽高，保留原始比例/K 档。补测共享函数对自定义模型名、大小写模型名、无模型名及无参考图的处理；未新增批量组件点击测试，不把共享函数测试视为页面验收。

| 验证 | 实际结果 |
| --- | --- |
| 下列 12 个测试文件 | 226 个用例全部通过 |
| TypeScript | 通过 |
| Vite 生产构建 | 通过，54.22 秒；存在 Sass/CSS、包体和混合导入警告 |
| 本轮 6 个 TS/TSX 文件 ESLint | 1 个错误、19 个警告；错误位于 Seedream 的既有静态导入，HEAD 相同路径 lintText 对照复现同规则、同消息，无新增错误 |
| git diff --check | 通过 |
| 页面、真实渠道、计费、全仓测试、覆盖率 | 本轮未执行 |

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  --config packages/drawnix/vite.config.ts \
  packages/drawnix/src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts \
  packages/drawnix/src/services/__tests__/{image-resolution-intent,generation-api-resolution,image-resolution-routing,default-image-adapter,gpt-image-adapter,media-executor,image-generation-service}.test.ts \
  packages/drawnix/src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  packages/drawnix/src/utils/__tests__/image-task-prefill.test.ts \
  packages/drawnix/src/services/media-api/image-api.test.ts \
  packages/drawnix/src/mcp/tools/__tests__/image-generation.test.ts --silent --maxWorkers=1
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit --pretty false
pnpm exec vite build --config apps/web/vite.config.ts
git diff --check
```

限制：通用兼容渠道的 quality 档位协议仍按既有实现处理，本轮专用渠道的校验不等于所有路由均已修复。批量仍在入队前读取缺失尺寸的远程图，读取失败会阻止提交；后续应独立处理执行层缓存后再读尺寸的问题。没有新增依赖、配置或迁移；人工验收可先选择无参考图的 GPT auto + 4K，确认报错且无生成请求，再添加 3:4 参考图确认请求尺寸为 2480x3312。

## develop 合并后验证（历史记录）

- 日期：2026-09-19；工作区不变，当前分支仍为 `main`。
- 通过显式 fetch 和快进合并，将 `origin/develop@b730d011`（1.1.12）的 130 个提交同步到本地。没有新增本地提交、推送或 PR。
- 原有 38 个修改文件已恢复，14 个 stash 应用冲突已处理；暂存区与未合并索引均为空。原始备份 `b4eadc8c61edd68c940ccb7b3d23c636394200cb` 保留，不应在当前工作区再次直接 apply。
- 保留上游 Request ID、请求恢复与旧执行写回保护、绑定模型和别名回退、远程参考图传输、GPT Image 2.5 / Seedream 5 pro 支持，同时保留本地分辨率修复。
- `pnpm install --frozen-lockfile --ignore-scripts` 成功，同步上游新增依赖，没有修改锁文件；不执行依赖安装脚本。

| 检查 | 合并后实际结果 |
| --- | --- |
| 24 个相关测试文件，425 个用例 | 420 通过、5 失败，详见下方归因；不是全绿 |
| 上传、粘贴、分辨率解析、工作流及路由用例 | 合并相关失败已处理，补充宽高传递断言和 GPT 2.5 档位边界 |
| TypeScript 检查 | 通过 |
| Vite 生产构建 | 通过；保留 Sass、包体和混合导入警告 |
| `git diff --check` | 通过 |
| `http://127.0.0.1:7202` HTTP 检查 | 200；不等于页面交互或真实生成验收 |
| 页面交互、真实渠道与收费测试 | 合并后未执行 |
| ESLint | 合并后未重新建立基线，下方 35 个错误仅属于旧基线 |

### 失败与对照结果

在 `git archive b730d011` 的未修改快照中复用本机依赖进行对照，没有改动上游代码或降低测试断言：

- GPT 适配器的绑定模型优先级、`model_not_found` 别名重试两项均超时；在干净上游复现。夹具没有响应尺寸，触发图片自然尺寸读取并撞上 5 秒测试超时。
- 任务重试的 `does not let a late analyzer response overwrite a newer same-id restore` 失败；在干净上游复现，原因是模块模拟环境缺少 `window.location.origin`。
- 请求恢复的 `releases the recovery slot when a response body ignores abort` 在当前和干净上游都出现失败，也出现通过，属于不稳定项。
- 请求恢复的 `releases the recovery slot when fetch ignores abort and discards its late response` 在当前批量运行失败，单独复跑通过；干净上游对照通过。该测试及恢复服务、provider-routing 均未修改，但仍不能宣称已稳定验证，失败归因保留。
- 快照扩展对照中，`task-storage-writer-image-attempt.test.ts` 因快照仅软链接根依赖、缺少包级 `fake-indexeddb` 解析而未收集；真实工作区该文件 21 个用例通过。快照结果只用于逐项对照，不视为完整基线验收。

上述失败未通过放宽超时、跳过用例或修改无关恢复逻辑消除。未运行全仓测试，未验证真实渠道出图和扣费。

### 合并后复跑命令

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  --config packages/drawnix/vite.config.ts \
  packages/drawnix/src/services/__tests__/{image-resolution-intent,image-resolution-routing,tuzi-gpt-image-adapter,gpt-image-adapter,default-image-adapter,image-routing-adapter-integration,model-adapter-registry,media-executor,task-queue-service-image-retry,image-generation-service,ai-generation-preferences-service,async-image-api-service}.test.ts \
  packages/drawnix/src/services/media-api/image-api.test.ts \
  packages/drawnix/src/utils/__tests__/image-task-prefill.test.ts \
  packages/drawnix/src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  packages/drawnix/src/constants/__tests__/model-config.test.ts \
  packages/drawnix/src/mcp/tools/__tests__/image-generation.test.ts \
  packages/drawnix/src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts \
  packages/drawnix/src/services/task-invocation-route.test.ts \
  packages/drawnix/src/services/__tests__/{image-generation-recovery-service,image-generation-recovery-metadata,task-storage-writer-image-attempt}.test.ts \
  packages/drawnix/src/components/ttd-dialog/shared/ReferenceImageUpload.test.tsx \
  packages/drawnix/src/components/ttd-dialog/shared/ReferenceImageUpload.paste-scope.test.tsx \
  --silent --maxWorkers=1

pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit --pretty false
pnpm exec vite build --config apps/web/vite.config.ts
git diff --check
```

## 合并前历史记录

以下各节的 181 个通过用例、7 个浏览器场景及 ESLint 数量均基于 `f57c2123`，仅保留为历史验证，不代表 `b730d011` 合并后的验收结果。

## 环境与范围

- 日期：2026-09-19。
- 工作区：`/Users/lkj/Documents/ChatGPT/opentu-2`，基于 `main@f57c2123`。
- Node.js 26.8.1，pnpm 10.21.0；使用现有依赖，无安装或升级。
- 覆盖尺寸解析、参考图元数据、专用/通用/异步路由、工作流/MCP、偏好、任务回填和重试；测试替代外部传输，不发真实收费生成请求。
- 本地开发地址：`http://127.0.0.1:7202`，HTTP 检查为 200；保留原有 7200 服务。按后续“帮我测试”的要求，已补充隔离浏览器的模拟渠道交互验收。

## 实际结果

| 检查 | 结果 |
| --- | --- |
| 下列 17 个测试文件 | 181 个用例通过 |
| 隔离浏览器请求链路 | 7 个场景通过，5 次有效生成提交均由本地模拟渠道接收；真实上游调用为 0 |
| `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit --pretty false` | 通过 |
| `pnpm exec vite build --config apps/web/vite.config.ts` | 通过；存在原项目 Sass、包体和混合导入警告 |
| 对本次 TS/TSX 文件执行 ESLint | 存量错误未清零；修改前后均为 35 个错误，无新增错误 |
| `git diff --check` | 通过 |

使用 Vite 直接构建，避免 `build:web` 前置版本脚本产生无关版本修改。ESLint 基线通过 `git show HEAD:<文件>` 取得源代码，再按相同路径 `lintText` 比较错误的规则和消息，并非推测其为存量。

本轮测试重新执行了上述 17 个测试文件、TypeScript 和 `git diff --check`，均通过；构建与 ESLint 保留上一轮实现验证结果，本轮未重复运行，也未修改应用代码。

## 浏览器模拟渠道验收

- 环境：项目已有 Playwright 1.57.0、本机 Chrome、1440x1000 视口、新建且用后关闭的隔离浏览器上下文。
- 测试配置：`gpt-image-2`、`Tuzi GPT 兼容`、虚拟凭据和本地模拟地址。未读取或修改用户现有浏览器配置。
- 网络边界：外部域名请求全部阻断；禁用 Service Worker；模拟渠道截获生成请求并返回图片夹具，不转发上游。
- 参考图：浏览器生成的真实 600x800 PNG，通过页面文件上传控件加入；不把参考图宽高直接注入任务参数。
- 执行命令：`node /tmp/opentu-resolution-qa.hVZ7u1/browser-check.cjs`。这是本机临时测试脚本，临时目录被清理后不可用；下表保留可重复的操作与断言。

| 场景 | 实际结果 |
| --- | --- |
| 底部输入栏，无参考图，自动比例 + 4K | 历史验收结果：报错且生成请求数为 0；中间版本曾取消阻断，本轮恢复 2K/4K 阻断，未重跑页面验收 |
| 底部输入栏，600x800 参考图 + 自动比例 + 4K + 高清 | 请求 `size=2480x3312`、`quality=high`，携带 1 张参考图 |
| 同一竖图，手动选择 1:1 + 4K | 请求 `size=2880x2880`、`quality=high`，携带 1 张参考图 |
| 同一竖图，手动选择 16:9 + 4K | 请求 `size=3840x2160`、`quality=high`，携带 1 张参考图 |
| 编辑历史中的自动比例参考图任务 | 恢复 GPT Image 2、自动比例、4K、高清和参考图；编辑操作不产生生成请求 |
| 单图弹窗提交恢复后的任务 | 请求 `size=2480x3312`、`quality=high`，携带 1 张参考图 |
| 批量入口，仅勾选 1 行、数量 1，上传竖图，自动比例 + 4K + 高清 | 请求 `size=2480x3312`、`quality=high`，携带 1 张参考图 |

以上仅验证页面交互和真实应用代码组装出的请求。模拟响应和图片夹具不用于证明上游出图像素、账单或预览缓存正常；官方 multipart、通用和异步渠道本轮仍由自动回归覆盖，未逐一执行浏览器验收。

## 回归命令

在仓库根目录执行：

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  --config packages/drawnix/vite.config.ts \
  packages/drawnix/src/services/__tests__/{image-resolution-intent,image-resolution-routing,tuzi-gpt-image-adapter,gpt-image-adapter,default-image-adapter,image-routing-adapter-integration,model-adapter-registry,media-executor,task-queue-service-image-retry,image-generation-service,ai-generation-preferences-service,async-image-api-service}.test.ts \
  packages/drawnix/src/services/media-api/image-api.test.ts \
  packages/drawnix/src/utils/__tests__/image-task-prefill.test.ts \
  packages/drawnix/src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  packages/drawnix/src/constants/__tests__/model-config.test.ts \
  packages/drawnix/src/mcp/tools/__tests__/image-generation.test.ts --silent
```

`--no-experimental-webstorage` 仅用于避开本机 Node 26 的 localStorage 与 jsdom 冲突，不修改项目配置或真实浏览器数据。

## 已覆盖断言

- GPT 专用渠道 `auto/缺省 size + 2K/4K` 无参考图时拒绝提交；`auto + 1K` 保留兼容，不强制补 `size`。该项在本轮高风险修复中重新验证。
- `1024x1024/2048x2048 + 4K` 映射为 `2880x2880`；没有 K 档的合法显式像素尺寸保持兼容。
- 参考图 `1086x1448 + 4K` 在 Tuzi JSON 和官方 multipart 路径都得到 `2480x3312`。
- 第一张参考图缺尺寸时读取第一张，不借用第二张宽高；读取失败不提交；明确比例不被参考图覆盖。
- `1000x1001` 维持近方形，结果满足面积和网格限制；无效比例、无效档位被拒绝。
- Seedream 同时兼容 resolution 与 seedream_quality，像素尺寸不能绕过档位；5.0 lite 不接受 4K。
- 通用队列分支把顶层/嵌套 K 档传入其 quality 字段，auto 不变成方图；无法传档的异步路径在提交前失败。
- 多图工作流和批次步骤保留 URL/尺寸对应；MCP 不把缺省尺寸、auto 或自定义比例改成 1:1。
- 两种回填入口恢复档位、画质和参考图尺寸；已有任务重试持久化测试保持通过。
- 结果宽高随有效输出 URL 保留，缺少 URL 的响应项不会导致宽高错配。

## 未执行与已知限制

- 已执行上表所列模拟渠道页面交互；未执行真实渠道页面端到端测试、截图对比或视觉回归。
- 未发送真实生成请求；没有验证线上渠道是否接受请求、实际输出像素或扣费。上线前应对每个实际启用的模型/渠道抽样核对请求、响应和账单。
- 未运行全仓所有测试。额外尝试的原有 `utils/__tests__/ai-input-parser.test.ts` 因 settings-manager mock 缺少 providerPricingCacheSettings 无法正常收集；补齐 mock 的临时诊断还暴露旧标记语法预期与现实现不一致。本次未保留该无关测试修改，未将它计入 181 个通过用例。
- 未修复与本任务无关的 35 个 ESLint 基线错误。
- 无参考图的 GPT `auto + 2K/4K` 和 Seedream `auto + 显式档位` 会在提交前拒绝；当前渠道没有已确认的独立 `resolution` 字段，因此不再允许这类请求静默按上游默认档位生成。`auto + 1K` 保留历史兼容行为。

## 后续人工验收

上述历史本地模拟请求验收已完成；本轮高风险修复未重新执行页面验收。仍待取得真实渠道和收费测试授权后，抽样运行参考图 + 自动比例 + 4K，并核对上游请求日志、下载原图的真实像素和账单。该上游验收尚未执行，不能由模拟渠道结果替代。

## 前轮修复（2026-09-19）

- 修复直接生成和 fallback 路由在 URL 转 base64、去重后丢失参考图宽高的问题；尺寸元数据按源 URL 合并并重映射，首图已有尺寸时不会再次读取或误用第二张图。
- 修复任务编辑、重试和批量入口的参数回填：按 invocation route/modelRef 的实际模型迁移 GPT/Seedream/Gemini 档位，并在批量参考图提交前保存首图尺寸。
- 新增直接 `generation-api-service`、元数据合并/重映射、有效模型回填和 Seedream 绑定模型回归测试。
- 聚焦分辨率与受影响路径测试：`435 passed / 1 failed`；失败为既有 `task-queue-service-image-retry` 测试缺少 `window.location.origin` 的模拟环境问题，与本次改动无关。
- TypeScript 检查、Vite 生产构建和 `git diff --check` 通过；本次改动文件的 ESLint 对照无新增错误（仍有 75 个历史错误）。
- 当时无参考图的 `auto + K` 允许提交但不伪造协议字段，有参考图时映射为对应像素尺寸。该放行策略已被本轮高风险修复中的 GPT 2K/4K、Seedream 显式档位阻断替代。
