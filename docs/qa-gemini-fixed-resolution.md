# Gemini 图片参数、加载与恢复 QA

## 范围与行为

2026-10-15，工作目录 `opentu-4`，分支 `dev/restore-canvas-image-loading`，
基线 `3d84bb7c`。记录本地 Gemini 分辨率参数、Tuzi 模型显示名、图片获取和
缓存恢复改动。本文合并 QA 与维护说明，不另建 DOC；以下分阶段记录为当时状态，
最终提交与上游同步状态见文末。

`gemini-3.1-flash-image-preview-4k` 的模型目录配置为 4K，但原请求构造只读取
`quality`，缺省时不发送 `generationConfig.imageConfig.imageSize`。
本地代码可确认参数缺失；上游是否因此默认到 1K，仍需线上请求与结果验证。

修复在 `utils/gemini-api/services.ts` 内补齐：显式 `quality` 优先，否则从模型 ID
中的完整 `1k`/`2k`/`4k` 分段推断，兼容 `-4k-vip` 等变体。Google
`generateContent` 请求发送 `generationConfig.imageConfig.imageSize`；
`/images/generations` 请求发送 `quality: "2k"` 或 `quality: "4k"`。
当请求使用映射表支持的宽高比或可约分至这些比例的像素值时，OpenTu 会按档位重新计算并发送
`size`：例如 2K 的 16:9 为 `2048x1152`，4K 的 16:9 为 `3840x2160`，
4K 的 1:1 为 `4096x4096`。这样 Tuzi 可以仅依据 `size` 识别上游档位，避免
4K 方图请求仍携带 `2880x2880`。本地测试未验证上游具体的档位判定算法。
没有后缀、没有显式质量的普通模型仍省略该字段；Nano Banana 2.1 原有 1K 默认值与
Thinking 保留。`size: auto` 只控制比例省略，不删除固定分辨率。模型 ID、参考图和
旧任务数据不改写。

## 图片获取与参数验证（2026-10-15）

环境：macOS、Node v26.8.1、pnpm 10.21.0、Vitest 3.2.4；使用现有依赖。
测试均使用 mock 请求，不发送真实供应商请求。

| 项目 | 结果 |
| --- | --- |
| drawnix 图片、缓存、插入、模型发现、Gemini 参数与适配器回归 | 11 文件、224 项通过，无跳过 |
| SW 图片请求判定及视频、内存缓存、静态路由回归 | 6 文件、42 项通过，无跳过 |
| drawnix TypeScript | 通过 |
| Web TypeScript | 通过 |
| SW 生产构建 | 通过，59 模块，输出 `dist/apps/web/sw.js` |
| 当日 17 个修改文件 ESLint | 12 errors、66 warnings；与 HEAD 内容逐项比对，无新增问题 |
| 差异检查 | `git diff --check` 通过 |

覆盖固定 2K/4K、4K VIP、显式质量优先、普通模型缺省不变、1K/2K/4K 配合参考图与
16:9 比例、自动比例、`generateContent` 和 `/images/generations` 最终请求 JSON
中的 2K/4K 字段与精确模型路径，以及共享同步请求构造器和原有
Nano Banana 2.1 超限参考图/非法参数拒绝、Thinking 和图片响应处理回归。

新增测试还覆盖主动下载的请求选项、签名 URL 不变、普通图片/视频/API 请求不匹配
放行判定、音视频不添加图片头、缓存来源元数据、损坏图片恢复并写回、恢复 HTTP 403/
空响应/解码失败、加载失败不插入空白节点，以及原有取消、无效媒体校验和画布插入原子性。

ESLint 报错涉及原有模块边界、导入位置、正则空格、prefer-const 和 SW 既有条件/
try-catch 等问题。用 ESLint API 和相同配置对 `git show HEAD:<path>` 内容逐项比对，
当前及基线均为 12 errors、66 warnings，规则/级别/消息无新增问题。
测试环境另输出 Node 26 localStorage/IndexedDB 不可用警告、模块注册弃用警告及
本地 `.npmrc` 的 NPM_TOKEN 占位符警告，测试断言全部通过。

在仓库根目录重复验证：

