# Top 50 媒体模型参数 QA

验收分支：`dev/complete-top50-media-parameters`；原实现基线：`647e378d`。本记录描述撤回本次新增水印后的实际验证。Image 2 扩展也已撤回。当前仅验证本地代码、模拟请求和组件逻辑。

## 范围与环境

- 既定 21 个图片、5 个视频 ID；排除 Sora 新能力。
- Gemini 精确别名、Veo 四参数和音频三按钮、工作流消费者、供应商偏好作用域及无凭据快照。
- Seedance 2.5 draft/priority 删除；保留原有水印和输出格式。
- Seedream 和 H3 适配器/工作流恢复基线；Seedance 2.0/Fast 不增加水印。
- macOS、Node v26.8.1、pnpm 10.21.0、Vitest 3.2.4，使用已有依赖。
- Node 26 测试设置 NODE_OPTIONS=--no-experimental-webstorage；NPM_TOKEN=dummy 仅满足本地配置读取，不用于真实认证。

## 当前结果

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

- 按用户规则没有页面点击、浏览器自动化、截图或真实供应商付费生成；组件测试不能替代页面验收。
- 未核实生产渠道、计费、供应商字段消费和真实输出格式。Veo 按用户要求直接开放，具体渠道可能忽略或拒绝字段。
- 未实施原生 Gemini 视频高级路径、Seedream 条件高级能力、Seedance 任务控制、H3 参考音频和 Veo 后端媒体转换。
- 没有依赖或数据迁移，无新增环境变量。回滚本功能提交即可，用户素材和历史任务不清理。
- DOC 写入现有 docs，工作流 CHANGELOG/pending-test 更新；todo 的 Agent/Skill 待办与本任务无关，经检查无需修改。
- PR 创建不等于远程 CI 通过、合并或部署；远程状态单独核实。
