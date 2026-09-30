# 文档批量生成 QA

## Excel 模板与格式提示

增加下载模板及可变数量参考图填写说明；模板只包含可直接识别的标题/提示词/图片/数量列和一条需替换的示例。真实导入器回读模板验证通过，未产生行诊断。普通 metadata.xml 不再触发特殊图片误报，richData/cellimages 和 XLRICHVALUE 仍保留提示。XLSX 导入与模板定向测试共 13 项通过；工作流 TypeScript 和 diff 检查通过。未执行浏览器下载交互或页面测试。

## 结果图片加载与预览修复

2026-09-26：结果卡片不再直接使用任务 URL 的原生 img，改为通过现有 loadResult 读取本地缓存优先的 Blob，再建立组件自有 Object URL。点击图片使用 Ant Design 放大预览；加载失败显示错误提示，卸载/切换结果时取消读取并释放 URL。不会提交新生成请求。

工作流 TypeScript 检查通过；图片读取定向测试 4 项通过（含虚拟结果 URL 命中缓存且不发网络请求），仓库回归 9 项通过；页面 ESLint 0 error、10 warning。未执行浏览器页面验收或真实供应商请求，无法仅凭截图确认所有破图都来自相同地址类型。

## 批量进度展示

2026-09-26：新增本轮进度条、已结束/总数、处理中及排队/成功/失败/待确认/取消统计。在途任务存在时空结果区展示等待提示。百分比按终态工作项计算，不虚构供应商单图百分比；取消不展示为成功状态。工作流 TypeScript 检查通过，页面定向 ESLint 为 0 error、10 warning（既有 hook/非空断言提示）。未执行浏览器或真实生成请求。

## 模型渠道一致性修复

2026-09-26：批量模型选择、Excel 可匹配模型目录和提交校验共用 `resolveBatchImageModel`，仅接受原生可用图片模型。旧渠道/同名自定义渠道不自动迁移；无效选项隐藏参数面板并提示重新选择，提供手动刷新原生模型操作。

- 定向 Vitest：`document-models.test.ts`、`document-scheduler.test.ts`、`native-settings-panel.test.tsx` 共 10 项通过。
- `pnpm exec tsc -p packages/drawnix/src/workflow-mode/web/tsconfig.json --noEmit` 通过。
- 未执行页面测试和真实供应商请求。

日期：2026-09-26。目录：`/Users/lkj/Desktop/working/opentu-4`；分支：`codex/develop-base-20260925`。当前工作区另有工作流整合改动，测试结果针对集成工作区，不代表这些改动已提交或发布。

## 实际执行

| 命令 | 结果 |
|---|---|
| `pnpm test:workflow -- --run` | 19 文件、117 测试通过（含删除快照回归） |
| `pnpm exec vitest run --config packages/drawnix/vite.config.ts packages/drawnix/src/services/__tests__/document-batch-task-storage.test.ts packages/drawnix/src/services/__tests__/task-queue-service-image-retry.test.ts packages/drawnix/src/services/__tests__/image-generation-recovery-service.test.ts` | 3 文件、111 测试通过 |
| `npx tsc -p packages/drawnix/tsconfig.lib.json --noEmit` | 通过 |
| `pnpm nx run web:typecheck`、`pnpm nx run drawnix:typecheck` | 通过 |
| `pnpm nx run web:build` | 应用及 Service Worker 构建通过；有 Sass 弃用、大 chunk、混合动态/静态导入等警告 |
| `git diff --check` | 通过 |
| `openspec validate add-document-batch-image-generation --strict` | 未执行成功：当前 PATH 缺少 openspec |

测试覆盖合成 XLSX 标准关系/映射/诊断、PDF adapter/识别结构、行编辑、事务身份/冲突/容量、唯一提交 ticket、快照重试、普通任务创建和恢复兼容。故障测试中的预期存储错误日志不代表断言失败；Node 测试环境另有 localStorage/IndexedDB 警告。

