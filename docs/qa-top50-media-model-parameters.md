# Top 50 媒体模型参数 QA

验收分支：`dev/complete-top50-media-parameters`；原实现基线：`647e378d`。本记录描述撤回本次新增水印后的本地验证，以及后续 Seedream 名称修复和经用户授权的有限真实请求。Image 2 扩展也已撤回。

## 范围与环境

- 既定 21 个图片、5 个视频 ID；排除 Sora 新能力。
- Gemini 精确别名、Veo 四参数和音频三按钮、工作流消费者、供应商偏好作用域及无凭据快照。
- Seedance 2.5 draft/priority 删除；保留原有水印和输出格式。
- Seedream 和 H3 适配器/工作流恢复基线；Seedance 2.0/Fast 不增加水印。
- macOS、Node v26.8.1、pnpm 10.21.0、Vitest 3.2.4，使用已有依赖。
- Node 26 测试设置 NODE_OPTIONS=--no-experimental-webstorage；NPM_TOKEN=dummy 仅满足本地配置读取，不用于真实认证。

## Seedream 名称修复与实测

修复以 `96d56399` 为基线，功能提交为 `6564ee1c`，纳入现有 PR #297。实际完整 ID `doubao-seedream-5-0-lite-260128` 及经实测的 `seedream-5.0` 精确复用尺寸和 2K/3K 控件，保留请求 ID、profile、selectionKey 和短代码。`seedream-5.0` 描述不标为 Lite 或 Pro。未知近似 ID 不继承合同，不新增水印、Pro 字段或新分辨率档位。

本轮 9 文件回归 378 通过、1 个原有 Seedance 2.5 偏好断言失败，没有跳过测试。涵盖两个 ID 的参数组件选值、2K/3K 最终像素请求、原生消费者、偏好保存、已有目录刷新、精确模型身份和相邻模型回归。TypeScript、web 构建、OpenSpec strict 和差异检查通过；修改文件 ESLint 0 errors、7 warnings。日志 `/tmp/opentu-seedream-id-fix-final-tests.log`、`/tmp/opentu-seedream-id-fix-types.log`、`/tmp/opentu-seedream-id-fix-build.log`、`/tmp/opentu-seedream-id-fix-lint.log`。

提交 PR 增量复验仍为 378 通过、1 个相同基线失败；TypeScript、web 构建、lint 和差异检查通过。显式 fetch origin/develop 后仍为 df1715ab，merge 提示已同步，无新增合并或冲突。直接连接停滞后使用命令级本地代理/HTTP 1.1 完成 fetch，没有修改全局 Git 配置。日志 `/tmp/opentu-seedream-pr-update-tests.log`、`/tmp/opentu-seedream-pr-update-types.log`、`/tmp/opentu-seedream-pr-update-build.log`、`/tmp/opentu-seedream-pr-update-lint.log`。修复服务为本仓库 7202；截图所在 localhost:7201 属于另一 checkout，未修改其代码、服务或浏览器数据。

公开 Tuzi `/api/pricing` 将完整 Lite ID 与旧 ID 说明为兼容名称；官方 `https://www.volcengine.com/docs/82379/1541523` 确认 Lite 2K/3K 尺寸。官方当前还列有 4K，本次仅修复既有合同映射，不扩大档位。读取公开目录不是实际生成验证。

`seedream-5.0` 在公开目录中归属于独立即梦渠道，实际是否映射 Lite/Pro 仍未知。用户授权并提供测试凭据后，完成 1 次认证模型目录查询、2 次真实生成请求，无生成重试。凭据只经测试进程标准输入传递，没有保存到文件或日志。生成请求仅包含 model、prompt、response_format=url、size，没有水印、quality、n 或 Pro 专属字段。

| 档位 | 请求 size | HTTP | 返回图片数 | 第一张 PNG 实际尺寸 | 耗时 |
| --- | --- | --- | --- | --- | --- |
| 2K | 2560x1440 | 200 | 4 | 2560x1440 | 29 秒 |
| 3K | 4096x2304 | 200 | 4 | 4096x2304 | 29 秒 |

尺寸通过读取实际图片二进制并使用 image-size 解析取得，不以 HTTP 200 或响应字段代替像素检查。仅核验每次第一张，其余 6 张未核验。响应图片仅在内存中读取，没有将生成结果写入用户画布或素材库。实际账单、其他比例/参考图/其他渠道未验证；这两次请求不能证明上游具体版本。原生浏览器连接失败只影响早期凭据访问，最终改用用户授权凭据直接测试 API，没有完成页面验收。

