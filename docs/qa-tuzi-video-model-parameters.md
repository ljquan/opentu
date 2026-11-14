# Tuzi 新版视频模型参数 QA

日期：2026-11-14。基线：`73f6e925`。分支：`codex/adapt-tuzi-video-model-parameters`。效果及参数映射见 [使用说明](./tuzi-video-model-parameters.md)。

## 环境与范围

- macOS，Node v26.8.1，pnpm 10.21.0，Vitest 3.2.4；使用仓库锁文件安装依赖，没有修改依赖或锁文件。
- Gemini Omni 1.2 Flash、Wan 3.0、HappyHorse 1.1 T2V/I2V/R2V、Kling 4.0；覆盖配置、路由、主线程与共享 JSON 提交、HappyHorse 专用适配器和内容恢复判断。
- 初始代码验证使用模拟 fetch/transport；后续用户明确授权有限真实生成，实际结果见下方“Ego 浏览器真实抽样”。未执行全量参数组合。
- 本次属于现有模型发现/视频生成能力的参数配置和请求修正，未新增独立编辑流程；按 OpenSpec 配置修正例外直接实施。涉及接口与回归风险，因此新增 DOC 和本 QA。

## 实际结果

| 检查 | 结果 |
| --- | --- |
| 新模型请求专项 | 36 项通过 |
| PR 前最终 10 文件联合回归 | 349 项通过，2 项原有失败；没有跳过或修改失败断言 |
| drawnix TypeScript | 通过 |
| Web 构建 | 通过，含应用、Web 类型检查和 Service Worker |
| 修改文件 ESLint | 1 个原有错误、29 warnings；无新增 lint error |
| 差异检查 | `git diff --check` 通过 |

构建存在既有 Sass 弃用、sourcemap、动态/静态混合导入及 bundle 大小警告。模拟测试存在 IndexedDB 未提供的环境日志，不代表真实浏览器缓存验收通过。

## 成功、异常与兼容性

- 六个模型的菜单时长/尺寸与默认值一致；Gemini 不显示/发送水印，HappyHorse I2V 不显示/发送 ratio。
- HappyHorse 480P、seed=0、watermark=false 保留；T2V 无图片字段，I2V 使用单数 image，R2V 使用有序 images；9 张可提交，10 张在提交前拒绝。
- Wan 使用 duration/resolution/ratio 和 first_frame/last_frame；主线程与共享入口拒绝单独尾帧。共享入口的本地图片转换使用 Response.arrayBuffer，不依赖 FileReader 或 DOM。
- Kling 4.0 使用统一 `/v1/videos`，已有 Kling 标准版继续走其专用协议；无 4K 档位。根地址和带 /v1 的地址不会漏掉或重复 /v1。
- 超范围时长、小数时长、非法种子/水印、缺少必需图片、T2V 带图片、空首帧及不支持的尺寸会在请求前拒绝。
- 不改写模型 ID，不把未知预览后缀或 HappyHorse 1.1 Video Edit 当作已适配型号；HappyHorse 1.0 不新增 480P。
- 完成任务缺少内联视频 URL 时启用内容下载判断；已有内联 URL 可直接使用。

## 基线失败与证据

在 `/tmp/opentu-video-baseline.OnRUkL` 从 `git archive 73f6e925` 隔离出的修改前代码中，以相同依赖复现两项失败（17 通过、2 失败）。临时环境补充相同测试 setup 和 utils 源码别名，仅用于包解析，没有改动被测业务代码。

1. `video binding utils > keeps sora frontend durations on web mode when selected`：旧断言期望 10/15 秒，原实现实际只返回 10 秒。
2. `video binding utils > routes Seedance 2.0 with official IDs and confirmed controls`：旧断言期望 Seedance 2.5 无分辨率，原实现已有 1080p/720p/480p。

ESLint 错误为 `default-adapters.ts` 原有 `@aitu/utils` 静态导入触发 Nx 的 lazy library 规则。对 `git show 73f6e925:packages/drawnix/src/services/model-adapters/default-adapters.ts` 使用相同文件名运行 stdin lint，复现同一错误；该导入未改动。

