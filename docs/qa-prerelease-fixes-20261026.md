# 2026-10-26 预发布清单修复与本地验证

本轮在 `/Users/lkj/Desktop/working/opentu-4`、`develop`、基线 `3386b632` 上诊断并修复 F1、F3、F4、F5。按用户明确要求，F2「GPT 自动比例 + 2K」不修复；GPT 适配器、尺寸矩阵和比例语义均无改动。保留同一工作区前一轮的参考连线显示开关。以下先记录实现与实测阶段，用户随后授权的 PR 准备与最终验证见文末；尚未合并或部署。

## 问题、根因与处理

| 编号 | 已核实的原因 | 本地处理与边界 |
| --- | --- | --- |
| F1 | Seedream 适配器固定请求 `response_format=url`；既有证据显示签名图片源未提供 CORS 响应头，浏览器抓取字节失败。 | 改为请求 `b64_json`，并优先读取 Base64 字节，沿用现有内容哈希缓存路径。PNG/JPEG 根据内容识别格式，不转换图片编码。供应商只返回 URL 时保留既有抓取、缓存失败标记和下载路径，不自动重提生成。后续授权实测确认当前通道返回 Base64；真实接口与本地浏览器回放证据见下文，部署验证仍未执行。 |
| F3 | 缩放/拆分走通用选区下方插入；通用布局按默认方形估计图片尺寸，未调用来源关系的碰撞避让。 | 两个入口传递来源 ID。插入前读取输出图并确定显示尺寸，复用来源右侧列布局和避让逻辑，同时避开图片、生成锚点保留区域及任务卡片。连续结果与不同宽高比的分片保持间距，不移动已有对象。 |
| F4 | 工具文字被加入原图标按钮，但父 Stack 使用 `min-content` 列宽，按钮没有文字模式的宽度及禁止换行样式。 | 图片文字模式使用独立横向容器，文字按钮按内容宽度排列，标签不逐字换行。窄屏可横向滚动；保留更多菜单、隐藏工具、本地偏好及紧凑图标模式。未修改其他类型工具栏。 |
| F5 | Gemini 结果适配器只提取图片内容；任务结果没有 `width/height` 时，详情只读元素/任务字段，不读取原图自然像素。 | 图片详情打开且缺少尺寸时读取原图自然像素。虚拟资源只读原图 Cache Storage，不用缩略图或请求尺寸兜底；未知继续显示未记录。稳定 URL 的尺寸按元素 ID/URL 保存到 `imageNaturalSize`，刷新后可读，不改画布显示尺寸或撤销历史。画板切换、原图替换、关闭详情及只读画板不会产生迟到写入。内联 data URL 可读取尺寸，但不在元数据中复制整段 Base64。 |

维护入口：`seedream-adapter.ts`；`resize-canvas-image.ts`、`insert-split-images.ts` 和 `canvas-insertion.ts`；`image-toolbar-contents.tsx` 与 `canvas-image-tools.scss`；`canvas-image-details-dimensions.ts`、`canvas-generation-details-source.ts` 和 `image-details-button.tsx`。新增的内部可选参数 `referenceElementIds` 仅由本地缩放/拆分使用，其他通用插入调用保持原布局。

F1 的公开资料核对使用火山官方 Python SDK 的 [图片请求定义](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/resources/images/images.py)和[图片响应定义](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/images/images.py)，确认存在 `response_format` 请求字段及 `b64_json` 响应字段。它们不代替当前 Tuzi 渠道的真实兼容验证。本次没有修改服务端代理或全局 CORS。

## 实际本地验证

初次代码修复阶段环境：macOS，Node.js 26.8.1、pnpm 10.21.0。该阶段复用既有原始测试记录和本机保存的图片，没有调用收费生成接口，也没有操作线上画板。后续用户授权的真实接口及页面复测单独记录于下文。

