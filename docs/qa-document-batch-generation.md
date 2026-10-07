# 文档批量生成 QA

## 批量结果手动插入画布

2026-10-06：新提交的画布批量图片任务设置 `autoInsertToCanvas: false`，生成结果留在工具预览和任务记录中。新增“插入选中图片”操作：按勾选任务行的顺序收集已完成图片，去除重复任务 ID，调用既有画布插入服务；每 5 张划为布局组并随视口换行，保留图片尺寸、提示词和 generationTaskId。无已完成图片或画布未就绪时禁用；插入期间使用同步锁和 loading，切换画布后阻止异步写入。失败沿用画布插入服务的错误提示和事务回滚行为。

范围限制：只改变新提交批量任务参数，不修改其他工具/Workflow，也不改写已经提交的在途任务；在途旧任务仍可能依原参数自动插入。手动操作允许再次插入同一批图片，生成状态和下载结果不受影响。无需配置或迁移，此处同时记录使用说明，不另建 DOC。未执行页面操作、真实生图或 100 张图片压力验收。

实际验证：库 TypeScript、Web build-app、`git diff --check` 通过；画布插入服务 9 项及布局 15 项既有回归通过（24 项），验证加载失败回滚、信息关联及网格布局；组件 ESLint 0 error、13 条既有 warning。既有服务回归不等同于新增按钮页面验收。人工检查：新批量生图完成后画布不新增图片，勾选有结果的行并点击插入后只有所选结果进入画布，无结果时按钮禁用。

## 导出下载并发调整

2026-10-06：按用户要求，导出图片读取由最多 4 个任务行调整为固定最多 8 个任务行（替代下方此前的 4 路记录）。每行内部仍顺序读取图片，保留打包前排序、失败来源记录和超时处理；不影响生图并发。调度回归测试断言 12 个工作项的峰值为 8。

## OCR 审查问题修复

2026-10-06：审查了画布批量出图当前未提交改动。修复混合 URL/内嵌图按参考图列排序、图片导出同步锁、缓存查找禁止联网后再由带超时的唯一请求获取、Safari 兼容 AbortController 超时、有界 4 并发、超长/失败来源分段写入明细页、XLSX 列宽上限及图片网格位置/宽高比例。无 `createImageBitmap` 时按用户确认的 1x1 元数据兼容回退，仍嵌入图片；TDesign 类型声明确认复选框 `onClick` 参数为 `{ e: MouseEvent }`，因此保留 `context.e.shiftKey`，OCR 对这一点的报告为误报。

最终验证：设置 `BATCH_XLSX_TEST_FILE='/Users/lkj/Downloads/批量生图测试.xlsx'` 后运行 XLSX 导入/导出、模型选择和下载工具定向回归，4 文件 23 项通过（包括原文件 9 张图片、混合参考图列顺序、超长来源分段、有界并发、横竖图片比例及标准 XLSX 回读）。库 TypeScript 检查、`web:build-app` 和 `git diff --check` 通过；定向 ESLint 0 error、组件 13 条既有 warning。

失败来源明细包含数据行、图片列、图片序号、来源分段和原因，可按序拼接还原源字符串；主表过长摘要会指向明细页，不中断全部导出。单张大小仍不限制；并发按最多 4 个任务行调度，各行图片顺序处理，打包前统一排序。图片超过一排按 13 列网格排列，缩小缩略图以适应 Excel 行高上限，原图字节保持完整。未执行页面、真实供应商、Safari 实机或 Excel/WPS/Numbers 视觉验收，未重新运行远程 OCR；修复依据本地代码、依赖类型和上述测试核对。无需配置、依赖或迁移，不另建 DOC。

## 图标提示与新版 Excel 模板

