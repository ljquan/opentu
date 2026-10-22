# 兼容默认模型与上游同步 QA

日期：2026-10-21。目录 `/Users/lkj/Desktop/working/opentu1`，分支 `develop`；Node 26.8.1、pnpm 10.21.0、Vitest 3.2.4、macOS。

## 上游与本地改动保留

执行 `git fetch origin develop`，并使用 `git ls-remote origin refs/heads/develop` 独立核对。远程、本地 HEAD 与 FETCH_HEAD 均为 `7b3aa15e329bf842aab4bf01ead7b8a397ae0b01`，`HEAD...origin/develop` 为 0/0。`git merge --ff-only origin/develop` 返回 Already up to date，没有新增上游提交或冲突。

同步前将全部 9 个本地修改或新增文件保存到独立临时目录，并记录完整文件 SHA-256、Git 二进制补丁和基线提交。同步后以及默认模型开发后，均确认这 9 个文件与备份一致；包括缩略图修复、测试、QA、截图和原有 `src/data/image.test.ts` 修改。既有 stash 没有改动。因为远程基线相同，无需清空文件或执行 stash 应用。

## 默认模型与配置升级

| 类型 | 新默认值 | 验证 |
| --- | --- | --- |
| 图片 | `gpt-image-2.5-sunburst` | 项目静态模型类型为 image |
| 视频 | `doubao-seedance-2-5-260628` | 复用 Seedance 2.5 ID 常量，类型为 video |
| 文本 | `gpt-6-sol` | 项目静态模型类型为 text |
| 音频 | `suno_music` | 类型为 audio，现有默认版本为 `chirp-v6` |

修改生产代码 3 个文件：`constants/model-config.ts`、`utils/settings-manager.ts`、`utils/settings-types.ts`。新增可选的一次性标记 `compatibilityDefaultModelsV2`，只升级 Tuzi 兼容配置中精确匹配的旧默认模型。测试验证其他模型、其他服务地址、自定义预设保持；升级后手动切回旧模型并重新加载也保持。凭据、地址和鉴权字段没有变更。

## 实际测试

从 `packages/drawnix` 执行：

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/constants/__tests__/model-config.test.ts \
  src/services/__tests__/settings-repository.test.ts --silent
```

结果：3 个文件、92 项全部通过。新增默认值和升级测试先在旧代码上失败，生产修改后通过。

扩大回归追加以下 7 个文件：`ai-generation-preferences-service.test.ts`、`retry-image.test.tsx`、`SelectedContentPreview.test.tsx`、`BoundImageContentPreview.test.tsx`、`EnhancedChatInput.test.tsx`、`unified-cache-service.test.ts`、`image-operation-timeout.test.ts`。完整运行 10 个文件、192 项：191 通过、1 项原有失败，没有在该回归中跳过测试。

唯一失败为“迁移 Seedance 2.5 的旧组合偏好时移除不受支持的分辨率”：断言期望 `size=''`，实际为 `1080p`。另将未修改的 HEAD 导出到隔离临时目录，仅运行该用例（`-t '迁移 Seedance 2.5'`），复现相同断言失败；该定向基线命令其余 38 项被过滤，不计为回归通过。没有修改这条测试或视频偏好实现。

从根目录执行：

```sh
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
pnpm exec eslint packages/drawnix/src/constants/model-config.ts \
  packages/drawnix/src/utils/settings-manager.ts \
  packages/drawnix/src/utils/settings-types.ts \
  packages/drawnix/src/utils/__tests__/settings-manager.test.ts
pnpm exec vite build --config apps/web/vite.config.ts
git diff --check
```

类型、构建和差异检查通过；相关文件 ESLint 0 errors、22 条原有 unused/any/non-null warnings。构建 59.79 秒，保留既有 Sass、Browserslist、导入分块、大 chunk 等提示。此前图片组件的完整 lint 模块边界限制另见缩略图 QA，不声称全仓库 lint 通过。

## 运行与边界

7201 服务继续属于当前目录；首页及包含新版默认值、升级标记的源码模块 HTTP 200。无需重装依赖或更改环境变量。刷新 `http://localhost:7201/` 并重新打开供应商设置，可验收“兼容默认模型”一栏。已有其他自定义模型应继续显示原选择。

本次默认模型变更未做浏览器页面测试、供应商调用、收费生成或线上部署，模型可调用性和计费以供应商与令牌权限为准。之前缩略图的真实页面回归证据继续保留。没有本地提交、推送、创建或合并 PR。维护说明更新到现有端点设置文档，不另建 DOC。

如需恢复旧默认，可在设置中重新选择旧模型；一次性升级标记会保留该选择。新增字段可被旧版本忽略，不需要删除缓存、凭据或画板数据。
