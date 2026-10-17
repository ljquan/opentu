# Tuzi GPT Image 蒙版编辑 QA

## 范围与结果

在画布图片上使用蒙版画笔后，提交时会读取当前目标上的蒙版，不依赖任务栏跟随开关；跟随模式和普通参考图模式都会保留编辑信息。蒙版在凭据流程转交请求前导出，恢复提交时保留该快照。Tuzi GPT Image 适配器随后发送 `POST /v1/images/edits` multipart 请求，图片文件使用重复的 `image[]` 字段，蒙版文件使用 `mask` 字段。普通文生图与不带蒙版的参考图编辑仍走 JSON `/v1/images/generations`。准确的 Tuzi 模型 ID `image-2.5` 也会路由到 Tuzi 适配器并保留原 ID；此别名只在 Tuzi provider 生效。

蒙版编辑沿用当前 Tuzi GPT Image 模型 ID、尺寸、画质、分辨率、输出格式、压缩率、响应格式、moderation 和 user 参数；支持 `input_fidelity`。适配器不设置 multipart `Content-Type`，由 Fetch 生成 boundary。旧模型别名重试会重新构造相同的 multipart 文件和字段。

画布缓存中的源图和蒙版按原始 Blob 读取；源图不会经过普通参考图的 1 MB 压缩。缓存不可读取、图片读取失败或任务取消时，在提交请求前失败。服务端编辑错误直接返回，不降级为普通生成。

## 2026-10-12 局部编辑区域异常排查

用户在 `localhost:7205` 涂抹左侧杯子，但返回图改变了中间杯子。只读核对用户已有日志：18:49:41 的 `gpt-image-2.5` 请求已走 `/v1/images/edits`。本地任务为 `image_edit`，具有独立 `maskImage`、原图引用和目标元素 ID。

从该任务的原始缓存 Blob 解码得到：原图为 **1254×1254**，旧蒙版为 **400×400**，返回图为 **1254×1254**。旧蒙版透明区域在左侧，未发现反选；存在已确认的原图与蒙版尺寸不一致。原实现读取虚拟图片失败时回退到画布矩形尺寸，也可能直接采用元素的显示宽高。

修复后，虚拟图片通过原始缓存 Blob 读取像素尺寸，远程图片通过实际解码读取尺寸，均不回退到画布宽高。原图读取、解码或必要的同步缩放失败时阻止提交。选区返回的尺寸同步使用原图像素尺寸。

使用用户同一原图与现有笔迹，在本地页面内只构造临时蒙版及 FormData（`cacheMask: false`，不保存画布、不提交网络生成）核对：`image[]` 和 `mask` 均为 **1254×1254 PNG**，路由为 `/images/edits`；抽样透明区域仍在左侧，中间和右侧杯子区域不透明。临时 Blob URL 已释放。这验证了文件尺寸和区域映射，不代表已验证供应商对修复后的请求生成正确结果。

## 自动化验证历史

以下为各修复阶段的记录；最终复核与真实供应商测试以文末 2026-10-13 结果为准。

### 输入框蒙版预览修复

截图中画布有灰色蒙版笔迹，但输入框悬停只显示原图。绑定目标的 `selectedContentFromBoundTarget` 未包含蒙版；提交前的蒙版准备不回写显示数据，因此预览和提交来源不同。

新增 `BoundImageContentPreview` 使用选中图片 ID 读取蒙版，复用原有“原图 + 独立蒙版”预览组件。首次选中和 pointerup/keyup/选区刷新事件更新，笔迹签名不变时不重复导出，鼠标移动与滚轮不触发导出。换图或移除笔迹时清除旧预览；异步结果按当前目标和修订号过滤。悬停层读取最新 item，不再保留鼠标进入时的旧蒙版快照。预览失败显示错误，提交仍重新读取最新画布蒙版，未将黑色笔迹合成进原图。

