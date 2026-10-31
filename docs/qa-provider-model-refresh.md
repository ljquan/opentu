# Provider Model Refresh QA

## 2026-10-27：恢复按当前 API Key 认证获取模型

本节描述当前行为，替代历史记录中“Tuzi 使用模型广场作为模型列表来源”的做法。本次仅本地修改，目录 `/Users/lkj/Documents/ChatGPT/opentu-2`，分支 `develop`，未提交、推送或部署。

### 最终行为与兼容边界

- 设置中的“获取模型”、保存新 Key/地址后的刷新、Tuzi 托管供应商同步均请求当前供应商的 `/v1/models`，使用当前 Key 的 Bearer 认证，并保留现有同源代理、候选地址、超时和取消逻辑。
- 自动发现的模型 ID 仅来自认证响应。价格目录只按同名 ID 补充说明、分类、标签、厂商和接口信息；认证响应已有字段优先。价格请求失败、缺少配置或返回空目录不阻断认证模型发现。
- 无效 Key、认证接口失败或空模型列表继续报错，不使用公开目录补足列表。更换 Key 后以新响应替换自动目录，移除旧选择；用户手工添加的模型和绑定继续保留。
- 取消依据价格缓存额外添加 Suno 模型的逻辑；恢复缓存时移除带 `pricing-suno-v2` 标记的旧自动补充项，手工项保留。已成功获取的认证目录不会因历史模型选择重新插入未返回的 ID。
- 新目录标记为 `models-endpoint`，重载时保留发现结果中的分类和能力配置，价格刷新不能覆盖这些结果或扩充列表。旧 `marketplace` 目录仍兼容读取；更新后需在各供应商点击一次“获取模型”并确认选择，以当前 Key 重新获取，无需清空用户数据。
- 价格读取与生成接口的认证规则不变，无新增依赖、环境变量、数据库迁移或部署顺序。认证接口返回但不在模型广场中的模型仍可展示；列表返回不等于实际生成已验证，调用能力与权限最终由上游服务执行。

### 实际验证

环境：macOS、Node v26.8.1、pnpm 10.21.0、Vitest 3.2.4。使用现有依赖和模拟 HTTP 响应，未读取真实密钥。

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  --config packages/drawnix/vite.config.ts \
  packages/drawnix/src/services/provider-model-catalog.test.ts \
  packages/drawnix/src/utils/__tests__/runtime-model-discovery.test.ts \
  packages/drawnix/src/utils/__tests__/runtime-model-classification.test.ts \
  packages/drawnix/src/utils/__tests__/suno-v2-discovery.test.ts \
  packages/drawnix/src/utils/__tests__/model-pricing-service.test.ts \
  packages/drawnix/src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  packages/drawnix/src/services/__tests__/tuzi-managed-provider-models.test.ts \
  packages/drawnix/src/services/__tests__/settings-repository.test.ts \
  packages/drawnix/src/utils/__tests__/settings-manager.test.ts \
  packages/drawnix/src/hooks/__tests__/use-runtime-models.test.ts \
  packages/drawnix/src/services/__tests__/provider-routing.test.ts \
  packages/drawnix/src/services/__tests__/tuzi-session-provider-sync.test.ts \
  packages/drawnix/src/services/__tests__/tuzi-managed-providers.test.ts \
  packages/drawnix/src/components/ai-input-bar/ModelDropdown.test.tsx
pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json
pnpm exec eslint \
  packages/drawnix/src/services/provider-model-catalog.ts \
  packages/drawnix/src/services/provider-model-catalog.test.ts \
  packages/drawnix/src/utils/runtime-model-discovery.ts \
  packages/drawnix/src/utils/__tests__/runtime-model-discovery.test.ts \
  packages/drawnix/src/utils/__tests__/runtime-model-classification.test.ts \
  packages/drawnix/src/utils/__tests__/suno-v2-discovery.test.ts
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vite build --config apps/web/vite.config.ts
git diff --check
```

- 14 个测试文件、265 项全部通过。供应商目录测试使用真实发现服务并模拟网络与价格服务，覆盖当前 Key 认证头、两种 Key 的独立结果、旧选项移除、公开目录越权项排除、认证目录独有模型保留、无效 Key、空响应、价格失败/缺失/空目录、认证元数据优先和非 Tuzi 供应商兼容。
- 分类、Suno、凭据保存刷新、托管分组、会话同步、运行时模型 hook、模型选择组件和请求路由回归通过，含认证目录反复加载后仍保持分类的回归。
- Drawnix TypeScript 检查通过；6 个相关 TS/测试文件 ESLint 为 0 errors、0 warnings。
- Web 生产构建通过，40.21 秒；使用直接 Vite 命令，未执行版本号写入脚本。已有 Sass、Browserslist、混合导入、大 chunk 和 `.npmrc` 占位提示仍存在。测试中的模拟网络错误、IndexedDB/crypto 环境提示不影响通过结果。
- 最终差异检查通过。维护说明更新到已有 `MODEL_CATEGORY_PRIORITY_LESSONS.md`，不新增独立 DOC。

未执行完整仓库测试、页面交互、Windows 验证、真实供应商请求或收费生成，未部署。非技术验收：加载新版本后，分别用两个模型权限不同的 Key 获取并确认模型，检查列表随权限变化；无效 Key 应显示错误；相同权限 Key 可以返回相同列表。只切换价格分组不应扩大认证接口返回的模型范围。

## 2026-10-22：PR 最终集成验证

功能分支 `dev/fix-selected-previews-and-model-discovery`，目标 `origin/develop`。本次 PR 统一交付选中图片预览恢复、较新兼容默认模型与公开价格目录认证修复。原有独立 `src/data/image.test.ts` 修改不纳入 PR。

先运行基础回归并提交任务改动，再显式 `git fetch origin develop` 和 `git merge origin/develop`。最新上游仍为 `68f2ca1beb0e8751f275f3ea1022ca53c88797a1`（v1.2.1），合并返回 `Already up to date`，没有新增冲突。此前已自动合并的 RetryImage 上游浏览器缓存完成确认与本地迟到事件保护均保留。

最终验证使用 macOS、Node v26.8.1、pnpm 10.21.0，单独保存无关测试修改后执行，避免依赖未提交内容：

- 使用下节同步验证的 Vitest 命令，去掉不属于 PR 的 `src/data/image.test.ts`：14 个文件、222 项全部通过，提交前及上游合并后各运行一次。包括双图独立加载、超时/失败重试、缓存延迟就绪、迟到事件、换源/卸载、已解码缓存、蒙版、供应商鉴权边界、错误脱敏与不缓存失败、一次性默认模型升级及自定义配置保留。
- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- `pnpm exec vite build --config apps/web/vite.config.ts`：通过，39.17 秒；既有 Sass、Browserslist、混合导入、大 chunk 与 `.npmrc` 占位提示仍存在。
- 对 PR 的 10 个 TS/TSX 文件执行完整 ESLint：1 error、23 warnings。唯一错误是 `retry-image.tsx` 原有 `@aitu/utils` 导入触发 `@nx/enforce-module-boundaries`；使用 `git show origin/develop:packages/drawnix/src/components/retry-image.tsx | pnpm exec eslint --stdin --stdin-filename packages/drawnix/src/components/retry-image.tsx` 在未修改的上游源码复现相同错误。仅命令级关闭此规则后，同一批文件为 0 errors、23 warnings，仓库规则未变更。
- `git diff --check origin/develop...HEAD` 及最终工作区差异检查通过，没有未解决冲突。

继续使用已有三份 QA 与两份维护说明，不新建重复 DOC。本次 PR 准备阶段未重复页面测试、未运行完整仓库测试/Windows 验证、未调用真实生成接口或部署；此前缩略图真实页面回归及用户确认模型获取恢复的证据分别见对应日期记录。此前 Seedance 偏好测试的基线失败不在本次 222 项范围内，不声称全仓库测试或完整 lint 通过。

无需新增依赖、环境变量或服务部署顺序。刷新应用后可手工验收双图缩略图、失败重试和模型获取；默认值仅对匹配的 Tuzi 旧兼容配置执行一次升级，自定义模型及其他供应商保留。回滚可撤回本次代码提交；如需恢复旧模型，在设置中手动选择，回滚代码不会自动撤销已保存的模型选择或迁移标记。PR 提交不包含合并或生产部署授权。

## 2026-10-22：同步远程 develop 并保留本地修复

目录 `/Users/lkj/Desktop/working/opentu1`，分支 `develop`。显式获取 `origin/develop` 后，从 `7b3aa15e` 快进到 `68f2ca1b`（v1.2.1）；本地 HEAD 与本次获取的远程提交完全一致。直接连接 GitHub 超时后，使用命令级 HTTP/1.1 与本机代理完成获取，没有修改全局 Git 配置。

同步前备份了全部 18 个本地修改/新增文件、二进制差异与 SHA-256 清单，并创建独立 stash；快进后使用 `stash apply` 恢复，保留本次及此前已有 stash。16 个文件与同步前备份逐字节一致，`retry-image.tsx` 及其测试自动合并了上游浏览器已解码缓存图片的完成确认与本地 Blob 迟到事件保护、有限缓存重读逻辑，没有未解决的冲突。选中图片预览、兼容默认模型、公开价格目录认证修复以及原有 `data/image.test.ts` 的 FileReader 修改均保留。随后仅在本 QA 文件补充同步记录。

macOS、Node v26.8.1，使用现有依赖执行：

```sh
cd packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/components/retry-image.test.tsx \
  src/components/shared/SelectedContentPreview.test.tsx \
  src/components/ai-input-bar/BoundImageContentPreview.test.tsx \
  src/components/chat-drawer/__tests__/EnhancedChatInput.test.tsx \
  src/services/unified-cache-service.test.ts \
  src/utils/image-operation-timeout.test.ts \
  src/utils/__tests__/model-pricing-service.test.ts \
  src/services/provider-model-catalog.test.ts \
  src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/services/__tests__/settings-repository.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/constants/__tests__/model-config.test.ts \
  src/plugins/components/image.loading.test.tsx \
  src/data/image.test.ts --silent
```

- 15 个文件、234 项测试全部通过，包括双方新增的 RetryImage 用例及画布图片加载回归。
- 根目录 `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- 根目录 `pnpm exec vite build --config apps/web/vite.config.ts`：通过，33.82 秒；保留既有 Sass、混合导入、大 chunk、Browserslist 及 `.npmrc` 环境占位提示。该命令不调用版本写入脚本。
- `git diff --check`：通过；`git diff --name-only --diff-filter=U`：无输出。

本次没有新增功能或运行配置，因此更新既有 QA，不新建 DOC。没有执行完整仓库测试、页面验收、真实供应商或收费生成，也未部署；此前记录的其他基线测试问题不在本次验证范围内。本地修改保持未提交、未暂存，没有推送或创建 PR；没有启动或重启服务。手工验收可在后续启动页面后检查双图选择预览及“获取模型”，本次结论仅覆盖上述本地自动化检查。

## 2026-10-21：主站公开价格目录认证修复

目录 `/Users/lkj/Desktop/working/opentu1`，分支 `develop`，基线 `7b3aa15e`。环境：macOS、Node 26.8.1、pnpm 10.21.0、Vitest 3.2.4。此前缩略图及兼容默认模型改动继续保留。

### 问题与修复

Tuzi 获取模型先读取模型广场价格目录。只读接口核验发现主站 `/api/pricing` 不带认证时返回 `success=true` 和 660 条模型记录；带生成 Key 时返回 HTTP 200、`success=false`、`Unauthorized, invalid access token`；同一个测试 Key 读取 `/v1/models` 正常，返回 731 条记录。此前结构校验将该认证错误误报为 `Invalid pricing API response`。

本次只修改价格服务与对应测试：

- 精确匹配 `https://api.tu-zi.com/api/pricing`，包括查询参数和现有同源代理读取；该公开请求不发送生成 Key 或浏览器 Cookie。
- 主站公开响应按实际不含认证的请求复用并发读取，避免多个分组 Key 重复读取同一公开目录。
- Business、自定义供应商、相似域名及其他路径继续使用原有认证。模型和生成接口没有修改。
- HTTP 200 的 `success=false` 在结构校验前拒绝，读取 `message` 或 `error.message`，隐藏回显的当前 Key；失败不写入价格缓存。空或非法响应保留格式错误，不暴露空值运行时异常。

### 自动化验证

从 `packages/drawnix` 执行：

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/utils/__tests__/model-pricing-service.test.ts \
  src/services/provider-model-catalog.test.ts \
  src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/services/__tests__/settings-repository.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/constants/__tests__/model-config.test.ts --silent