## PR 297 再次同步 develop（2026-10-11）

显式 fetch 后目标分支为 `origin/develop e0ee33c4`，已通过合并提交 `1e1bb4c5` 同步。冲突仅涉及工作流 `CHANGELOG.md` 和 `pending-test.mdx`，保留双方参数、Seedream、Suno v6 与媒体资源相关记录。没有删除上游功能或重新引入已撤回的 Image 2 扩展及新增水印。

上游将 Suno 默认版本改为 v6，原生生成测试仍使用旧版 `chirp-v3-5` 夹具；本次将其改为 `chirp-v6`，与上游允许的版本一致，不修改音乐生产逻辑。

| 检查 | 实际结果 |
| --- | --- |
| 合并后 27 文件联合回归 | 839 通过、4 个已记录基线失败，没有跳过测试 |
| Suno/原生生成/模型配置专项复验 | 3 文件、179 项通过，与联合回归重叠，不累加 |
| drawnix TypeScript | 通过，专项复验后再次执行通过 |
| web 构建 | 通过，应用和 service worker 构建均完成 |
| Suno 测试文件 ESLint | 0 errors、2 个原有 non-null assertion warnings |
| OpenSpec strict | 通过 |
| 差异与冲突检查 | git diff --check 通过，无未合并文件或残留冲突标记 |

本轮日志：`/tmp/opentu-pr297-conflict-tests.log`、`/tmp/opentu-pr297-conflict-types.log`、`/tmp/opentu-pr297-conflict-build.log`、`/tmp/opentu-pr297-conflict-lint.log`。四个失败与下文既有断言一致；不更改或跳过断言来取得通过。本轮未执行页面测试或新增真实供应商请求。

旧远程 CI run `38107581238` 针对旧 head `c0e88fa9` 的 PR 合并结果，失败步骤为 `nx affected -t test build` 的测试；web 构建通过，smoke test 未执行。日志包含工作流测试环境中 `bun:test`、WebCrypto、i18n 和 URL scheme 错误，不能归因于文档冲突，也不能以本地专项通过宣称远程 CI 通过。推送后的最新远程状态应单独核实。

## PR 297 历史结果

| 检查 | 实际结果 |
| --- | --- |
| 合并后 25 文件联合回归 | 792 通过、4 个已知基线失败，没有跳过测试 |
| 水印撤回和 Seedance 适配器专项复验 | 2 文件、100 项通过，含新增水印控件缺失及旧水印保留断言 |
| 参数组件复验 | 1 文件、11 项通过 |
| drawnix TypeScript | 通过 |
| web 构建 | 通过，包含类型检查、应用与 service worker 构建 |
| 修改文件 ESLint | 2 个基线错误、42 warnings；错误位置未在本次改动中改变 |
| OpenSpec strict | 通过 |
| git diff --check | 通过 |
| 最新上游同步与最终检查 | 已 fetch/merge origin/develop df1715ab；仅 pending-test 文档冲突，保留双方条目；合并后测试/类型/构建/OpenSpec/差异检查通过，基线失败另列 |

上表各次测试有重复，不相加为总数。测试使用 mock transport/fetch/响应，检查实际构造 JSON/FormData，不调用真实供应商。

合并后日志：`/tmp/opentu-media-final-tests.log`、`/tmp/opentu-media-final-types.log`、`/tmp/opentu-media-final-build.log`、`/tmp/opentu-media-final-lint.log`。撤回专项日志：`/tmp/opentu-no-new-watermark-recheck.log`、`/tmp/opentu-no-new-watermark-controls.log`。合并前 22 文件为 648 通过、4 个基线失败；合并后增加上游 Gemini/Nano Banana 路由回归。临时目录可能被清理，事实摘要保留在本文。

## 基线失败

以下四项在本次联合回归仍失败，且已有隔离 `647e378d` 复现日志；本轮逐项核对失败名称和预期差异一致。没有修改或跳过失败断言。

1. video-binding-utils：Sora web 时长预期 10/15，基线实际仅返回 10。
2. video-binding-utils：Seedance 2.5 旧断言预期没有分辨率，基线实际为 1080p/720p/480p。
3. ai-generation-preferences-service：Seedance 2.5 旧偏好断言预期清空分辨率，基线实际保留 1080p。
4. native-models-runtime：Tuzi Image 2 预期没有 background，基线已有该字段。