```sh
pnpm --dir packages/drawnix exec vitest run --config vitest.config.ts \
  src/data/image.test.ts \
  src/services/canvas-operations/canvas-insertion.test.ts \
  src/services/media-api/image-api.test.ts \
  src/services/media-executor/fallback-utils.test.ts \
  src/utils/gemini-image-size.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/utils/gemini-api/services.test.ts \
  src/utils/gemini-api/apiCalls.test.ts \
  src/services/__tests__/default-image-adapter.test.ts \
  src/constants/__tests__/model-config.test.ts \
  src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts
pnpm exec vitest run --config apps/web/vite.sw.config.ts \
  apps/web/src/sw/image-fetch-response.spec.ts \
  apps/web/src/sw/video-fetch-response.spec.ts \
  apps/web/src/sw/completed-image-cache.spec.ts \
  apps/web/src/sw/video-memory-cache.spec.ts \
  apps/web/src/sw/static-cache-retention.spec.ts \
  apps/web/src/sw/app-shell-routing.spec.ts
pnpm --dir packages/drawnix exec tsc -p tsconfig.lib.json --noEmit
pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit
pnpm exec vite build --config apps/web/vite.sw.config.ts
git diff --check
```

## Gemini 返回图片加载修复

用户反馈仅 Gemini 图片生成任务出现“插入失败：图片加载失败”。日志中的生成接口为
`/v1/images/generations`，此前检查返回地址可读，HTTP 200、`image/png`、1024x1024、
文件指纹与日志一致；已确认并修补图片缓存 Blob 解码失败时缺少原图恢复的路径，
但尚未在用户浏览器复现完整根因。

远程图片写入本地虚拟缓存时，现在为图片缓存记录原始返回地址。画布读取虚拟缓存图片
时，如果缓存 Blob 有内容但浏览器解码失败，会使用该原始地址重新下载，检查 HTTP 状态、
非空内容与解码结果，写回同一个虚拟地址，再读回验证后插入。下载设 30 秒超时，包含响应体读取；
恢复失败显示错误。旧缓存没有来源地址时仍返回原错误。恢复过程不调用生成接口，
图片实际加载成功后才插入画布的行为保留。

“正在显影”阶段也存在重复等待：SW 读取完整 Blob、写缓存和发送通知后才返回响应，
应用随后还要读取、校验及缓存；网络错误时 SW 还有独立的重试预算。
尚未在用户浏览器测量其耗时占比，不能据此排除源站、CDN 或网络慢的问题。

为避免主动原图下载被 Service Worker 重复读取 Blob、写缓存和重试，应用主动下载请求
会带 `Accept: image/*`、`cache: no-store`、`credentials: omit`、`referrerPolicy: no-referrer`，
结合 GET、空 destination 和 CORS 模式识别，由 Service Worker 放行。
应用仍负责取消、响应与文件校验、缓存和插入失败反馈；不修改签名 URL，
也不新增自定义请求头。普通 `<img>` 请求仍使用原有图片缓存与 CORS 处理，
音视频不添加图片 Accept 头。该下载路径由多种图片模型共用，并非按模型名称分流。

新增回归覆盖：缓存图片解码失败回退原地址、图片缓存来源元数据、远程图片缓存写入、
主动下载请求识别及已有图片缓存校验。此次未执行浏览器页面交互、真实生成或生产部署验证。

## Tuzi 模型显示名

设置页点击“获取模型”后，Tuzi `/models` 返回的 `id` 作为模型的 `label` 和
`shortLabel` 展示。已知模型仍复用本地的类型、默认参数和路由能力，但不再用
OpenTu 内置别名覆盖 Tuzi 返回的模型名；重新加载已保存目录时也保留该名称。其他
供应商的运行时模型和实际请求仍保持原有行为，模型 `id` 仍是唯一的请求标识。

名称验收：加载更新后的本地版本，在设置页点击“获取模型”并确认选择，模型下拉框应显示
如 `gemini-3.1-flash-image-preview-4k` 的接口名称，刷新后仍保持；手动模型保留自定义
名称。无需清空缓存或重新配置密钥。本轮未做页面交互或生产部署。

## 已生成结果的失败状态与重试（2026-10-16）

生成任务成功，但图片下载、解码或插入失败时，任务保持“已完成”，画布占位卡显示
“已生成，插入失败”，按钮显示“重试插入”。错误详情继续展示实际加载或插入原因。
批量结果中的后处理失败也区别于生成失败；旧占位卡保存的“生成失败”提示会根据当前
任务状态重新计算。新增失败阶段字段仅用于视图模型，不修改持久化任务状态或数据结构。