在 `packages/drawnix` 执行：

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/services/model-adapters/__tests__/seedream-response.test.ts \
  src/services/__tests__/seedream-alias-parameters.test.ts \
  src/services/media-executor/fallback-utils.test.ts \
  src/services/canvas-operations/canvas-insertion.test.ts \
  src/services/canvas-operations/resize-canvas-image.test.ts \
  src/services/canvas-operations/insert-split-images.test.ts \
  src/utils/__tests__/image-generation-lineage-placement.test.ts \
  src/utils/canvas-generation-details-source.test.ts \
  src/utils/canvas-image-dimensions.test.ts \
  src/components/toolbar/popup-toolbar/image-details-button.test.tsx \
  src/components/settings-dialog/image-toolbar-settings.test.tsx \
  src/plugins/canvas-association-line.test.ts \
  src/plugins/canvas-association.test.ts --silent
```

结果：13 个文件、165 项测试全部通过。覆盖 Base64 请求及响应优先级、JPEG 字节与 MIME 保留、缓存写入验证/失败提示/取消、来源右侧和任务占位避让、连续结果及三张不同宽高比分片、原图与画板保护、原图像素展示和 JSON 恢复、无原图不取缩略图、迟到回调隔离、原有 GPT/本地缩放详情，以及参考连线删除、撤销与显示开关回归。

根目录验证：

- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- `pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit`：通过。
- `pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu4-prerelease-web.1osryJ`：通过；保留既有 Sass、Browserslist 和大 chunk 等警告。
- `pnpm exec vite build --config apps/web/vite.sw.config.ts --outDir /tmp/opentu4-prerelease-sw.QgaS84`：通过。
- 16 个新增或完整格式化的相关源码/测试/样式文件 Prettier 检查通过；历史混合格式的大文件仅做局部修改。`git diff --check` 通过。
- 对 15 个相关 TypeScript/TSX 文件执行 ESLint：4 个错误、61 条警告。错误为 Seedream 适配器及 popup-toolbar 的既有 Nx 静态/懒加载边界，popup-toolbar 的既有 `location` 使用，以及 canvas-insertion 测试的既有导入顺序。对三个有错误的文件分别以 `git show HEAD:<path>` 输入 ESLint，复现完全相同的错误和相同警告数量；本轮新增模块没有 lint 错误或警告，不宣称全量 lint 通过。
- 循环依赖扫描仍被原有检查工具阻断：`scripts/check-cycles.js` 严格解析含尾逗号的 `tsconfig.base.json`，报第 25 行 JSON 解析错误；不是已经完成扫描的结果。
- 本地 `http://localhost:7204/` 返回 HTTP 200；仅代表服务可达。

## 待核实项与未执行项

- V1：现有请求/文件证据确认 Gemini 请求和输出像素不同；目前没有供应商精确像素承诺或服务端出站日志，不能归因为前端尺寸矩阵错误。本轮只显示实际像素，不改写请求尺寸。
- V2：提示词要求无水印不等于供应商承诺关闭标识。当前模型参数约定已明确撤回新增水印控制；本轮不重新暴露该控制，不抹除或裁剪原图标识。
- V3：既有记录只有模型健康、SW 更新和端点加载警告；界面阶段的网络证据文件明确没有捕获 CDP 网络事件，无法据此确定失败请求的频率和根因。保留待核实，不将其改为前端缺陷或扩展到部署重构。
- 初次代码修复阶段未执行页面、窄屏视觉及真实供应商验证；后续授权复测补齐的范围见下文。预发布/生产部署、旧签名链接到期及任务卡片附近的真实页面摆放仍未验证。
- F1 对新结果优先请求字节，不能凭本地改动宣称旧临时链接已修复。已有 A5 原图仍保留在本机 `/Users/lkj/.codex/visualizations/2026/10/26/opentu-model-qa/A5-seedream.jpeg`，可作为恢复来源；本轮没有重写线上图片 URL。

剩余人工验收：任务卡片/活动 WorkZone 附近的插入、A4 单独的详情路径，以及部署后的真实浏览器到供应商完整链路。本地 A3、其他图片避让、窄屏、缓存和刷新已按下文复测；单次缩放的完整撤销需要 3 次按键，不能记为单步撤销通过。

## 2026-10-26 用户授权的真实接口与页面复测

环境：本地 Vite `http://localhost:7204/`，同一 `opentu-4/develop` 工作区；独立 Chrome 会话 `opentu4-retest-1026`，未接入用户既有浏览器配置或线上画板。桌面视口 `1764 × 875`，窄屏 `650 × 900`。本次没有修改功能代码，没有提交、推送或部署。