执行 `pnpm exec vitest run src/components/ai-input-bar/BoundImageContentPreview.test.tsx src/components/ai-input-bar/image-mask-submission.test.ts src/components/ai-input-bar/target-bound-taskbar-state.test.ts src/components/ai-input-bar/__tests__/workflow-converter.test.ts src/utils/__tests__/selection-utils.test.ts src/utils/__tests__/ai-mask-brush.test.ts`：6 文件、143 测试通过。新增组件测试验证缩略图与悬停双预览、笔迹更新/删除、无高频重复导出、换图迟到结果隔离和失败重试。类型检查、Web 构建和改动文件 ESLint 无 error；未执行真实浏览器页面点击或供应商生成。

### 普通参考图模式补充验证

用户随后反馈左侧杯子被涂抹，后方绿色杯子却改变。读取 localhost:7205 的最新任务：20:11:40 和 20:13:14（Asia/Shanghai）的两次任务均引用同一杯子原图，但 `maskImage` 和 `generationMode` 均缺失。实际本地 `aitu_ai_bound_target_follow_enabled` 为 `false`；此前入口仅检查 follow 模式的 `activeBoundImageTarget`，导致参考图模式漏掉蒙版。

补充修复将蒙版准备与结果是否替换原图分离，并在凭据转交前完成；恢复提交时不以无蒙版的预览引用覆盖已经准备好的引用。语义分层替换继续使用其专用蒙版。

用该用户当前原图、画布笔迹及关闭跟随的设置调用实际提交准备函数，并构造最终 FormData：`hasMask: true`，路径 `/images/edits`，`image[]` 和 `mask` 均为 1254×1254。未调用供应商；只清理了本次诊断新建的临时蒙版缓存，未修改用户画布或历史蒙版。

本轮命令（在 `packages/drawnix`）：

```sh
pnpm exec vitest run src/components/ai-input-bar/image-mask-submission.test.ts src/components/ai-input-bar/target-bound-taskbar-state.test.ts src/components/ai-input-bar/__tests__/workflow-converter.test.ts src/utils/__tests__/selection-utils.test.ts src/utils/__tests__/ai-mask-brush.test.ts src/services/__tests__/tuzi-gpt-image-adapter.test.ts src/services/__tests__/image-routing-adapter-integration.test.ts
```

结果：7 文件、222 测试通过；包含跟随开/关、凭据快照、其他图片隔离、语义替换兼容、非图片生成兼容、无蒙版与导出失败。类型检查及 Web 构建通过；本轮入口及新测试 ESLint 无 error，保留已有警告。供应商是否严格局部编辑仍未重测。

后续绑定修复已补上新笔迹的图片归属 ID，移动和缩放会同步点位与线宽，删除图片会同时删除所属蒙版；撤销/重做作为同一历史批次恢复。多选中已选笔迹由 Plait 原变换更新，避免重复移动；粘贴到新图片位置时重新关联目标。导出扫描排除属于其他图片的笔迹。旧笔迹仅在与一张图片唯一重叠时跟随，不猜测已经移开的历史笔迹归属。

绑定最终回归命令为上面的 7 文件加 `src/plugins/freehand/__tests__/image-mask-binding.test.ts` 与 `src/plugins/freehand/__tests__/hand-mode.test.ts`，覆盖新笔迹绑定、重叠目标隔离、移动、缩放、撤销/重做、多选移动、重新加载、删除恢复、粘贴重新绑定和非蒙版兼容。结果为 9 文件、239 测试通过；类型检查、Web 构建和新增文件 ESLint 通过。测试使用真实 Plait 操作及历史对象，不依赖真实页面点击，也没有触发供应商生成费用。

已知限制：已经移开的历史笔迹需要重新对齐或重画；旋转和 3D 图片仍不支持蒙版编辑。普通参考图新建结果未统一应用本地蒙版外像素保护，不能承诺供应商返回图的蒙版外像素完全不变。复制图片时未单独选中的笔迹不会自动复制。

### 尺寸与接口基础验证

2026-10-12，本地 Node/Vitest 环境：