日志：`/tmp/opentu-tuzi-video-final-tests.log`、`/tmp/opentu-tuzi-video-new-tests.log`、`/tmp/opentu-tuzi-video-baseline-tests.log`、`/tmp/opentu-tuzi-video-final-types.log`、`/tmp/opentu-tuzi-video-final-build.log`、`/tmp/opentu-tuzi-video-final-lint.log`、`/tmp/opentu-tuzi-video-baseline-lint.log`。临时日志可能被系统清理，事实摘要以本文件为准。

## 复验命令

```bash
NODE_OPTIONS=--no-experimental-webstorage NPM_TOKEN=dummy pnpm --dir packages/drawnix exec vitest run --config vitest.config.ts \
  src/services/tuzi-video-request.test.ts src/services/__tests__/happyhorse-adapter.test.ts \
  src/services/__tests__/kling-adapter.test.ts src/services/__tests__/media-api-routing.test.ts \
  src/services/video-api-service.test.ts src/services/__tests__/provider-routing.test.ts \
  src/services/__tests__/model-adapter-registry.test.ts src/constants/__tests__/model-config.test.ts \
  src/services/__tests__/video-binding-utils.test.ts src/utils/__tests__/runtime-model-discovery.test.ts
NPM_TOKEN=dummy pnpm exec tsc --noEmit --incremental false -p packages/drawnix/tsconfig.lib.json
NPM_TOKEN=dummy NX_DAEMON=false pnpm exec nx run web:build
git diff --check
```

`NPM_TOKEN=dummy` 仅用于读取本地 npm 配置，不是真实认证凭据。

## 未执行与后续

初始开发阶段未做页面测试；本轮用户明确要求后已使用 Ego 浏览器执行下面的真实抽样。未验证其他分辨率/时长组合、声音、计费账单、生产部署或远程 CI。Tuzi 目录当日标注 Gemini Omni 1.2 与 Wan 3.0 尚未开放，但后续实测 Wan 已可提交并完成，目录状态不能代替调用结果。

本次不包含复杂编辑、延展、参考视频、主体或音色流程；Gemini 本地参考图暂不支持。无新增环境变量或迁移，无需清理用户数据。实现及真实抽样阶段尚未本地提交、推送或创建 PR；后续交付状态见文末记录。未部署。


## Ego 浏览器真实抽样（2026-11-14 11:13–11:19，Asia/Shanghai）

用户授权“真实，多个测试，测试一下参数，但是不要全量测试”。使用 ego-browser 2.2.1 在 `http://localhost:7204/` 操作真实模型菜单、参数菜单、图片上传与发送按钮，六个型号各 1 次生成 POST，共 6 次，无生成重试、无追加请求。已受理任务持续查询到完成。页面为开发环境跳过离线缓存模式，测试的是主线程执行入口，不宣称 SW 真实执行覆盖。

| 模型 | 本次请求 | 结果 | 文件实际元数据 |
| --- | --- | --- | --- |
| happyhorse-1.1-t2v | 3 秒、480P、1:1、seed=0、水印 false，无图 | HTTP 200，完成并入画布 | 640×640，3.162667 秒，699855 bytes，video/mp4 |
| happyhorse-1.1-i2v | 3 秒、480P、水印 false，单张 image，不传 ratio | HTTP 200，完成并入画布 | 640×640，3.162667 秒，395527 bytes，video/mp4 |
| happyhorse-1.1-r2v | 3 秒、480P、9:16、seed=2147483647、水印 true，2 张有序 images | HTTP 200，完成并入画布 | 480×848，3.16 秒，291876 bytes，video/mp4 |
| wan3.0-video | 2 秒、480P、adaptive、水印 false，first_frame/last_frame 两张 | HTTP 200，完成并入画布 | 640×640，2.066009 秒，632755 bytes，video/mp4 |
| gemini-omni-1.2-flash | 3 秒、360×640，无水印，无图 | HTTP 400，`unsupported video model` | 未生成，不重提 |
| kling-4.0 | 3 秒、1680×720（720p · 21:9）、水印 false，单图 input_reference | HTTP 400，`unsupported EPhone Kling field input_reference` | 未生成，不重提；确认参考图字段不兼容 |