修复两个重试入口：占位卡不再对已完成任务调用 `retryTask(..., { allowCompleted: true })`；
自动插入的重试事件改为清理该任务的后处理记录，再使用原结果地址重新执行插入。
重新加载成功后标记已插入；再次失败仍保留原任务和原结果，不转为重新生图。
真正生成失败和已取消任务保留原有生成重试。没有新增配置、依赖或数据迁移。

本轮使用 jsdom 组件测试、Hook 和视图模型单测验证：

| 项目 | 结果 |
| --- | --- |
| 占位卡、状态模型、自动插入、状态同步 | 4 文件、83 项通过 |
| drawnix TypeScript | 通过 |
| Web 生产构建 | 通过，Vite 构建耗时 49.41 秒 |
| 本轮 7 个修改文件 ESLint | 0 errors、45 warnings；警告与 HEAD 内容逐项一致，无新增 |

覆盖已生成但插入失败的文案和按钮、点击按钮发送已有结果插入事件、插入重试成功及再次失败
均不重新生图、真正生成失败/取消的重试、旧失败文案兼容、批量后处理失败、正在执行和
已经插入的任务防重、画板切换回归。所有生成和插入服务均为 mock，不发送真实生成请求。
构建输出 Sass 弃用、Browserslist 数据陈旧、混合动态/静态导入和较大分包警告，构建完成。

```sh
pnpm --dir packages/drawnix exec vitest run --config vitest.config.ts \
  src/utils/__tests__/image-generation-anchor-view-model.test.ts \
  src/hooks/__tests__/useAutoInsertToCanvas.test.ts \
  src/components/image-generation-anchor/ImageGenerationAnchorContent.test.tsx \
  src/hooks/__tests__/useImageGenerationAnchorSync.test.ts
pnpm --dir packages/drawnix exec tsc -p tsconfig.lib.json --noEmit
pnpm exec vite build --config apps/web/vite.config.ts
```

人工验收：对已有结果但插入失败的任务，确认占位卡显示“已生成，插入失败”；点击
“重试插入”时任务 ID、结果地址和生成请求数不变，成功后图片落入画布，再次失败时保留
原结果并提示插入失败。尚未执行浏览器页面交互或真实供应商验证，改动未提交或部署。

## 任务缩略图与加载期限（2026-10-16）

截图对应的任务已经生成成功，但左侧仍是骨架并标记“需下载”。代码检查确认：
远程结果可能直接用完整 2K/4K 原图作为预览，浏览器请求不触发 load/error 时没有截止条件；
重试和缓存读取也可长期等待。异步缓存回退还可能在原图已显示后替换图片，损坏 Blob
则可能被反复重试。截图这一条任务的实际响应地址、状态码和浏览器耗时未取得，
不能确认其具体 CDN、CORS 或文件解码故障。

任务列表图片预览现在使用 eager 加载，远程图片优先尝试已有本地缓存；虚拟缩略图仍
使用原缩略图路径。预览设置 45 秒总等待期限，覆盖缓存回退和重试间隔；超过期限或
重试耗尽显示“预览暂不可用 / 重新加载预览”。按钮仅重载原结果地址，不调用生成接口，
不修改任务状态；缓存状态由不可用变为可用时也会重新尝试显示。成功后清理重试任务，
迟到的缓存回退不得覆盖已显示图片，失败的缓存 Blob 会回退原地址，签名 query 不变。

补齐之前未完成的画布加载期限：远程下载 30 秒（包含响应体）、缓存操作 20 秒、Blob
解码 15 秒，普通图片加载及其重试合计 30 秒。超时清理图片回调和重试定时器；
晚到的 load 回调不能继续插入。下载超时和缓存读写超时分别报告网络与存储警告，保留
原结果地址及已有结果重试。无 SW 的虚拟图片缓存回退失败后，直接加载只执行一轮预算。
这些是各阶段期限，不能把某一阶段的 30 秒理解为整条插入流程的总耗时上限。

没有新增依赖、配置或持久化字段；旧任务、已有缓存继续兼容。外部地址没有可用本地
缩略图时仍需加载原图，本次没有推断或改写供应商 CDN 缩略图地址。浏览器缓存 API
本身不支持中止，超时后其底层写入可能继续完成，但不会恢复已结束的画布插入。

本轮验证使用 macOS、Node v26.8.1、pnpm 10.21.0、Vitest 3.2.4，均为本地 mock：