| 项目 | 实际操作与结果 | 结论及边界 |
| --- | --- | --- |
| F1 真实 Tuzi 接口 | 仅 1 次付费生成：`doubao-seedream-5-0-260128`、`2304x4096`、`response_format=b64_json`。HTTP 200，1 张结果，有 Base64、无 URL；实际文件 PNG、`2304 × 4096`、4,547,515 字节，文件头及完整解码均通过。 | 当前通道在此样本中支持 Base64，不代表所有模型/渠道。客户端请求标识为 `cdd73f66-a3d7-42e6-809d-2abbcc11df47`，响应未提供服务端追踪 ID。没有自动重试。 |
| F1 本地浏览器回放 | 将上述原始 PNG 字节通过只接收 1 次提交的本地服务回放，浏览器使用测试占位 Key。实际页面选择 Seedream、9:16、3K 并提交一次；适配器发出 `b64_json`，任务完成并插入画布，无 `cacheWarning`。 | 通过实际适配器、任务、缓存和渲染路径；这一步是本地回放，不能写成浏览器直接调用真实供应商的端到端验证。 |
| F1 字节、刷新及断网读取 | 原文件与浏览器 Cache Storage 的 SHA-256 均为 `61c342532538292819d7ab0791110b153a763c8730c803af9f11911164cde9d2`，MIME `image/png`，字节数及像素相同。在线刷新后图片与任务保留；`navigator.onLine=false` 时仍可从 Cache Storage 读取并解码为相同像素与哈希。 | 缓存字节一致。开发页没有 Service Worker 控制器，未声称应用可以断网冷启动；没有旧签名 URL 可用于本轮到期对照。 |
| F3 连续缩放 | 经「编辑图片 → 缩放」依次执行 0.5×、0.25×，原图 `2752 × 1536`，结果分别为 `1376 × 768`、`688 × 384`。已有原图/下方图片/右侧图片的位置不变，两张结果分别避开障碍和前一次结果。 | 主要摆放路径通过。完整撤销一次缩放需 3 次 `Meta+z`，3 次 `Meta+Shift+z` 可恢复；并非单条原子撤销。 |
| F3 拆分 | 实际设置横向切线为空、纵向 `25,75`，预览 3 张并插入，实际像素为 `688 × 1536`、`1376 × 1536`、`688 × 1536`。连同前一次 6 分片验证，画板共 14 张图片，任意图片矩形相交数为 0，原有 3 张图片坐标不变。 | 图片障碍与不同分片尺寸通过；活动 WorkZone/任务卡片的浏览器场景未覆盖，保留既有逻辑测试证据。 |
| F4 文字工具栏 | 实际开启文字、隐藏下载。桌面标签单行；650px 视口中工具栏 x=22、宽 612，内容宽 1408，可横向滚动到更多。更多菜单 x=465、宽 180、右边界 645，下载按钮可达。 | 桌面和窄屏主要路径通过。实际下载 A3 原图的哈希与输入一致，未转码。偏好刷新后保留。 |
| F5 A3 原图尺寸 | 导入缺少尺寸字段的 A3，经实际详情按钮显示 `2752 × 1536 px`；元素保存绑定原 URL 的 `imageNaturalSize`，刷新并重新打开详情仍显示同值，画布坐标不变。 | A3 的读取、持久化和显示通过；未另测 A4。回放的 Seedream 图片也显示实际 `2304 × 4096 px`。 |

参考线及红点补充：初始「显示工具文字」「显示参考图连线」均未勾选；打开参考线后 11 条已有关系显示，关闭并刷新后 11 条隐藏、关系数据保留。独立会话内重置两项已读记录作为测试前置条件，未点击菜单时刷新仍显示红点；点击菜单后刷新菜单红点消失，而画布显示仍提示新功能；点击画布显示后刷新，该项也不再显示红点。两个入口独立保存。

证据目录：`/Users/lkj/.codex/visualizations/2026/10/26/opentu4-retest-hphgct8q/`。关键截图为 `04-resize-consecutive.png`、`06-split-three-preview.png`、`09-toolbar-desktop.png`、`11-toolbar-narrow-more.png`、`12-details-after-refresh.png`、`13-seedream-cached.png`。`10-toolbar-narrow.png` 捕获于视口变化尚未稳定时，以截图 11 和最终边界测量为准。原始结果与脱敏请求、缓存/刷新/断网哈希、摆放坐标、红点状态分别保存为同目录 JSON；不保存认证头或真实 Key。测试结束已关闭隔离浏览器和回放服务，保留原本的 Vite 服务。