图片由本地绘制的 768×768 PNG 玩具帆船提供，不使用用户私人素材。T2V 为文字提示，I2V 使用单图，Wan 使用两个不同位置的首尾帧，R2V 使用这两张图与 `[Image 1]`/`[Image 2]` 指代。实际请求 JSON 的图像字段与选参记录一致。

四个成功任务均从本地媒体缓存 Blob 建立 object URL，通过浏览器视频解码核验像素、时长和文件大小。T2V、Wan、R2V 还各解码第 1 秒画面并检查：主体为帆船，R2V 竖屏且右下角出现 Happy Horse 水印。没有用任务成功状态或响应中的 size 代替实际文件检查。480P 方形输出实际为 640×640，不能把档位名称解释为每条边固定 480 像素；3 秒输出容器约多 0.16 秒，不代表计费时长。

密钥从既定 secrets 路径读入，仅在浏览器内存中临时注入所选 Tuzi 路由；没有修改浏览器持久凭据。结束时恢复临时方法并确认原有持久配置仍无测试密钥。仅向 `api.tu-zi.com` 发送测试认证，不记录请求头、密钥或远程结果签名 URL。生成结果和任务保留在测试画板，供用户查看。

脱敏摘要 `/tmp/opentu-video-real-qa-20261114.json`；抽帧对照 `/tmp/opentu-video-results.png`。这些临时文件可能被系统清理。该抽样轮未调整生产代码，未重提 Kling；后续本地修复见下节。Kling 文生视频、其他比例/水印和所有复杂素材输入仍未验证，不能宣称已完整可用。Gemini 的最低参数已正确从页面发出，但服务端拒绝型号，因此无法验证输出。未查看真实扣费账单，也未用本次样本证明 seed 可重复性、首尾帧像素级遵循或所有参数组合兼容。


## Kling 4.0 参考图字段修复

用户随后明确要求“修复”。修正范围仅为 `services/tuzi-video-request.ts` 的 Kling 4.0 分支及相关测试和 DOC；保留其他型号、菜单、偏好和先前真实任务，不追加收费请求。

根因：实际 Tuzi EPhone 适配器的顶层字段白名单不包含 `input_reference`；图片应位于 `contents`，类型 `refer_image`，通过 `url` 提供图片，每张有唯一 `id`。同一请求不能同时带 `contents` 和顶层 `prompt`。本地只读核对来源为另一 Tuzi API checkout 的 `relay/channel/task/ephonekling/adaptor.go`（字段白名单、内容验证）、`adaptor_test.go` 和 `docs/kling-ephone.md`；JieAPI Kling 分支也接受相同的 refer_image 内容结构。未修改 Tuzi API checkout，也未以源码合同替代真实复测。

最终请求示例（使用测试 URL，无认证）：

```json
{
  "model": "kling-4.0",
  "contents": [
    { "type": "prompt", "text": "animate" },
    { "type": "refer_image", "url": "https://example.test/a.png", "id": "image_1" }
  ],
  "settings": { "duration": 3, "resolution": "720p", "aspect_ratio": "21:9" },
  "options": { "watermark_info": { "enabled": false } }
}
```

保持 UI 的 size 选值，提交时映射为 settings.resolution/aspect_ratio；不混发通用顶层字段。未设水印时省略 options，显式 false 保留。所有图片均有稳定顺序的唯一 ID，支持 HTTP(S) 和本地解析后的 PNG/JPEG data URI；不新增视频、主体或音色输入。

修复回归：8 文件 310 项通过，其中新模型专项 52 项、主线程提交 23 项；覆盖无图、1 图、10 图、11 图拒绝、10 组尺寸/比例映射、水印 true/false/缺省、本地图片、WebP 拒绝及主线程图片 slot 排序。共享路径断言完整最终 JSON，防止再次把界面选参通过误当作请求合同正确。drawnix TypeScript、Web 类型检查、应用与 Service Worker 构建均通过（沿用既有构建警告）；本次增量三个代码/测试文件 ESLint 0 errors、3 个既有非空断言 warnings；差异检查通过。

日志：`/tmp/opentu-kling-fix-tests.log`、`/tmp/opentu-kling-fix-types.log`、`/tmp/opentu-kling-fix-lint.log`、`/tmp/opentu-kling-fix-build.log`。本轮不包含此前已隔离确认的 Sora/Seedance 基线失败测试文件；没有修改或跳过其中断言。未追加页面测试、真实请求、提交、推送或部署；Gemini 型号服务端未开放的问题不属于这次字段修复。