2026-10-06：下载模板、导入 Excel、批量导入图片、选择失败行、反选五个图标按钮提供即时悬浮说明及 aria-label；禁用的选择失败行按钮仍可悬浮查看原因。新版模板包含提示词、参数、参考图1-3、数量列，并增加填写说明工作表；导入端仍只读首个任务工作表。新增无媒体时 XLSX 规范化/自动换行处理，模板也使用同一工作簿处理器。定向 XLSX 结构/导入回归、类型检查、组件 ESLint 和 `git diff --check` 验证。

本次验证：XLSX 导入/导出回归 6 项通过、原用户文件条件测试 1 项跳过；类型检查、Web build-app 构建、差异检查通过；组件 ESLint 0 error、13 条既有 warning。未执行页面悬浮、模板实际下载填写回导或 Excel 客户端视觉验收。

## 选中行与全部导出

2026-10-06：画布底部提供“导出选中行”和“导出全部”。未选中行时禁用选中导出；无任务时禁用全部导出，导出中两者均禁用。选中导出按当前表格顺序筛选，图片锚点、行高、列宽和完成提示基于导出子集重新计算，文件名增加 `-selected`。两种范围共用图片嵌入、自动换行和失败来源保留逻辑；空提示词行仍按所选范围保留，不自动去重。

本次库 TypeScript 检查、`xlsx-image-export.test.ts` 4 项既有导出回归和 `git diff --check` 通过。未执行页面点击或 Excel 客户端验收；人工检查选中非连续行后导出只包含勾选行且顺序、图片对应正确，全部导出保留所有行。未新增配置、依赖或迁移，不另建 DOC。

## 画布批量出图导出图片丢失修复

2026-10-06：用户文件 `batch-image-export_20261006_1334.xlsx` 含 15 行任务，但 ZIP 包没有任何媒体/绘图资源。本地参考图被替换为占位符，结果图仅保留本地缓存地址。修复后仍保留当前任务表全部行，通过标准绘图关系把可读取图片嵌入参考图/预览图列，成功图片的单元格留空，不额外写入图片标记文字；读取失败保留原 URL 和失败原因，导出结束显示成功/失败数量。缓存优先读取，远程请求 60 秒超时；用户选择不限制单张图片大小。导入端按参考图列筛选锚点，结果预览不会作为参考图导入。旧文件中已丢失的图片不能仅凭占位符恢复，需从当前任务表重新导出。

回归覆盖 XLSX 重开读取文字、标准媒体/关系/锚点、图片二进制、导出后按参考图列重新导入、Data URL 和远程失败。保留既有行数据和前序优化，不修改 Workflow。