```

7 个文件、151 项全部通过。新增用例在旧实现中先复现 5 个失败，再确认修复后通过；包括匿名公开读取、其他认证边界、错误正文脱敏、拒绝错误缓存和非法响应。既有嵌套/扁平价格结构、分组价格、元数据、并发请求、超时和模型发现回归通过。

根目录执行 `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`、针对价格服务及测试的 ESLint、`pnpm exec vite build --config apps/web/vite.config.ts`、`git diff --check`：全部通过。相关文件 ESLint 0 errors、0 warnings。构建耗时 53.61 秒，仍有既有 Sass、Browserslist、混合导入、大 chunk 等提示。未重跑完整仓库测试；其他任务已记录的基线失败不因此消失。

### 页面结果与边界

用户授权在 7201 进行页面验收，随后亲自确认“可以了”。助手停止进一步页面操作，没有重复触发模型获取。最终页面可用性以用户本次确认作为证据，不声称助手独立完成了完整 UI 验收。

没有发起图片、视频、音频或文本生成，不涉及收费测试、密钥重置、配置迁移或生产部署。公开目录中的价格是参考目录信息，不等同用户个性化账单；目录可见不代表所有模型均获令牌授权。服务保持在 7201。本次未提交、推送或创建 PR；维护说明更新到既有端点设置文档。

## 2026-10-20 PR #311 Routing Performance Integration

The existing open PR #311 already contains on-demand PPT route validation.
This integration keeps that implementation's complete activation condition
(Agent PPT skill or its open dialog), ordinary-mode catalog identity, and
unavailable-model filtering. PPT image/video validation now shares one
synchronous resolver; provider/catalog/binding snapshots are rebuilt after
configuration changes. Generation keeps fresh one-off planning. The snapshot
is never global or retained across asynchronous work.

The optimization branch was committed first, then `upstream/develop` and the
PR head were explicitly fetched. Target `develop` remains
`26d88768fb09f216092be854bf5204bdccfa71f8`; merging it into the PR head reported
`Already up to date`. Merging the optimization branch conflicted in
`AIInputBar.tsx` and this QA file. Both implementations' intended behavior and
all existing PR #311 model/media/synchronization changes were retained.
The component harness now covers a single resolver shared by both media lists,
no resolver in ordinary modes, unchanged-render memoization, and a fresh batch
on configuration changes. No duplicate PR, force-push or PR merge is needed.

Final validation on macOS, Node 26.8.1, pnpm 10.21.0 and Vitest 3.2.4:

- Drawnix: 41 test files, 596 tests passed. Run the 37-file Drawnix command in
  the 2026-10-19 integration section below, additionally including:
  `src/services/__tests__/settings-routing-performance.test.ts`,
  `src/services/__tests__/provider-routing.test.ts`,
  `src/services/__tests__/model-adapter-registry.test.ts`, and
  `src/services/ppt-explainer/provider-contract.test.ts`.
- Web: both existing sync/persistence files passed, 10 tests. Combined final
  regression: 606 tests passed. The updated PPT component harness has 13 tests.
- `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json` passed.
- `NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
  web:build --skip-nx-cache` passed, including Web typechecking, app and Service
  Worker production builds.
- Targeted ESLint over the four added/updated source/test files passed with
  zero errors. The input bar's 18 warnings match the previous PR head exactly
  by rule/message; the other three files have none. Existing broader PR lint
  and cycle findings are recorded below and were not repaired by this change.
- The 300-model equivalence test read the catalog once and profiles twice per
  batch. Its final concurrent regression run measured 8505.8 ms for individual
  planning versus 19.5 ms for the batch. A focused run measured 4692.3 ms versus
  17.4 ms. Timings depend on concurrent workload; route equality and bounded
  reads are deterministic assertions, not production frame-time claims.
- The initial worktree run lacked package-level dependency links. After
  restoring ignored links to installed dependencies (workspace links target
  this worktree), the full regression, types and build passed. No manifest or
  lockfile changed.
- `git diff --check` and added-line credential-pattern checks passed. No
  browser interaction, real provider request, Windows run or deployment was
  repeated during conflict integration. The local authenticated iframe
  observations below predate this integrated source and do not accept the
  final populated-canvas performance.

The previous PR #311 CI run (39261399320) already failed before this update:
57 test files failed, including crypto/ArrayBuffer test-environment errors,
`bun:test` browser externalization and a URL-scheme harness failure. Local
scoped success is distinct from whole-repository CI success; the updated head
must receive its own remote checks. Existing bundle/Sass/Browserslist warnings
remain. This is an internal CPU optimization with no new dependency,
configuration, migration, layout or gesture change. Existing QA is updated;
no additional standalone DOC is required.

## 2026-10-19 PR Integration Verification

Integration branch: `dev/provider-models-canvas-readiness`, targeting
`ljquan/opentu:develop`. After committing the fixes, an explicit
`git fetch origin develop` and `git merge --no-edit origin/develop` completed
against `26d88768fb09f216092be854bf5204bdccfa71f8`. Git reported
`Already up to date`; there were no manual merge conflicts.

The final regression run passed 445 Drawnix tests in 37 files and 10 Web tests
in two files, 455 total. This includes the model marketplace, raw capability
tags, cached catalog restoration, NEW family ordering, Gemini parameters,
preview/cache recovery, tab synchronization, image handoff and on-demand PPT
model validation. Run the Drawnix suite from `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/components/ai-input-bar/AIInputBar.ppt-models.test.tsx \
  src/components/ai-input-bar/ModelDropdown.test.tsx \
  src/components/ai-input-bar/PptExplainerDialog.test.tsx \
  src/components/ai-input-bar/model-dropdown-styles.test.ts \
  src/components/image-generation-anchor/ImageGenerationAnchorContent.test.tsx \
  src/components/retry-image.test.tsx \
  src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  src/components/startup/DeferredAIInputBar.test.tsx \
  src/components/task-queue/TaskImagePreview.test.tsx \
  src/constants/__tests__/model-config.test.ts \
  src/data/image.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts \
  src/hooks/__tests__/useAutoInsertToCanvas.test.ts \
  src/hooks/__tests__/useImageGenerationAnchorSync.test.ts \
  src/hooks/__tests__/useTabSync.test.tsx \
  src/plugins/components/image.loading.test.tsx \
  src/services/__tests__/settings-repository.test.ts \
  src/services/__tests__/tuzi-managed-provider-models.test.ts \
  src/services/__tests__/workspace-cache.test.ts \
  src/services/ai-input-ui-events.test.ts \
  src/services/canvas-operations/canvas-insertion.test.ts \
  src/services/ppt-explainer/validation.test.ts \
  src/services/provider-model-catalog.test.ts \
  src/utils/__tests__/canvas-media-preview.test.ts \
  src/utils/__tests__/image-generation-anchor-insertion.test.ts \
  src/utils/__tests__/image-generation-anchor-readiness.test.ts \
  src/utils/__tests__/image-generation-anchor-state.test.ts \
  src/utils/__tests__/image-generation-anchor-task.test.ts \
  src/utils/__tests__/image-generation-anchor-view-model.test.ts \
  src/utils/__tests__/model-grouping.test.ts \
  src/utils/__tests__/model-pricing-service.test.ts \
  src/utils/__tests__/model-sort.test.ts \
  src/utils/__tests__/runtime-model-classification.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/utils/__tests__/suno-v2-discovery.test.ts \
  src/utils/image-operation-timeout.test.ts