## Kling 修复后真实复测（2026-11-14 11:30–11:33，Asia/Shanghai）

用户明确要求“继续测试一下这个”后，以 ego-browser 恢复同一测试页面并刷新到最新本地代码。沿用失败样本条件：3 秒、720p、21:9、水印关闭、1 张本地 PNG。只发送 1 次生成 POST，不重试、不遍历其他组合。

捕获的实际请求仅包含 `model/contents/settings/options`；提示词在 `contents[type=prompt].text`，图片在 `contents[type=refer_image]`，ID 为 `image_1`，图片为 PNG data URI。`settings={duration:3,resolution:"720p",aspect_ratio:"21:9"}`，`options.watermark_info.enabled=false`，没有顶层 input_reference。

- 提交时间 11:30:08，HTTP 200，queued；约 11:31:19 查询到 completed，此前的字段拒绝未再出现。
- 应用存储记录为 completed，结果已缓存并进入画布；浏览器结果视频可加载和解码。
- 从本地缓存 Blob 核验：video/mp4，734939 bytes，实际 **1460×624**，**3.041995 秒**；解码第 1 秒可见参考帆船主体与宽屏构图，没有看到水印。
- **分辨率边界**：实际比例约 21:9，但短边 624，不是请求档位字面上的 720。不能以返回 completed 宣称像素精确满足 720p；本次只能确认该渠道接受 720p 请求并给出上述实际文件。没有用重提、更高分辨率或修改比例尝试消除差异，也未核对账单、音轨及其他组合。
- 新任务保留在测试画板；旧失败样本保留。本次没有改生产代码、提交、推送或部署。

密钥仅临时用于浏览器内存中的 Tuzi 路由，生成结束后已恢复临时方法，确认持久设置未写入测试密钥。脱敏请求/状态摘要在 `/tmp/opentu-kling4-fixed-real-qa.json`，第 1 秒抽帧在 `/tmp/opentu-kling4-fixed-frame.png`；没有保存认证头、密钥或结果签名 URL。核验应用任务终态使用持久任务读取器；活动队列会在完成后移除任务，活动队列为空不代表结果缺失。


## PR 前交付检查

功能提交 `07dca30d`（`feat(video): 适配 Tuzi 新版视频模型参数与 Kling 4.0 请求`）后显式执行 `git fetch upstream develop` 与 `git merge --no-edit upstream/develop`，目标仍为 `73f6e925`，结果 Already up to date。没有内容冲突、合并提交或历史改写。

最终本地验证：

- 10 文件联合回归 349 通过、2 个与上文隔离基线相同的 Sora/Seedance 失败；本次核心 8 文件 310 项通过，没有跳过测试。
- drawnix TypeScript、Web 类型检查、应用与 Service Worker 构建通过。
- 13 个变更代码/测试文件 ESLint 为 1 个原有 Nx lazy-library 错误、29 warnings；错误与先前同一基线导入一致，没有新增 error。
- `pnpm check:cycles` 未能扫描：仓库脚本使用 JSON.parse，无法解析 tsconfig.base.json 的既有尾逗号（line 25）；将上游原脚本和原配置导出到临时目录得到相同异常。脚本及配置不在本次差异中，未为通过检查改动它们。类型检查和构建通过不等价于循环依赖扫描通过。
- `git diff --check` 通过，无未合并文件；没有夹带凭据、生成产物、私有素材、依赖或锁文件。
- 按贡献指南附参数页面裁剪截图 [Kling 参数与生成结果](./images/tuzi-video-model-parameters.png)，只记录已有页面状态，没有再生成视频。

日志：`/tmp/opentu-video-pr-basic-tests.log`、`/tmp/opentu-video-pr-final-tests.log`、`/tmp/opentu-video-pr-final-types.log`、`/tmp/opentu-video-pr-final-build.log`、`/tmp/opentu-video-pr-final-lint.log`、`/tmp/opentu-video-pr-final-cycles.log`、`/tmp/opentu-video-pr-baseline-cycles.log`。上述是本地结果；远程 CI、PR 合并与部署状态不能由本地结果推定。
