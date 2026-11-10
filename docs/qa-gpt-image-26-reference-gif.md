# GPT Image 2.6 参考图 GIF 编辑验收

日期：2026-11-10（Asia/Shanghai）。范围：`gpt-image-2.6`、`gpt-image-2.6-1k`、`gpt-image-2.6-flare`、`gpt-image-2.6-sunburst`。

## 验收项与结果

| 项目 | 预期 | 本地结果 |
|---|---|---|
| 参考图 + GIF 输出类型 | 使用 `/images/edits`，multipart 包含图片文件和 `output_format=gif`，不强制蒙版 | 四个型号在 GPT / Tuzi 适配器测试中通过 |
| 官方 2.6 GIF 帧数 | 所选 `frame_count` 进入编辑表单 | 三个型号的本地测试通过 |
| GIF 结果 | 保留实际 GIF 格式和返回尺寸 | 本地响应解析测试通过 |
| 普通参考图请求 | 保留原有 Tuzi JSON 生成路由 | 本地回归测试通过 |
| 2.6 参数菜单 | 尺寸和输出类型可见 | 参数组件测试通过 |

本轮命令：Drawnix 目录下运行相关 Vitest 5 个文件，310 项通过；`tsc -p packages/drawnix/tsconfig.lib.json --noEmit`、`vite build --config apps/web/vite.config.ts`、`git diff --check` 通过。构建保留已有的 Sass 弃用和大 chunk 提示。ESLint 在 `gpt-image-adapter.ts` 现有 `@aitu/utils` 静态导入处报模块边界错误，其他输出为既有警告，未在本任务内修改该导入。

上一轮直接调用 Tuzi `gpt-image-2.6-1k` 的 `POST /v1/images/edits`，静态参考图加 `output_format=gif` 返回 HTTP 200，GIF 为 437×389、9 个不同画面帧、无限循环。该调用发生在代码修改前，只验证上游接口能力，不等同于本轮应用页面验收。

未执行页面自动化或视觉测试；未对 `gpt-image-2.6`、Flare、Sunburst 发起真实付费生成。不同渠道的型号开放情况、GIF 细节一致性和实际费用仍以渠道返回为准。

## 合并审查补充

修复提示词误将 `gift` / `gifted` 识别为 GIF 的问题；通过 `output_format=svg` 明确指定 SVG 时继续执行参考图限制，不因提示词包含 GIF 而覆盖输出类型。补充四型号回归，并将旧测试中“拒绝参考图 GIF”的断言更新为只拒绝参考图 SVG。

相关 Vitest 11 个文件、635 项通过，Web / Drawnix 类型检查通过。真实 Chromium 验证四型号 × 两适配器 × 输出选择或提示词识别，共 16 种组合：浏览器原生 multipart 含 `image[]` 与 `output_format=gif`，无蒙版可提交，官方型号保留帧数，GIF 响应保留格式，每次仅提交一次。上游响应采用本地模拟，未做真实付费生成或完整页面生成操作验收。