```

From the repository root:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  apps/web/src/app/app-sync.spec.ts apps/web/src/app/pending-persistence.spec.ts --environment node
NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run drawnix:typecheck
NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run web:build --skip-nx-cache
git diff --check origin/develop...HEAD
```

Drawnix/Web type checks, production app and Service Worker builds, and diff
checks passed. Existing npm environment, mock IndexedDB/crypto, sourcemap,
Browserslist, Sass, mixed-import and large-bundle warnings remain.

Targeted ESLint across all 57 changed TypeScript/test files reports 14 errors
and 124 warnings. Each diagnostic was compared by rule/message against
`origin/develop`; none is new. The repository-wide cycle commands fail with
two runtime cycles and three cycles including type imports. Re-running the
actual checker against an in-memory upstream source overlay confirmed the
same counts and identical cyclic edges in both modes. These are baseline
failures, not passing lint/cycle gates. Added-line credential-pattern scanning
reported no possible secrets; this is not an exhaustive security audit.

Existing QA/handoff documents are updated instead of creating new root QA/DOC
files. There is no dependency, environment variable or storage migration.
No new browser interaction, real provider generation, billable request,
Windows validation, production deployment or measured cold-start benchmark
was performed for this PR. Earlier read-only page observations and the user's
reports are distinguished from post-fix acceptance in the sections below.
The running localhost:7201 checkout and its uncommitted files are preserved;
integration and publishing are performed only in the separate PR worktree.


## 2026-10-19 On-Demand PPT Model Validation

The reported startup gap concerns the bottom AI input bar, not a generated
image. Only `AIInputBar.tsx` runtime logic changes: the existing image/video
route checks now run when the PPT explainer skill is active in Agent mode,
or its dialog is open. Remembering a PPT skill while using ordinary image,
video, audio or text mode no longer enables strict PPT filtering. Other Agent
skills also skip these checks. Leaving PPT stops validation, including on later
catalog updates. In PPT, unchanged model lists reuse the existing memoized
result; changed configuration reruns the existing availability filter.

This section records the initial on-demand implementation. The 2026-10-20
integration additionally introduces a synchronous batch routing snapshot for
PPT entry; see the latest integration record. Model classification, invocation
requests, placeholders, layout, loading delays, dependencies and persistent data
remain outside that optimization. No global routing cache is introduced.

Validation: macOS, Node 26.8.1, Vitest 3.2.4. The new regression harness extracts
the actual component declarations and filter using the TypeScript parser, then
executes them with real React `useMemo`/`renderHook` and a stub routing resolver.
It does not mount the full application. Eight assertions failed before the fix;
the final twelve tests cover ordinary modes, remembered PPT selection, entry,
an open dialog, exit, memoization, changed availability and a 199-model catalog
which performs zero PPT route checks in ordinary startup.

Executed from `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/components/ai-input-bar/AIInputBar.ppt-models.test.tsx \
  src/components/ai-input-bar/PptExplainerDialog.test.tsx \
  src/components/startup/DeferredAIInputBar.test.tsx \
  src/services/__tests__/settings-repository.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts \
  src/services/ppt-explainer/validation.test.ts \
  src/services/ai-input-ui-events.test.ts \
  src/components/ai-input-bar/ModelDropdown.test.tsx \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/utils/__tests__/model-sort.test.ts
```

Result: all 119 tests across ten files passed. From the repository root,
`NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
drawnix:typecheck` passed, and `NODE_OPTIONS=--no-experimental-webstorage
NX_DAEMON=false pnpm exec nx run web:build --skip-nx-cache` passed, including
Web type checking, the application bundle and the Service Worker build.
ESLint reports zero errors and eighteen existing warnings in AIInputBar; a
same-rule/message comparison with HEAD found no added diagnostics. The new test
file has zero errors and warnings. `git diff --check` passed. Existing mocked
IndexedDB, missing sourcemap, npm environment, Browserslist, Sass, mixed-import
and bundle-size warnings remain.

No browser/page test, refresh, generation, billable provider call, Windows run,
commit, push, PR or deployment was performed for this change. The existing 7201
service is retained. Manual acceptance: load ordinary image mode and verify the
input bar does not wait for PPT route checks; select the PPT skill or open its
dialog to validate available models, then switch back to ordinary mode. Actual
cold-start elapsed time has not been measured after the repair. QA and behavior
notes are recorded here; no separate DOC is needed for this local gating fix.

## 2026-10-19 Review Follow-up: Classification and Request Deadline

Scope: fix the four confirmed review findings only. Model ordering, row
presentation, manual models, group filtering and image-loading deadlines are
unchanged. Marketplace classification is reapplied on every catalog restore,
including models already carrying the declared type; unrelated tags such as
`NEW` no longer override static/ID/endpoint inference. Explicit input-only image
labels still do not grant image generation, and actual categories keep priority.

Pricing/catalog requests now have a 15-second total deadline covering fetch and
JSON reads. The transport is aborted on timeout, the shared in-flight entry is
released for retry, and late responses cannot replace a newer shared cache.
HTTP errors are preserved. The existing five-minute image-element loading
deadline is a separate setting and is not changed. No automatic network retry,
provider generation or token-specific capability validation is added.

Tab synchronization now acknowledges a version only after its callback accepts
the update. A busy/stale callback returns `false`, leaving the version for the
existing 500 ms poll to retry; legacy void callbacks are still accepted. The
Drawnix wrapper forwards the asynchronous result. In-flight callbacks are
coalesced, and obsolete effect callbacks cannot acknowledge newer work.
This does not merge simultaneous edits from different tabs.

Validation: macOS, Vitest 3.2.4. The following Drawnix command passed all 255
tests across 19 files; Web callback/persistence tests passed all 10 tests.
Eight Drawnix and two Web regression assertions failed before implementation.

```bash
# packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/hooks/__tests__/useTabSync.test.tsx \
  src/utils/__tests__/runtime-model-classification.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/utils/__tests__/model-pricing-service.test.ts \
  src/services/provider-model-catalog.test.ts \
  src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  src/services/__tests__/tuzi-managed-provider-models.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/utils/__tests__/suno-v2-discovery.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts \
  src/utils/__tests__/model-sort.test.ts \
  src/utils/__tests__/model-grouping.test.ts \
  src/components/retry-image.test.tsx src/data/image.test.ts \
  src/components/task-queue/TaskImagePreview.test.tsx \
  src/utils/__tests__/canvas-media-preview.test.ts \
  src/services/__tests__/workspace-cache.test.ts \
  src/components/ai-input-bar/ModelDropdown.test.tsx \
  src/constants/__tests__/model-config.test.ts

# repository root
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  apps/web/src/app/app-sync.spec.ts apps/web/src/app/pending-persistence.spec.ts --environment node
NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run drawnix:typecheck
NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run web:build --skip-nx-cache
git diff --check
```