```sh
pnpm exec vitest run \
  src/services/__tests__/tuzi-gpt-image-adapter.test.ts \
  src/services/__tests__/gpt-image-adapter.test.ts \
  src/services/__tests__/image-routing-adapter-integration.test.ts \
  src/services/__tests__/media-executor.test.ts \
  src/services/__tests__/model-adapter-context.test.ts \
  src/services/__tests__/provider-routing.test.ts \
  src/services/__tests__/model-adapter-registry.test.ts \
  src/utils/__tests__/ai-mask-brush.test.ts \
  src/utils/__tests__/selection-utils.test.ts \
  src/components/ai-input-bar/target-bound-taskbar-state.test.ts \
  src/components/ai-input-bar/__tests__/workflow-converter.test.ts
```

在 `packages/drawnix` 目录执行，最终结果：11 个测试文件、411 项测试通过。覆盖显示尺寸 400px/原图 1254px 的坐标缩放、远程图片自然尺寸、本地缓存丢失、解码失败、临时 URL 清理、绑定目标读取画笔、蒙版导出失败、工作流保留 image_edit、image-2.5 Tuzi 隔离路由、日志与请求路径一致、multipart 字段、参数白名单、重复参考图、本地原始缓存 Blob、别名重试、取消、服务端错误和无蒙版旧路径。

```sh
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
NX_DAEMON=false pnpm exec nx run web:build
git diff --check
```

上述类型检查、Web 类型检查与构建（应用和 Service Worker）及差异空白检查通过。构建保留了已有 Sass 弃用和大 chunk 警告。相关文件 ESLint 检查未通过既有规则问题：`gpt-image-adapter.ts` 在修改前即有 `@nx/enforce-module-boundaries` 错误；`media-executor.test.ts` 存在大量原有 `no-empty-function` 错误。本次适配器和新增执行器测试未引入新的 ESLint error。

本次尺寸修复另检查 `ai-mask-brush.ts`、`selection-utils.ts` 及两者测试文件：ESLint 有 18 个既有错误（测试空 setter、原有模块边界和类型注解），通过 `git show HEAD:<file>` 输入同一 ESLint 规则核对基线；没有新增 error。

## 2026-10-13 真实 Tuzi 接口测试

用户授权后，使用 localhost:7205 中 13:15:23 的任务 `91c800fd-38f6-4ca1-88b1-129ae48dad7e` 对应原图、蒙版及客户端 FormData 构造器导出的字段，在后台直接发送一次 `POST https://api.tu-zi.com/v1/images/edits`。模型为 `gpt-image-2.5`，提示词为“这个杯子换成红色”，`size=auto`；为保存返回图片，测试补充 `response_format=b64_json`。此次测试产生真实生成调用，未重复请求。

| 检查项 | 实际结果 |
| --- | --- |
| 原图文件 | PNG，1254×1254，1,850,719 bytes |
| 蒙版文件 | PNG，1254×1254，39,508 bytes |
| 文件字段 | `image[]` 与 `mask`，Fetch 自动生成 multipart boundary |
| 蒙版区域 | 左侧杯子抽样 alpha=0；后方、前方和右侧杯子抽样 alpha=255 |
| 可编辑区域边界 | 忽略既有边缘透明带后，x=25..268，y=328..826 |
| 接口结果 | HTTP 200，耗时 29,361 ms，返回一张 base64 图片 |
| 编辑效果 | 后方粉色杯子变红，涂抹的左侧杯子仍为蓝色，局部编辑验收失败 |
| 请求追踪 | `x-request-id=93ed5627`；`x-oneapi-request-id=202610130601072283179378268d9d6QQluXEPa` |

原图 SHA-256 为 `61c701ea046a2167c0ba7785df704b52e96453334d3d5e5cf7dd57ea3b0c7004`，蒙版 SHA-256 为 `72594b4253293dadd1c72de0d994c5351a4ce60221a9a95d19114f4ec1fefe5e`。本地临时证据保存在 `/tmp/opentu5-mask-direct-20261013/`，未放入仓库；临时目录不能作为长期附件。密钥仅在测试进程内读取，未写入请求证据、源码或文档。