本次没有更改功能代码，因此没有重复运行初次修复阶段已通过的单元测试、类型及构建。页面验证补齐了该阶段的验收缺口；既有 ESLint 和循环依赖扫描限制仍按上文保留。

### 随 PR 保存的页面证据

以下截图均来自上述本地实测，便于在仓库中复核；未包含真实 Key。

| 证据 | 截图 |
| --- | --- |
| 文字工具栏单行显示 | [桌面视口](./assets/prerelease-fixes-20261026/toolbar-desktop.png) |
| 窄屏滚动到更多并可下载 | [650px 视口](./assets/prerelease-fixes-20261026/toolbar-narrow-more.png) |
| A3 刷新后仍显示原图像素 | [刷新后详情](./assets/prerelease-fixes-20261026/details-after-refresh.png) |
| 点击菜单后画布显示入口仍独立提示 | [画布显示红点](./assets/prerelease-fixes-20261026/canvas-new-feature-dot.png) |

## 2026-10-26 PR 提交前最终验证

- 功能分支：`dev/canvas-prerelease-fixes-20261026`；目标：`ljquan/opentu:develop`，经显式 `git fetch upstream develop` 后为 `3386b6324377b1b558b0f4633906b21c4f6794a5`。执行 `git merge --no-edit upstream/develop` 返回 `Already up to date`，没有冲突，不需要冲突修补。
- 提交前及同步后各执行一次定向回归：上文 13 个修复测试文件，加 `src/utils/feature-discovery.test.ts`、`src/hooks/use-feature-discovery.test.tsx`、`src/components/toolbar/app-toolbar/app-toolbar.test.tsx`、`src/components/toolbar/popup-toolbar/image-toolbar-contents.test.tsx`，同样使用 `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts ... --silent`。两次均为 17 个文件、175 项全部通过。
- 同步后重新执行 `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`、`pnpm exec tsc -p apps/web/tsconfig.app.json --noEmit`：均通过。
- 同步后分别执行 `pnpm exec vite build --config apps/web/vite.config.ts --outDir <临时目录>/web-build`、`pnpm exec vite build --config apps/web/vite.sw.config.ts --outDir <临时目录>/sw-build`：均通过。没有运行会更新版本号的发布脚本，保留原版本 `1.2.2`；构建产物不提交。仍有原有 NPM_TOKEN 未设置、Sass、Browserslist、模块导入和大 chunk 等提示。
- 对全部 33 个改动的 TypeScript/TSX 文件执行 ESLint：4 个错误、75 条警告。3 个有错误文件分别以 `git show upstream/develop:<path>` 输入同一 ESLint 配置，4 个错误的规则和消息均与上游完全一致；不宣称全量 lint 通过。相比前文的局部检查，这次包含全部改动文件。
- 运行和包含类型的循环依赖检查均未完成：`node scripts/check-cycles.js` 与 `node scripts/check-cycles.js --include-types` 均在严格解析 `tsconfig.base.json` 第 25 行时失败；脚本和配置与目标分支完全相同。本轮没有扩展修改检查工具。
- 最终差异检查通过。页面、真实 API 与本地回放沿用本次已完成的授权实测，未再次付费生成。未运行完整浏览器 E2E、预发布或生产验证；活动任务卡片/WorkZone 和单步撤销限制继续保留。

本次 QA 和 DOC 沿用本文、`qa-feature-discovery.md` 及已有参考连线交接/QA 文档，不另建重复文档。新增截图为精选验收证据；原始生成图、认证凭据、临时回放脚本和构建产物均不纳入 PR。现有大文件仅修改相关入口，未为满足行数规范进行无关拆分。

本轮无需新增依赖、环境变量、接口权限或数据迁移。使用方式和维护边界已合并在本 QA，不另建 DOC。回滚只需恢复本轮相应源码；新保存的 `imageNaturalSize` 为可忽略的元素附加元数据，旧版本仍可打开画板。