The targeted suites cover busy/rejected sync retries, newer notifications during
an in-flight sync, effect replacement/unmount, legacy callbacks, local-edit and
board-switch guards, unknown tags, repeated corrected catalog restoration,
shared request timeouts, stalled JSON reads, late cache writes, HTTP failures
and successful retries. The callback harness executes App's actual extracted
callbacks, not a mounted application; the hook tests use React in JSDOM.
Drawnix/Web type checks, app and Service Worker builds passed. Targeted lint
has four baseline errors and 13 warnings; HEAD/current comparison found no new
diagnostics. Existing npm environment, mock crypto/IndexedDB, Browserslist,
Sass, mixed-import and bundle-size warnings remain.

Port 7201 is still owned by this checkout and returned HTTP 200. No browser/page
test, real provider call, Windows test, commit, push or deployment was performed.
No new dependency, configuration, storage migration or cache clearing is needed.
Manual acceptance: reload, confirm model types remain stable across page reloads,
and use an existing result on a disposable board to check insertion plus tab
sync. Timeout behavior is covered by fake-timer network mocks, not a real outage.
This section and the existing insertion handoff/QA record document the changes;
no separate DOC file was created.

## 2026-10-19 Image Model Ordering Trial

Scope: image ordering in the shared sorter, dropdown search and Settings model
summary. Provider/vendor tabs, selected IDs, discovery, classification, prices
and invocation defaults are unchanged. Text/audio/video retain existing rules.

Image priority: explicit `sortOrder`, NEW families, the ordered recommendation
list (Sunburst then Flare), family, numeric version descending, standard variant
first, then natural model-ID order. Old image `recommendedScore` values,
including negative scores, no longer control order. NEW inheritance uses the
same provider, vendor, family and version among candidate models, never older
versions. A NEW variant can seed the family too. Inheritance changes ordering,
not stored tags or badges. Search relevance still wins; tie-break comparators
use the full candidate list before filtering, preserving a matching variant's
priority even if the NEW base model is filtered out.

Family/version parsing uses IDs, not descriptions or short codes. Resolution
suffixes and common six-digit release dates are excluded from main versions.
GPT-4o Image remains a separate legacy family. Unusual supplier names may need
a targeted parser rule later. No network request, dependency, configuration,
data migration, catalog refresh or clearing of user data is needed.

Validation: macOS, Node 26.8.1, Vitest 3.2.4. The ten-file catalog command below
was run with `src/utils/__tests__/model-sort.test.ts` and
`src/utils/__tests__/model-grouping.test.ts` added:

- 117 tests passed across 12 files, including 16 sorter tests. Six sorter
  expectations failed before the repair. Coverage includes NEW variants,
  version/provider/vendor boundaries, filtered search, negative/absent old
  scores, numeric versions, default/resolution variants, real screenshot GPT
  configs, input preservation, repeated order, mixed-type comparator symmetry
  and transitivity, and non-image compatibility.
- `pnpm exec nx run drawnix:typecheck`: passed.
- Targeted ESLint on model-sort, its tests, ModelDropdown and settings-dialog:
  zero errors; 13 existing settings-dialog warnings remain.
- `NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
  web:build --skip-nx-cache`: passed, including app typecheck, app bundle and
  Service Worker. Existing build warnings remain. `git diff --check`: passed.
- Port 7201 belongs to this checkout and returned HTTP 200. No browser/page
  test, real model call, Windows run, commit, push or deployment was performed.
  Existing mock IndexedDB/crypto and expected failure-path logs remain.

Manual acceptance: reload port 7201 and open the image selector. Among available
selected GPT models, Sunburst/Flare stay first within their NEW tier, 2.5
standard/VIP precede 2 standard/VIP, and old 4o no longer jumps ahead because
of its negative score. Other NEW same-version image variants share priority;
ordinary older versions do not. Coding guidance is updated in place; no separate
DOC was added. Reverting this task's sorter and comparator-call changes restores
the prior order without changing persisted data or earlier catalog repairs.

## 2026-10-19 Introduction-only model rows

ModelDropdown no longer renders any price tag (token, flat, per-second or tiered).
Rows prefer the built-in short description; dynamic descriptions use only the
first line, remove simple emphasis markers and are limited to 100 characters.
Missing descriptions or first lines containing pricing, discount or quota copy
use a neutral vendor/type introduction instead. Suno action descriptions keep
their existing special presentation. Names, NEW/health badges, selection,
pricing calculations, stored metadata and other pricing surfaces are unchanged.

Validation: 44 tests passed across ModelDropdown (23), KeyboardDropdown (5),
compiled description styles (2) and model-pricing-service (14). Added component
cases cover hiding every billing type, preserving selection, preferring built-in
introductions, replacing promotional text and retaining a plain capability
introduction without subsequent pricing paragraphs. Drawnix typecheck, targeted
ESLint and diff checks passed. No browser/page test or production build was run.
Manual acceptance: refresh port 7201, confirm model rows only show short
introductions without prices/discounts/quotas, and select a model normally.
No configuration, dependency or data migration is required.

## 2026-10-19 Long model description containment

Only `.model-dropdown__item-desc` adds `contain: inline-size`: full model and
pricing-cache descriptions no longer contribute to the popup's intrinsic width.
The existing single-line ellipsis remains; no text is removed from the data.
Popup positioning, three-column structure and model selection are unchanged.

Local validation: the stylesheet compilation/constraint tests and existing
KeyboardDropdown/ModelDropdown suites passed all 23 tests across 3 files.
Command from `packages/drawnix`: `NODE_OPTIONS=--no-experimental-webstorage pnpm
exec vitest run --config vitest.config.ts
src/components/ai-input-bar/model-dropdown-styles.test.ts
src/components/ai-input-bar/KeyboardDropdown.test.tsx
src/components/ai-input-bar/ModelDropdown.test.tsx`.
Drawnix `tsc --noEmit`, targeted test ESLint and `git diff --check` passed.
HTTP inspection confirmed port 7201 serves the new containment rule.
No browser layout test or production build was run. CSS assertions do not prove
rendered geometry. Manual acceptance: reload, switch between OpenAI, Gemini,
Qwen and Sora, and confirm long descriptions truncate without widening the
popup. No new configuration, dependency or data migration is required.

## 2026-10-19 Tuzi marketplace catalog regression