实际校验：设置 `BATCH_XLSX_TEST_FILE` 指向用户原始测试表，从 `packages/drawnix` 运行 `pnpm exec vitest run --config vitest.config.ts src/utils/xlsx-image-export.test.ts src/utils/xlsx-embedded-images.test.ts src/utils/__tests__/model-selection.test.ts src/utils/__tests__/download-utils.test.ts`，4 文件 21 项通过，包含非图片响应拒绝测试。`pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 通过；上述工具及组件定向 ESLint 为 0 error、组件 13 条既有 warning；`git diff --check` 通过。

最终 `pnpm exec nx run web:build-app` 通过，输出有既有 Sass 弃用、混合动态/静态导入和大 chunk 警告，不代表 Excel 客户端视觉验收。

尚未执行页面下载、Office/Numbers/WPS 视觉或超大图片压力验收。远程 CORS/签名过期、缓存资源丢失可能导致部分图片只保留来源；导出不会触发生图。不限制图片大小会增加内存和文件体积；导入仍沿用既有 50 MiB 文件及 25 MiB 单图片限制，大导出文件可能需要拆分后重新导入。无需新依赖、配置或迁移，此 QA 同时记录使用和维护边界，不另建 DOC。

## 导出单元格自动换行

2026-10-06：导出 XLSX 的单元格全部应用顶部对齐和自动换行；任务行高依照提示词/参数文本长度估算，同时维持图片行的展示高度，长文不再横向溢出或被固定行高裁切。导出 OOXML 测试断言 `wrapText=1` 并覆盖图片锚点同文件；`xlsx-image-export.test.ts` 4 项通过，TypeScript、构建和最终 `git diff --check` 通过。未执行 Excel/WPS/Numbers 页面视觉验收，行高是估算值，超长单元格最多 300pt。

## 画布 Excel 内嵌图片漏导修复

2026-10-06，工作目录 `/Users/lkj/Desktop/working/opentu3`：画布导入原先仅读取单元格文字/图片 URL，遗漏 XLSX 的浮动图片。现在沿工作簿、工作表、绘图关系定位 PNG/JPEG/GIF/WebP 图片，支持 oneCellAnchor/twoCellAnchor，按左上角的实际行号归属任务并按列从左到右排序。中间空行不会改变归属；同一行的图片全部导入为可持久化 Data URL；参考图1/2/3 等列里的文本链接也能读取。原有 Workflow 未修改。

- 用户文件 `批量生图测试.xlsx` 解析回归通过：6 行分别得到 0、1、2、3、1、2 张参考图，共 9 张 PNG。
- 从 `packages/drawnix` 执行 `BATCH_XLSX_TEST_FILE='/Users/lkj/Downloads/批量生图测试.xlsx' pnpm exec vitest run --config vitest.config.ts src/utils/xlsx-embedded-images.test.ts src/utils/__tests__/model-selection.test.ts src/utils/__tests__/download-utils.test.ts`：3 文件、17 项通过，覆盖相对/包内绝对关系路径、多图排序、双单元格锚点、缺失图片报错、空行物理行号及既有依赖回归。原文件回归需通过该环境变量提供文件，普通测试不依赖用户 Downloads 文件。
- 库 TypeScript 检查及 `pnpm exec nx run web:build-app` 通过。定向 ESLint 无错误；组件保留 13 条既有 warning。`git diff --check` 通过。

限制：仅当前导入的第一个工作表；图片归属按锚点左上角，跨行浮动图片需人工确认。WPS/Excel 扩展单元格图片及绝对锚点图片不在此支持范围，检测到时明确报错；图片关系缺失或格式不支持时整次导入失败，不写入部分任务。新增读取限制为文件 50 MiB、单 XML 5 MiB、单图片 25 MiB、图片总量 200 MiB。图片仍受现有本地存储容量约束。

未执行页面交互、浏览器预览、真实供应商生成、生产或压力验收。人工验收：重新导入原文件，检查新增 6 行的参考图数量和顺序；此次修复不会自动补回之前已导入的行，确认后可删除旧行，避免重复生成。无需依赖安装、配置变更或数据迁移；QA 记录同时说明维护边界，不另建 DOC。

## 画布批量出图交互优化

2026-10-05：仅优化画布批量出图工具。工具栏按操作层级重新布局，增加选中行、待生成任务、排队/生成中、已完成和失败统计；生成、下载、删除、选择失败行等操作会根据当前数据状态启用或禁用，并在按钮上显示实际数量。表格在窄屏下保留最小可读宽度，选择列和序号列固定；补充表格、复选框和图标按钮的无障碍标签。保留原有任务队列、下载和画布插入逻辑，不涉及 Workflow。

- `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit`：通过。
- `pnpm exec vitest run --config vitest.config.ts src/utils/__tests__/model-selection.test.ts src/utils/__tests__/download-utils.test.ts`（工作目录 `packages/drawnix`）：2 个文件、14 项通过。
- `pnpm nx run web:build-app`：通过。
- `git diff --check`：通过。

未执行浏览器页面、视觉回归、真实供应商生成或下载验收；上述定向测试覆盖工具依赖的模型选择和下载工具回归，不等同于页面交互验收。人工验收应检查窄屏表格滚动、空提示词禁用生成、选中行数量显示、失败行重试和已完成图片下载。

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