## 未覆盖与风险

- 未执行浏览器页面、视觉、真实供应商请求或部署验收。
- 未覆盖提案全部崩溃窗口、全量跨标签页生命周期、最大预算压力、所有真实 Excel/PDF 变体、签名 URL 服务行为。
- 受支持的异步 remoteId 已接入只查询恢复；真实供应商恢复未验收，受理不确定项不自动重发。
- 资产保存复用既有资产库；通过资产选择器插入画布，不新增工作台直接插入按钮。
- feature flag 是构建/启动开关，不会即时停用已打开的旧构建标签页，运维回滚应先暂停所有活跃标签页。

这些边界不应以本地类型检查或构建通过代替供应商/页面验收。

## 最终增量检查

定向 ESLint 修复下载流循环和控制字符表达式两处错误后为 0 error、14 warning；warning 包含非空断言、hook 依赖与循环闭包提示，仍需后续整理。`pnpm check:cycles` 未通过，报告 layer-decomposition 四文件静态循环；这些文件无本任务差异，未进行无关重构。

新增下载边界定向命令：`pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts tests/document-export.test.ts tests/document-repository.test.ts`，2 文件 12 项通过（3 项下载边界 + 9 项仓库回归）。产物已确认包含 PDF Worker `.mjs` 与 XLSX 导入 Worker `.js`。


## 审查修复后的容量与调度保护

- 用户已确认：远程单张图片下载 60 秒超时，记入失败清单后继续；PDF 每页最多 50,000 个文本项，超出后保留页图并要求人工核对。原有 25 MiB 单图、100 张/200 MiB ZIP 分包等上限不变。
- 实现：下载覆盖取响应与读取响应体，取消会清理定时器；ZIP 使用现有 fflate 逐张写入 Blob 分块。PDF.js 分块读取文本，计数超限即停止累积。XLSX 未支持图片扩展使行进入需核对；显式确认诊断后才能生成。PDF 预览未加载完成不能裁图。
- 调度：活跃 owner 不能被第二个 owner 抢占；已有批次追加行保留控制权。已消费 ticket 的异常保持不确定，未消费且容量不足的项继续排队；无法查询/查询失败记录可见原因，保留原任务，恢复不 POST。
- 已执行：最终工作流全套 37 文件、455 项通过，其中导出 6 项、PDF 11 项；另以定向命令复验这两个文件与本地/原生恢复、图片缓存、IME，共 67 项通过（包含在全套内，不重复累计）。共享任务存储/队列等测试结果及最终类型、构建、lint 见 `qa-workflow-runtime.md`。
- 关键断言：响应体停滞和 fetch 停滞均在 60 秒终止；后续图片仍进入 ZIP，包内 manifest 和独立失败 JSON 含超时项；PDF adapter 返回超限数组或抛出流计数限制时均保留页图、空文本与人工核对诊断。PDF.js 真实 Worker 和超大文件未做页面压力验证。
- 外链策略只覆盖 URL 字面检查、已知本地别名、重定向与凭据省略，不能阻止任意域名 DNS rebinding。流式 ZIP 仍保留当前分包 Blob，不能声称无内存峰值。恢复结果上游未返回的尺寸/字节数仍为未知，不伪造元数据。
- 人工验收：导入含特殊图片的表格确认逐行补图提示；超限 PDF 应能查看原页；下载含失效/慢链接的结果时后续文件继续并生成失败清单。未执行浏览器、真实收费生成、最大预算/所有故障窗口验收。无需迁移或配置变更；暂停队列后回滚代码，保留本地数据库和未确认请求。

```sh
pnpm exec vitest run --config packages/drawnix/src/workflow-mode/web/vitest.config.ts tests/native-local-recovery.test.ts tests/native-task-recovery.test.ts tests/document-export.test.ts tests/document-pdf-import.test.ts tests/native-image-result-storage.test.ts tests/native-prompt-ime.test.tsx
```