Tuzi provider discovery now reads the configured `/api/pricing` marketplace
catalog and uses the existing pricing-group filter. The settings discovery
button forces a marketplace refresh; credential refresh and managed-provider
synchronization reuse the same catalog entry point. At the user's request,
ModelDropdown and its tests were restored exactly to origin/develop at
26d88768, including its original `/models` lazy-loading path. Apart from the
description containment and introduction-only follow-ups above, its styles and shared dropdown
components match that upstream revision. The two dropdown
test files passed all 21 tests after restoration; no page test was performed.
Non-Tuzi providers continue to use their `/models` endpoint. Marketplace
failures and empty groups report errors without importing `/models` entries.
Explicitly added manual models retain their existing preservation behavior.

Follow-up classification repair: marketplace tags can describe media input,
not media generation. `gpt-6-astra` and `gpt-6.1-sol` have mixed text/image tags
and a text chat endpoint in the captured public directory. Both pricing formats
now preserve `category` and raw `tags` separately, without copying tags into
category. Actual categories retain their priority. Raw tags are split and
matched exactly: explicit generation labels precede text/reasoning/code labels,
then standalone video/audio labels. Generic image/input or unrecognized tags
do not grant image output. Mixed `text,image` is text;
`text,image-generation` and `文本,生图` remain image. No model-ID exception was
added for Astra. Existing GPT Image static safeguards remain unchanged.

Reloading a catalog marked `marketplace` also corrects automatic entries using
that provider's existing pricing-cache category/tag metadata. This does not fetch
the directory, change selected IDs, touch manual models, or reclassify a
`models-endpoint` catalog. Incorrect media defaults are removed when a cached
image entry is restored as text; the existing description is retained. If local
metadata is absent, use Get Models once. An old image selection cannot pin the
corrected text model back into an image dropdown.

The pricing cache now preserves optional category, raw tags, vendor and endpoint metadata.
Provider catalogs persist an optional `discoverySource` marker. After a
successful marketplace refresh, automatic entries absent from that catalog are
removed, and a missing historical selection cannot be recreated as a selectable
placeholder. Older catalogs remain readable; refresh them through Settings >
provider > Get Models, then confirm the selected models. Existing valid
selections are retained when the credential signature is unchanged.

Main-site pricing requests use the existing
`/__opentu_tuzi_session__/api/pricing` same-origin proxy, which is already
configured for local development and the repository's deployment targets.
The fetching indicator includes the marketplace request. No new dependency,
environment variable, database version change or separate deployment step is
required. Model IDs remain exact upstream identities; marketplace membership
does not guarantee successful provider execution or token-specific permissions.

Validation: macOS, Vitest 3.2.4. From `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  --config vitest.config.ts \
  src/services/provider-model-catalog.test.ts \
  src/services/__tests__/tuzi-managed-provider-models.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/utils/__tests__/runtime-model-classification.test.ts \
  src/utils/__tests__/model-pricing-service.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  src/components/ai-input-bar/ModelDropdown.test.tsx \
  src/utils/__tests__/suno-v2-discovery.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts
```

- 89 tests passed across ten files. Coverage includes authoritative catalog
  discovery with zero `/models` calls, unconfigured ID removal, suppression of
  historical missing-model placeholders, group filtering, metadata preservation,
  empty catalogs, pricing failures, missing managed profiles and non-Tuzi
  compatibility.
- New classification regressions cover 13 category combinations and reloads of
  both marketplace and endpoint catalogs. Before the repair, fresh Astra
  discovery and marketplace-cache restoration both failed with `image` instead
  of `text`; afterward all three new tests passed. Both reload cases assert zero
  network requests and preservation of selections, manual models and models
  without metadata.
- Raw-tag follow-up adds 13 exact-label examples, cached tag restoration and
  category priority, raw tag forwarding, and separate category/tag storage for
  both pricing response formats. The two new classification tests and pricing
  metadata tests failed before the raw-tag repair and passed afterward. Cases
  include bare image tags, image-named text models, `非生图`, actual `生图`,
  GLM mixed video/image input and Gemini mixed audio input.
- Drawnix type checking passed. Targeted ESLint passed with zero errors and
  33 warnings in existing settings code.
- The raw-tag follow-up's six touched TypeScript/test files pass targeted ESLint
  with zero errors and zero warnings.
- `NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
  web:build --skip-nx-cache` passed, including Web type checking, production app
  bundle and Service Worker build. Existing Sass, Browserslist and bundle-size
  warnings remain. `git diff --check` passed.
- Read-only public HTTP inspection on this date found 662 marketplace entries;
  `gpt-image-2.5-exact` and `gpt-image-2-exact` were absent. These counts are a
  dated snapshot, not a hard-coded allowlist. A direct main-site GET with a
  localhost Origin returned no cross-origin allow header, motivating proxy reuse.
- Local port 7201 returned HTTP 200. A GET through its existing same-origin
  marketplace proxy returned `success: true`, 662 models and neither `exact`
  ID. This verifies HTTP transport only, not a browser interaction or generation.

No browser interaction test, billable generation, token-specific availability
check, Windows run or production deployment was performed. To accept locally,
reload port 7201, refresh the Tuzi provider through Get Models, verify the two
unconfigured `exact` IDs are absent and confirm the desired selections. For the
classification follow-up, reloading with existing marketplace metadata should
already remove Astra/Sol from the image list and retain them as text models;
Get Models is needed when that metadata is missing or does not contain raw tags.
Older caches which merged tags into category remain readable, but cannot
fully reconstruct the raw tags. Fetch models once to apply exact raw-tag rules
to those caches; subsequent reloads reuse the saved metadata. No data clearing
is needed. Custom
Tuzi-compatible deployments must provide their configured pricing endpoint.
This section records both behavior and QA; the existing model-category lessons
document was updated instead of adding a standalone DOC.

## 2026-10-19 Input-bar model routing performance

Scope: reduce synchronous model filtering work without changing controls,
model selection, provider protocols, generation requests or media loading.
The ordinary input bar no longer computes executable PPT image/video lists
until the PPT explainer skill is active in Agent mode or its dialog is open. Both lists then use one synchronous
batch resolver with shared provider, catalog and binding snapshots.

`createSettingsInvocationPlanResolver()` is batch-scoped. Do not retain it
across asynchronous work or settings changes. Actual generation continues to
use the existing one-off resolver, which reads fresh settings. Legacy direct
models retain their existing fallback. Returned plans isolate headers and
nested binding metadata so one result cannot mutate another result's state.
No dependency, browser API requirement, storage migration, environment variable
or deployment-order change is introduced; no separate DOC is needed.