这次直接请求复现了错误对象被修改，说明修正客户端文件尺寸和字段后，供应商路径仍存在效果问题。仅凭客户端证据无法判定是 Tuzi 网关未透传蒙版，还是上游未正确执行蒙版；需要按上述请求 ID 查服务端日志。HTTP 200 只代表请求成功返回，不代表精确局部编辑通过，也不代表所有客户端提交路径均已真实验证。

## 2026-10-13 最终本地复核

环境为 macOS、当前本地 `develop` 工作区，基线 HEAD 为 `c3bbad5d`。通过 `open-code-review-delegate` 的文件与规则选择后，人工检查 16 个生产代码文件，16/16 已审查、0 跳过、覆盖率 100%；另外核对 10 个测试文件和现有 QA/DOC。此次未发现新增阻塞性代码问题。供应商效果失败仍是交付限制。

在 `packages/drawnix` 执行：

```sh
pnpm exec vitest run \
  src/services/__tests__/tuzi-gpt-image-adapter.test.ts \
  src/services/__tests__/gpt-image-adapter.test.ts \
  src/services/__tests__/image-routing-adapter-integration.test.ts \
  src/services/__tests__/media-executor.test.ts \
  src/services/__tests__/model-adapter-context.test.ts \
  src/services/__tests__/provider-routing.test.ts \
  src/services/__tests__/model-adapter-registry.test.ts \
  src/utils/__tests__/ai-mask-brush.test.ts \
  src/utils/__tests__/selection-utils.test.ts \
  src/components/ai-input-bar/target-bound-taskbar-state.test.ts \
  src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  src/components/ai-input-bar/BoundImageContentPreview.test.tsx \
  src/components/ai-input-bar/image-mask-submission.test.ts \
  src/plugins/freehand/__tests__/image-mask-binding.test.ts \
  src/plugins/freehand/__tests__/hand-mode.test.ts
```

结果：15 个文件、443 项测试全部通过，包含提交成功、缺失或失效缓存、导出失败、取消、服务端错误、无蒙版兼容、官方适配器回归、凭据快照、笔迹归属及历史操作、输入框预览更新与迟到结果隔离。

仓库根目录的 `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`、`NX_DAEMON=false pnpm exec nx run web:build` 与 `git diff --check` 均通过。构建保留 Sass 弃用和大 chunk 警告，pnpm 提示 `.npmrc` 的 `NPM_TOKEN` 环境变量未设置，未阻止检查。

26 个改动的 TS/TSX 文件均执行 ESLint，结果为 82 errors、83 warnings，因此不能报告整体 lint 通过。对出现 error 的 5 个文件使用 `git show HEAD:<file>` 内容输入相同 ESLint 配置，核对规则、消息及数量：`media-executor.test.ts` 63、`gpt-image-adapter.ts` 1、`ai-mask-brush.test.ts` 5、`selection-utils.test.ts` 6、`selection-utils.ts` 7；与基线相同，未新增 error。

## 未执行与人工验收

2026-10-13 已完成上述一次真实 Tuzi 调用，编辑效果失败。本次 PR 准备未增加生成调用，未运行页面点击生成、完整端到端测试、Windows 验证、远程 CI 或部署验收。后端仓库本地源代码不代表当前线上部署版本。未提交、推送、创建 PR 或部署；未 fetch/merge 上游，本地已记录的 `origin/develop` 比 HEAD 多 4 个提交，实际远程最新状态及合并冲突尚未验证。

人工验收：选择一张画布图片，使用截图中的蒙版画笔在局部涂抹，选择 Tuzi GPT Image 并提交编辑；确认被蒙版区域按提示词变化，未蒙版区域得到保留，原图尺寸不匹配、蒙版缓存过期或渠道拒绝 edits 时看到明确错误，且没有额外发出 generations 请求。

旧任务会保留旧蒙版文件，验收应从画布重新提交以导出新蒙版，不使用旧任务重试作为本次尺寸修复的验收。若原图和蒙版尺寸已一致且区域正确，供应商仍修改其他杯子，应继续检查服务端蒙版透传与渠道执行效果，不能只凭 edits 路径判断通过。