基线证据：`/tmp/opentu-video-baseline-results.log`、`/tmp/opentu-video-baseline-prefs.log`、`/tmp/opentu-video-baseline-native-runtime.log`。

ESLint 基线错误为 default-image-adapter.test.ts 原有 import/first 和 provider-routing/types.ts 原有 ban-types；本次没有移动对应导入或修改该类型。构建有既有 sourcemap、Sass/Browserslist、动态导入和 bundle 大小警告。

## 验收覆盖

| 用例 | 预期及验证 |
| --- | --- |
| 26-ID 及别名 | 保留模型 ID、类型、profile，未知相似名称不匹配；通过 |
| Image 2 回退 | 不新增高级控件/固定 1K 注册，原有适配器保留；通过 |
| Image 2.5 回归 | 已有背景/输出参数保留，透明+JPEG仍拒绝；通过 |
| 水印撤回 | Seedream/H3/Seedance 2.0/Fast 无新增控件，Seedance 2.5 原有水印仍发送；通过 |
| Veo 请求 | 两条 multipart 路径均传 camelCase metadata，false/0保留、缺省省略；通过 |
| Veo 非法值 | 布尔、种子、人物枚举校验，未知字段不透传；通过 |
| 三按钮 | 默认选中、关闭/开启与清空恢复，aria-pressed；组件逻辑验证 |
| Seedance 2.5 | 原水印/输出格式保留，遗留 draft/priority 不提交，非法格式拒绝；通过 |
| 工作流及保存 | 真实消费者、白名单、渠道限制、供应商作用域、嵌套凭据过滤；通过 |

## 重复验证命令

```bash
NODE_OPTIONS=--no-experimental-webstorage NPM_TOKEN=dummy pnpm --dir packages/drawnix exec vitest run --config vitest.config.ts \
  src/constants/__tests__/model-config.test.ts src/constants/__tests__/top50-media-parameters.test.ts \
  src/components/ai-input-bar/ParametersDropdown.test.tsx \
  src/services/__tests__/tuzi-gpt-image-adapter.test.ts src/services/__tests__/gpt-image-adapter.test.ts \
  src/services/__tests__/default-image-adapter.test.ts src/services/model-adapters/__tests__/image-size-quality-resolver.test.ts \
  src/services/__tests__/seedance2-adapter.test.ts src/services/video-api-service.test.ts \
  src/services/__tests__/media-api-routing.test.ts src/services/minimax-h3-video-workflow.test.ts \
  src/services/task-invocation-route.test.ts src/utils/veo-parameters.test.ts \
  src/services/__tests__/ai-generation-preferences-service.test.ts src/services/__tests__/video-binding-utils.test.ts \
  src/workflow-mode/host/native-parameters.test.ts src/workflow-mode/host/native-models.test.ts \
  src/workflow-mode/host/native-models-runtime.test.ts src/workflow-mode/host/native-generation.test.ts \
  src/workflow-mode/shared/native-parameters.test.ts src/utils/__tests__/runtime-model-discovery.test.ts \
  src/services/__tests__/model-adapter-registry.test.ts \
  src/services/__tests__/provider-routing.test.ts src/utils/gemini-api/apiCalls.test.ts src/utils/gemini-api/services.test.ts
NPM_TOKEN=dummy pnpm exec tsc --noEmit --incremental false -p packages/drawnix/tsconfig.lib.json
NPM_TOKEN=dummy pnpm exec nx run web:build
node /Users/lkj/.npm/_npx/abab5bd700860149/node_modules/@fission-ai/openspec/bin/openspec.js validate complete-top50-media-model-parameters --strict
git diff --check
```

## 未执行与风险

- 未完成页面交互验收、截图或浏览器端到端测试；组件测试不能替代页面验收。经用户授权仅执行了上述 Seedream 两次真实请求。
- 除上述 Seedream 尺寸验证外，未核实其他渠道/字段消费和真实输出格式，也未核实计费账单。Veo 按用户要求直接开放，具体渠道可能忽略或拒绝字段。
- 未实施原生 Gemini 视频高级路径、Seedream 条件高级能力、Seedance 任务控制、H3 参考音频和 Veo 后端媒体转换。
- 没有依赖或数据迁移，无新增环境变量。回滚本功能提交即可，用户素材和历史任务不清理。
- DOC 写入现有 docs，工作流 CHANGELOG/pending-test 更新；todo 的 Agent/Skill 待办与本任务无关，经检查无需修改。
- PR 创建不等于远程 CI 通过、合并或部署；远程状态单独核实。