Validation: macOS, Node 26.8.1, pnpm 10.21.0, Vitest 3.2.4. From the repository root:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  --config packages/drawnix/vite.config.ts \
  packages/drawnix/src/services/__tests__/settings-routing-performance.test.ts \
  packages/drawnix/src/services/__tests__/settings-repository.test.ts \
  packages/drawnix/src/services/__tests__/provider-routing.test.ts \
  packages/drawnix/src/services/__tests__/model-adapter-registry.test.ts \
  packages/drawnix/src/hooks/__tests__/use-runtime-models.test.ts \
  packages/drawnix/src/utils/__tests__/settings-manager.test.ts \
  packages/drawnix/src/services/ppt-explainer/provider-contract.test.ts
pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json
NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false \
  pnpm exec nx run web:build --skip-nx-cache
```

- 7 files, 168 tests passed, including 5 new batch regressions. Coverage includes
  image/video route equivalence across 300 models, constant catalog reads,
  manual and ambiguous inherited bindings, provider isolation, disabled
  providers, missing credentials, explicit/missing binding IDs, schema
  preferences, legacy models, output isolation and fresh credentials next batch.
- The 300-model synthetic comparison used 200 image and 100 video models.
  Individual resolution took 5537.5 ms; batch resolution took 18.9 ms in the
  final run. All plans were strictly equal. The batch read the full catalog
  once and profiles twice, independent of the number of models. Timing is
  informational; deterministic assertions enforce the bounded reads.
- Drawnix TypeScript and the production Web/Service Worker build passed.
- Targeted ESLint passed with no errors. The input bar's 18 existing warnings
  were also reproduced against HEAD; the repository and new test have none.
- `git diff --check` passed. Existing IndexedDB/crypto test-environment warnings,
  npm configuration, Sass/CSS target, Browserslist and bundle warnings remain.

These are local code and synthetic performance results, not production frame
time or end-to-end speed measurements. No page test, real provider request,
Windows run, deployment or new memory/media policy was performed for this
optimization. The earlier production diagnosis is not post-change acceptance.
After deployment, repeat image selection and continuous pan/zoom on the same
populated authenticated Tuzi iframe, and check PPT model availability after
changing provider credentials. Existing media rendering costs remain outside
this optimization. Reload to load the new bundle; clearing user data is not
required.

### Local Authenticated Iframe Entry Validation

Follow-up on 2026-10-19: the local Tuzi frontend at
`http://127.0.0.1:5174/console/chat/2` embeds this checkout's optimized app at
`http://127.0.0.1:7214/`. The child explicitly trusts the parent origin.
The supplied system credential was verified against `/api/user/self` and
remains in the temporary parent process and the iframe bridge's memory.
No credential is included in the entry URL or repository files.

The temporary test configuration lives outside the repository. It supplies
the real parent frontend with verified account metadata and proxies only
allowlisted account/catalog reads to the fixed Tuzi origin. Its local
`providers/ensure` adapter returns already-existing managed providers; it does
not forward provider creation or mutation requests upstream. This adapter is
a local test boundary, not acceptance of production Session authentication
or production managed-provider writes. The newer `/api/opentu/tokens` route
returned 404 on the current deployment; existing provider credentials were
read from the existing account token APIs without creating replacements.

Observed results:

- The iframe bridge reported `tuzi` mode, `ready` status, the verified account
  identity, and 13 real account groups. The account panel showed connected and
  synchronized state.
- The app's existing provider synchronization pipeline loaded all 13 group
  catalogs successfully: 2,782 provider/model entries, including models shared
  by multiple groups. Every catalog reported `ready` with no discovery error.
- The provider settings UI showed the real `test` group's 790 models: 147
  image, 148 video, 87 audio and 408 text models.
- Remote token count and token IDs were unchanged before and after setup.
- Local proxy checks passed for authenticated account reads, rejection of
  missing/cross-origin callers, unknown-group rejection, and blocking the
  system-token creation route. Both temporary scripts passed `node --check`.
- Reloading the complete parent entry restored the ready account bridge.
  Reloading only the child iframe can instead change `document.referrer` to
  the child origin, which conflicts with the configured parent origin. A local
  `Referrer-Policy` header did not resolve that browser behavior and was removed.
  Refresh the complete parent entry after a child-only reload or a development
  reload that loses authentication. Production bridge code was not changed.
- No generation, token creation/rotation, production deployment or populated
  canvas performance acceptance was performed. The local board remains a
  separate browser-origin data store; representative pan/zoom/image-selection
  performance still requires the same populated board as the production trace.

## 2026-10-16 Nano Banana 2.1 reference image MIME regression

Scope: the Gemini native `image_url` to `inline_data` conversion, including
data URLs, virtual cached images and downloaded reference images. Previously,
valid image bytes with an absent or generic binary MIME reached the gateway as
`application/octet-stream` and were rejected before any model invocation.

The conversion now identifies PNG, JPEG, GIF, WebP and AVIF from a bounded
Base64 prefix when MIME is absent, `application/octet-stream` or
`binary/octet-stream`. It preserves the original Base64, image order and image
count. Existing declared `image/*` inputs remain supported. Unknown binary
content and explicitly non-image MIME are rejected before provider submission,
with the failing image index. Explicit audio/video `inline_data` parts retain
their existing behavior. Signature recognition is not full image decoding;
the upstream decoder still validates the complete image.

Validation: macOS, Vitest 3.2.4. From `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  src/utils/gemini-api/apiCalls.test.ts \
  src/utils/gemini-api/services.test.ts \
  src/utils/gemini-api/message-utils.test.ts \
  src/services/__tests__/provider-routing.test.ts \
  src/services/__tests__/model-adapter-registry.test.ts
```

- 176 tests passed across five files. All 15 new regressions failed against
  the original converter and passed after the fix.
- Coverage includes mixed JPEG/PNG two-image submission with a generic MIME
  second image, supported binary signatures, absent MIME in data URLs and cached
  Blobs, binary MIME downloads, and zero submissions for HTML, WAV, invalid
  Base64 or empty cached data. Existing audio/video serialization tests passed.
- Drawnix TypeScript checking passed. Targeted ESLint passed with no errors;
  17 pre-existing `any` warnings remain. Existing IndexedDB mock and Node
  deprecation warnings remain.
- `NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
  web:build --skip-nx-cache` passed from the repository root, including Web
  TypeScript checking, production app and Service Worker builds. Existing Sass,
  CSS target compatibility, Browserslist and bundle-chunk warnings remain.
- `git diff --check` passed.
- The existing service at port 7202 belongs to this checkout and returned HTTP
  200. This is a service check, not browser or generation acceptance.

No page test, real provider request, Windows run or deployment was performed
for this fix. The original production reference files and request
payload were not captured. Gateway pre-upstream error logging remains a separate
backend issue and was not changed. No new dependency, configuration, migration or
standalone DOC is needed.