| 项目 | 实际结果 |
| --- | --- |
| 预览、加载、缓存、插入、已生成结果重试、任务恢复及状态同步 | 11 文件、183 项通过，无跳过 |
| drawnix 与 Web TypeScript | 通过 |
| 最终 Web 生产构建 | 通过，50.48 秒 |
| 本轮 11 个源码/测试文件 ESLint 与 HEAD 比较 | 9 errors、14 warnings，均为原有问题，无新增 |
| 差异检查 | `git diff --check` 通过 |

```sh
pnpm --dir packages/drawnix exec vitest run --config vitest.config.ts \
  src/utils/image-operation-timeout.test.ts \
  src/components/retry-image.test.tsx \
  src/components/task-queue/TaskImagePreview.test.tsx \
  src/data/image.test.ts \
  src/services/media-executor/fallback-utils.test.ts \
  src/services/canvas-operations/canvas-insertion.test.ts \
  src/hooks/__tests__/useAutoInsertToCanvas.test.ts \
  src/hooks/__tests__/useImageGenerationAnchorSync.test.ts \
  src/hooks/__tests__/useTaskExecutor-image-recovery.test.ts \
  src/utils/__tests__/image-generation-anchor-view-model.test.ts \
  src/components/image-generation-anchor/ImageGenerationAnchorContent.test.tsx
pnpm --dir packages/drawnix exec tsc -p tsconfig.lib.json --noEmit
pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit
pnpm exec vite build --config apps/web/vite.config.ts
git diff --check
```

覆盖无 load/error 的挂起请求、响应头/响应体卡住、缓存读写卡住、上游取消、成功清理、
晚到回调/Blob 释放、损坏缓存回退、换源与旧重试隔离、lazy 屏外不误判超时、
预览重载及缓存恢复后自动重载。关联回归覆盖重新插入不生图、再次失败、画板切换与
批量插入原子性。预期异常测试会输出下载/缓存警告；Node 26 存储、IndexedDB
缺失和构建中的既有警告仍存在，测试断言通过。QA 与维护说明合并于本文件，不另建 DOC。

未执行真实页面自动化、真实供应商生成、Windows 浏览器或生产部署验证，没有读取密钥。
人工验收可直接复用已有任务：打开任务列表看预览；网络不通时等候提示并点击
“重新加载预览”，确认任务结果和生成请求数不变；恢复网络后再确认预览及画布插入。
本地通过不代表已测得用户侧 CDN 耗时下降。

## 限制与验收

- 未执行浏览器交互、真实生成、计费或生产环境验证。本地单测与构建
  不证明用户侧耗时已下降，也不证明供应商按 4K 生成；本轮未读取 API Key。
- 更新应用和 SW 后，用已有 Gemini 生成结果验收取图、插入与刷新后读取，分别记录
  原图请求和本地载入耗时。旧 SW 尚未激活时仍可能走原有下载路径；无需清空用户图片缓存。
- 另行授权真实生成后，4K 验收应核对 `generateContent` 的 `imageSize: "4K"` 或
  `/images/generations` 的 `quality: "4k"` 与 `size`，再核对实际像素和服务端识别档位。
- 无新增依赖、环境变量或数据迁移；用户无需重新设置。既有 1K 结果不能恢复成 4K。
- 未部署；提交与上游同步状态见文末。可回退本次代码与 SW 构建恢复旧路径；新增来源
  元数据为可选字段，旧代码可忽略。没有额外部署顺序要求。

## PR 提交前复核（2026-10-16）

- 实现提交：`528d01c1`；显式 fetch 并 merge 官方 `upstream/develop`
  （`3d84bb7c`），已是最新，无合并冲突。
- 本次重跑 drawnix 关联测试 11 文件、201 项通过，SW 6 文件、42 项通过；
  drawnix 与 Web TypeScript、`git diff --check` 通过。此前最终构建结果见上文，
  实现代码未在复核期间变动。既有 Node 存储和环境占位符警告仍存在。
- 以官方仓库新分支 `dev/gemini-image-result-recovery` 向 `develop` 提交 PR；
  不覆盖已合并 PR 的同名历史分支，不强推、不改写历史。
- 未执行页面交互、真实供应商、Windows 浏览器及生产部署验证；本地结果不代表
  CDN 延迟或上游实际 4K 出图已验收。
