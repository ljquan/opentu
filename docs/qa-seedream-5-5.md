# Seedream 5.5 接入与本地验收

日期：2026-11-14。模型：`doubao-seedream-5-5-261028`。

## 使用与实现

- 在供应商设置中获取模型，选择该模型后使用图片生成入口。
- Tuzi 模型绑定使用 `POST /api/v3/images/generations`，通过 `trim-v1` 去除 API 地址末尾的 `/v1`。参考图以 JSON `image` 提交，沿用生成接口。
- 原生尺寸档位为 `1K`、`1.5K`、`2K`，默认 `2K`；`auto` 仅用于拆图。旧比例输入在适配器内映射为像素尺寸。
- 支持透明/不透明背景、PNG/JPEG 输出、最多 10 张参考图。透明背景应使用 PNG；该模型不提供 OpenAI mask 编辑能力。
- 原生图层 Provider 识别 5.5，并提交 `layer_decomposition_options.max_images`，兼容不含质量评分的原生响应。本次没有切换现有固定分层模型，没有新增 OCR 排版或 99 层编辑界面。
- 模型目录和参数位于 `model-config.ts`；路由由 `binding-inference.ts` 产生；请求由 `seedream-adapter.ts` 构造。
- MCP 图片工具保留该模型的原生尺寸，避免把 `1.5K` 转成通用 `1x1`。
- 不硬编码价格；价格依赖供应商目录及实际账单。Tuzi 按请求档位计费，拆图不按各图层实际像素逐张定档。

## 验证环境与结果

本地 checkout：`opentu5`，`develop`，Node 26.8.1，ego-browser 技能指南 2.2.1。
启动命令：`OPENTU_PORT=7205 pnpm start`，页面 `http://localhost:7205`。
浏览器已有供应商配置，本轮没有读取或输出 API Key。

| 检查 | 结果 |
| --- | --- |
| 模型选择与参数控件 | 页面可选择 5.5，显示原生尺寸、透明背景和 PNG/JPEG |
| 首次模拟提交 | 发现 1.5K 被转换为 1x1；修复 MCP 尺寸归一化及适配器比例解析顺序 |
| 文字生图复测 | 拦截请求为 `https://api.tu-zi.com/api/v3/images/generations?ch=2`，`model` 精确 ID、`size: 1.5K`、`background: transparent`、`output_format: png`、`response_format: b64_json` |
| 参考图复测 | 本地产生测试 PNG 并上传；模拟请求含 JSON `image`，路径和参数保持一致 |
| 结果展示 | 模拟任务完成；本地产生的 512×512 PNG 可打开预览并显示，文件标有 LOCAL MOCK QA |
| 刷新恢复 | 页面仍选择 5.5、1.5K、透明、PNG |
| 单元测试 | 下述 5 个文件共 230 项通过，覆盖旧模型参数/路由、原生尺寸、超量参考图拒绝和现有异常响应 |
| 类型检查 | `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit` 通过 |
| 差异检查 | `git diff --check` 通过 |

```sh
pnpm exec vitest run \
  packages/drawnix/src/constants/__tests__/model-config.test.ts \
  packages/drawnix/src/services/__tests__/provider-routing.test.ts \
  packages/drawnix/src/services/layer-decomposition/provider.test.ts \
  packages/drawnix/src/services/model-adapters/__tests__/seedream-response.test.ts \
  packages/drawnix/src/mcp/tools/__tests__/image-generation.test.ts
```

## 边界与未执行项

- 浏览器生成请求在发送前被 fetch 模拟和网络阻断保护拦截，没有真实生成费用；模拟只能验证页面、请求构造、缓存与展示，不能证明真实上游生成、收费或图层响应可用。
- 测试结束前移除模拟与网络阻断，并刷新页面。浏览器保留 3 条以“本地模拟测试”标记的完成任务及测试产物。
- 未执行真实 v3 生图/拆图、OCR、mask、生产部署或远程 CI；未修改服务端。真实图层响应仍受既有解析与质量门禁约束。
- 模拟结果在队列中显示“未知尺寸”，但预览可以解码显示；尺寸元数据展示尚未单独补齐。
- 先前执行的全量测试存在失败，尚未通过干净基线逐项对照归因，不将其报告为本次全量通过。
- 回退时撤回本任务的模型、路由、适配器、MCP 尺寸及对应测试改动，保留其他工作。Git 提交和 PR 状态以仓库记录为准。

接口依据：[Tuzi 模型说明](https://api.tu-zi.com/pricing?model=doubao-seedream-5-5-261028)；实际可用性以所选服务商为准。