After deployment, use the original two references with Nano Banana 2.1. Inspect
the native `generateContent` request for an `image/*` MIME on each image part,
and confirm the previous generic-binary MIME rejection no longer occurs. A real
generation test is billable and has not been performed here.

## 2026-09-22 Waiting-for-execution regression

The runtime-only catalog exposed a feedback loop in chat generation controls:
session restoration used a null model reference while model normalization added
the runtime provider reference. Separate effects published intermediate state,
which the parent echoed back and persisted repeatedly. The selector policy is
unchanged. Restoration, normalization and persistence now run in order, with
semantic state comparison and session-aware deduplication.

The temporary 60-second submission preparation deadline and its cancellation
signal have been removed. Preparation still awaits chat storage and propagates
real storage errors without retrying or falling back to generation. Provider
request timeouts and retries are unchanged.

Validation environment: macOS, Node 26.8.1, pnpm, Vitest 3.2.4, system Chrome.
From `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  src/hooks/__tests__/useWorkflowSubmission.test.ts \
  src/components/chat-drawer/__tests__/useChatDrawerGenerationControls.test.tsx \
  src/components/chat-drawer/__tests__/EnhancedChatInput.test.tsx \
  src/components/chat-drawer/__tests__/drawer-generation-route.test.ts \
  src/utils/__tests__/chat-drawer-session-target.test.ts \
  src/utils/__tests__/workflow-task-sync.test.ts \
  src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts \
  src/services/__tests__/ai-generation-preferences-service.test.ts
```

- Result: 9 files, 135 tests passed. The 15 new tests cover bounded parent
  persistence under StrictMode, legacy/new/switched sessions, equivalent cloned
  state, external updates, delayed runtime discovery, provider identity,
  removed-model recovery, text/agent/audio counts, storage success/failure and a
  simulated 120-second write that completes without a deadline.
- Red/green check: the first three state tests failed with a persistence loop on
  the original hook, then passed after the fix. Final tests use a callback stable
  within each session, matching the parent component.
- `pnpm exec nx typecheck drawnix`: passed. Targeted ESLint: no errors; existing
  `any` and hook-dependency warnings remain in the submission hook/chat drawer.
- `pnpm exec nx build web`: passed, including web typecheck, production app
  bundle and Service Worker build. Existing Sass deprecation, CSS `:export`,
  Browserslist, mixed-import and large-chunk warnings remain. The direct Nx
  command avoids the version-writing/manual-generation wrapper in `build:web`.
- `git diff --check`: passed.
- Node 26's native Web Storage initially hid JSDOM localStorage and caused 31
  preference tests to fail before their assertions. The command-scoped option
  above restores JSDOM storage without changing project configuration. Existing
  IndexedDB/config-writer, sourcemap and EnhancedChatInput `act` warnings remain.
- Isolated browser: configured one runtime-only GPT Image 2.5 model, empty chat
  storage, fake credentials, and intercepted all external requests. The image
  endpoint returned a controlled HTTP 400. First submission reached the endpoint
  in 487ms; after reload, the next reached it in 409ms. Inputs recovered in
  1663ms and 1597ms, respectively, with zero page errors and two intercepted
  generation requests. No billable request or user browser session was used.
- This is local validation, not production proof. Real provider latency,
  successful media generation, a permanently blocked browser database, and
  unrelated workflows were not tested. The pre-existing proxy URL assertion in
  the runtime discovery suite described below remains outside this change.

Manual acceptance after deployment: use a provider with a runtime model catalog,
send from an empty chat and an existing chat, reload and send again, switch
sessions/providers and confirm parameters persist. A provider error should
release the input. No new dependency, environment variable, or migration is
required. Reload already-open pages to load the fix; do not clear user data.

## Earlier Model Refresh Validation

Saving a changed API key or model API base URL clears that provider's old
catalog, including legacy catalogs without a signature, and retrieves a new
catalog. Successful automatic refresh selects all returned models. Editing only
the provider name does not refresh models. Explicit model discovery retains its
selection dialog. When at least one enabled provider has usable discovery
credentials, model selectors use only selected runtime catalog entries and do
not mix in the built-in catalog. A type absent from the API response therefore
shows zero models. The built-in catalog remains the fallback when no provider
can discover models. The count includes audio models.

Validation on 2026-09-21:

- Final post-merge focused run: 36 tests passed and the known stale proxy URL
  assertion was explicitly skipped. Drawnix TypeScript validation and diff
  checks passed.
- Follow-up for the 160 discovered image models versus 34 static image models:
  embedded mode previously excluded `legacy-default` without a Tuzi system
  token, even when its independent API key and base URL were configured.
  Explicit provider credentials now allow that catalog into model selectors;
  this changes catalog visibility only, not endpoint authentication.
- The latest runtime discovery, hook, and credential refresh run passed 22 of
  23 tests. The default-provider/no-system-token regression passed alongside
  the custom-provider case; the only failure remains the old proxy URL assertion.
  Real credential and page acceptance have not been performed.
- Follow-up: model hooks now recompute on the discovery store revision rather
  than a single provider state reference. This covers profile changes and
  discovery updates for other providers even when the default state is unchanged.
- `pnpm exec vitest run --config packages/drawnix/vite.config.ts packages/drawnix/src/hooks/__tests__/use-runtime-models.test.ts`: 3 tests passed,
  covering selectable, preferred, and profile lists changing from two old models
  to one new model while the catalog state reference remains unchanged.
- The running server on port 7202 serves the updated revision-based hooks.
- `pnpm exec vitest run --config packages/drawnix/vite.config.ts packages/drawnix/src/components/settings-dialog/__tests__/provider-model-refresh.test.ts`: 4 tests passed.
- The focused runtime, grouping, dropdown, and refresh run passed 32 of 33
  tests. The only failure is the pre-existing proxy URL assertion described
  below; the new runtime-only catalog assertions passed.
- `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json`: passed.
- `git diff --check`: passed.

The existing runtime discovery suite has 1 pre-existing assertion failure. The
implementation now uses
`http://localhost:3000/__opentu_tuzi_session__/v1/models`, while the test still
expects the former direct `https://api.tu-zi.com/v1/models` fallback.

Focused tests cover changed keys/endpoints, unchanged credentials, cleared keys,
providers without model discovery, new response selection, and isolated failures
with sanitized error messages. Runtime discovery tests also cover exact selected
catalog output, a zero-model media type, and static fallback after disabling the
configured provider. Tests use mocks and no real credentials.

Browser testing, real gateway verification, and production deployment were not
performed. For manual acceptance, save a key with a different model catalog and
check the refreshed count; save an invalid key and check the refresh failure
state. Changing permissions remotely on the same key still requires manual model
discovery. No independent deployment or configuration changes are required.
