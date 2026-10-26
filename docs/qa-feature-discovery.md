# 新功能红点提示与 QA

## 2026-10-26 本地实现

应用菜单按钮和「设置 → 画布显示」分别提示当前图片工具栏新功能。首次加载时显示红点；点击菜单只清除菜单红点，点击画布显示只清除该项红点。未点击时，重渲染或刷新不会自动清除提示；点击后正常保存到浏览器本地，刷新后不再提示同一批功能。不同入口的查看状态独立，同入口的多个已挂载组件及其他标签页会同步。红点只作提示，参考连线仍默认关闭。

菜单的鼠标按下路径保持原交互，另补齐键盘原生激活路径；指针按下后产生的 click 不重复开关菜单。提示没有动画，不抢焦点，不增加可点击区域；有未查看功能时，按钮的可访问名称带有新功能说明。

## 保存与维护

- `utils/feature-discovery.ts` 定义功能标识和本地查看状态，当前两个入口的标识均为 `canvas-image-toolbar-20261026`。只有入口登记了新的功能标识，才会对已查看用户再次显示提示；普通刷新和不涉及新功能的版本发布不修改标识。
- 后续同入口有新功能时，更新 `FEATURE_DISCOVERY_REVISIONS` 中受影响入口的标识；画布设置有新功能时，同时更新菜单入口。无需新增服务器接口或用户账户字段。
- 已读状态键为 `aitu:feature-discovery:app-menu` 和 `aitu:feature-discovery:canvas-settings`，值为该入口已查看的功能标识。只保存查看状态，不保存提示文本、账户或媒体内容。
- `use-feature-discovery.ts` 负责组件同步和监听清理；`NewFeatureDot` 提供复用样式。实际入口为 `app-toolbar.tsx` 和 `settings-dialog.tsx`。
- 存储读取失败时保留提示；写入失败时至少在当前页面消除红点，不影响菜单/设置打开。存储被禁用时无法保证刷新后的持久化；清理网站数据后会重新提示。

## 实际验证

初次实现阶段环境：本地 macOS、Node.js 26.8.1、pnpm 10.21.0，`opentu-4/develop`，基线 `3386b632` 上的现有工作区。保留此前连线开关和验收修复，该阶段没有推送或部署。后续 PR 分支及最终验证见修复 QA 的「PR 提交前最终验证」。

在 `packages/drawnix` 执行：

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/utils/feature-discovery.test.ts \
  src/hooks/use-feature-discovery.test.tsx \
  src/components/toolbar/app-toolbar/app-toolbar.test.tsx \
  src/components/settings-dialog/image-toolbar-settings.test.tsx \
  src/plugins/canvas-association-line.test.ts \
  src/plugins/canvas-association.test.ts --silent
```

结果：6 个文件、60 项全部通过。新功能测试覆盖未点击状态保留、模块重载模拟刷新、点击后持久化、两个入口独立查看、旧功能标识触发新提示、写存储失败降级、重复点击不重复写入、已挂载副本/跨标签页同步，以及实际菜单组件的指针和键盘激活。另回归参考连线默认关闭、设置保存、隐藏/恢复、选择删除和撤销行为。

- Drawnix 与 Web TypeScript 检查均通过。
- 新增模块、测试及菜单组件 ESLint 无错误或警告；设置对话框为 0 错误、13 条原有警告，已使用 HEAD 源码复现相同警告。
- 8 个新增或完整格式化文件 Prettier 检查通过，设置对话框只做局部修改；`git diff --check` 通过。
- `pnpm exec vite build --config apps/web/vite.config.ts --outDir /tmp/opentu4-feature-discovery-web.nmXGX8` 通过，保留既有 Sass、Browserslist 和大 chunk 等构建警告。构建产物位于临时目录，没有改动版本号。
- 本地 `http://localhost:7204/` 返回 HTTP 200，只验证服务可达。

初次实现阶段没有真实页面点击或截图，后续用户授权的页面复测如下；生产验证仍未执行。键盘激活保留上述组件测试证据，本轮页面操作使用鼠标。

### 2026-10-26 实际浏览器补测

在本地 `http://localhost:7204/` 的隔离 Chrome 会话中，重置两个已读键作为测试前置条件，不影响用户既有浏览器数据。实际观察和点击：

- 菜单未点击前显示「应用菜单 (有新功能)」，刷新后提示仍存在，两个已读键均为空。
- 点击菜单后再刷新，菜单恢复「应用菜单」，菜单已读键保存当前功能标识；打开设置时「画布显示（有新功能）」仍有提示，该项已读键为空。
- 点击画布显示后提示立即消失；刷新、重新打开设置，按钮为「画布显示」、没有 `.new-feature-dot`，两个已读键均保存 `canvas-image-toolbar-20261026`。
- 新会话初始「显示工具文字」和「显示参考图连线」均关闭。另实测打开参考线时 11 条已有关系显示，关闭并刷新后全部隐藏，关系数据保留。文字显示及隐藏下载的偏好也可刷新恢复。

证据位于 `/Users/lkj/.codex/visualizations/2026/10/26/opentu4-retest-hphgct8q/`：`feature-unread-before-refresh.json`、`feature-unread-after-refresh.json`、`feature-menu-read-after-refresh.json`、`feature-all-read-after-refresh.json`、`feature-canvas-read-ui-after-refresh.json`、`reference-lines-off.json`、`reference-lines-on.json`；截图 `07-canvas-new-feature-dot.png` 与 `14-feature-read-after-refresh.png`。其他修复的实际验证和残留边界记录于 `docs/qa-prerelease-fixes-20261026.md`。

仓库内保留[画布显示独立红点截图](./assets/prerelease-fixes-20261026/canvas-new-feature-dot.png)，供 PR 审阅。

无需新增依赖、环境变量、权限或数据迁移。使用和维护说明已合并在本 QA，不另建 DOC；回滚本次源码后，额外的本地已读状态可由旧版本忽略。
