# 文本卡片阅读与复制验证

## 范围

普通画布的 Markdown 文本卡片：标题栏全文复制、正文选区复制、成功与失败反馈、与画布事件隔离、已有知识库入口，以及新卡片阅读宽度上限和正文排版。

全文复制保留原始 Markdown；无实际标题时不复制显示占位标题。新卡片宽度最大 720 画布像素，已有卡片尺寸不迁移。共享剪贴板工具现在在备用复制返回 false 时抛出错误，调用方可以显示真实失败状态；函数签名不变。

## 环境

2026-10-12，macOS，Node 26.8.1、pnpm 10.21.0、Vitest 3.2.4、React 18.3.1，使用现有项目依赖。功能分支 `dev/text-card-copy-20261012` 已显式 fetch 并 merge `upstream/develop`（`3d84bb7c`），自动合并成功，无内容冲突。

## 实际验证

在仓库根目录运行：

```sh
cd packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts src/components/card-element/CardElement.test.tsx src/utils/__tests__/canvas-insertion-layout.test.ts src/utils/__tests__/runtime-helpers-clipboard.test.ts src/components/workzone-element/WorkZoneContent.test.tsx src/services/canvas-operations/canvas-insertion.test.ts --silent
cd ../..
pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit
pnpm exec eslint packages/drawnix/src/components/card-element/CardElement.tsx packages/drawnix/src/components/card-element/CardElement.test.tsx packages/drawnix/src/constants/card-colors.ts packages/drawnix/src/utils/canvas-insertion-layout.ts packages/drawnix/src/utils/__tests__/canvas-insertion-layout.test.ts packages/drawnix/src/utils/runtime-helpers.ts packages/drawnix/src/utils/__tests__/runtime-helpers-clipboard.test.ts
NODE_OPTIONS=--max-old-space-size=8192 pnpm exec vite build --config apps/web/vite.config.ts
git diff upstream/develop...HEAD --check
```

| 验证 | 结果 |
| --- | --- |
| 卡片组件 8 项 | 通过：全文复制、正文可选择、失败重试、无标题、Ctrl/Cmd+C 与画布隔离、按钮指针隔离、知识库入口 |
| 剪贴板工具 4 项 | 通过：Clipboard API 成功、受限时降级、降级失败拒绝、异常后清理临时元素 |
| 插入布局 16 项 | 通过：现有布局行为及宽画布 720 上限 |
| WorkZone 2 项、画布插入 9 项 | 通过：受影响生成展示和插入回归 |
| Drawnix 类型检查 | 通过 |
| 文件级 ESLint | 通过，0 错误；原有布局文件及其测试共 9 条警告 |
| Web 应用生产构建 | 通过（53.73 秒） |
| Git 差异检查 | 通过 |

首次直接从 apps/web 使用 pnpm exec vite build 未加载所需配置，报入口缺失；改为根目录显式指定 apps/web/vite.config.ts 后构建通过。该问题属于验证命令定位，无源码修改。

## 限制与风险

- 按任务约束未执行浏览器点击、截图、视觉回归或页面端到端测试；JSDOM 验证不能证明真实浏览器剪贴板权限、选区拖动或视觉效果。
- 未执行全仓库测试、覆盖率统计、Service Worker 构建或生产部署。未发起供应商生成请求。
- ESLint 缺少 Nx ProjectGraph 时跳过模块边界规则。工具另有 NPM_TOKEN 占位、Node API 弃用、Browserslist 数据过期及依赖 sourcemap 警告；构建另有 Sass 弃用、CSS :export 和包体积等警告，不影响上述命令通过。
- 共享复制函数在浏览器拒绝备用复制时会如实失败；相关按钮及正文 Hook 已处理拒绝。实际剪贴板访问仍依赖浏览器策略。

## 人工验收与回滚

在普通画布打开或生成文本卡片：检查长段落阅读与内部滚动；复制图标应复制完整标题和 Markdown，选区快捷键应只复制所选文字且不触发画布复制；已有知识库图标应继续打开对应笔记。检查宽屏中新卡片不超过 720 画布像素，已有卡片尺寸保持不变。真实浏览器限制复制时应显示失败并允许重试。

无需配置、依赖、权限或数据迁移。使用说明已更新 `docs/user-manual/content/drawing/text.mdx`，变更已记入 CHANGELOG；回滚可撤销本 PR。
