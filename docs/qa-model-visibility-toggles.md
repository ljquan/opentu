# 模型显示开关 QA

## 范围

- 设置页新增“模型显示”面板。
- 一个“隐藏代码中指定的模型”总开关，覆盖 `happyhorse-1.0-*`、`gemini-omni-1.1-flash*`、`veo2/veo-2*`、`veo3/veo-3*` 和 `DEFAULT_HIDDEN_MODEL_IDS`。
- 静态模型、运行时发现模型、模型预设和前端模型选择器的统一过滤。

## 环境

- 本地工作区：`/Users/lkj/Desktop/working/opentu`
- 分支：`develop`
- 验证日期：2026-11-14
- 未调用真实供应商或计费接口。

## 已执行验证

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/constants/__tests__/model-visibility.test.ts src/utils/__tests__/runtime-model-discovery.test.ts src/utils/__tests__/settings-manager.test.ts`（`packages/drawnix`） | 通过，40 项 |
| `pnpm exec vitest run src/components/ai-input-bar/ModelDropdown.test.tsx`（`packages/drawnix`） | 通过，23 项 |
| `pnpm exec nx run drawnix:typecheck` | 通过 |
| `pnpm exec eslint ...`（本次涉及文件） | 通过，保留项目既有 warnings，无 error |
| `pnpm exec nx build web` | 通过，包含 web typecheck、应用构建和 Service Worker 构建 |
| `git diff --check` | 通过 |

## 逻辑验收

- 未保存模型显示设置时，总开关默认开启，代码中指定的模型默认隐藏。
- 关闭总开关后，静态和运行时发现的匹配 ID 可重新出现在选择项中。
- 通配旧 ID（如 `gpt-5-gizmo-*`）按前缀处理。
- 已保存的模型预设仍可保留被隐藏模型，显式路由和请求解析不因展示开关失效。

## 未执行项与边界

- 未执行浏览器页面点击或视觉回归，符合项目默认不做页面测试的约定。
- 运行完整设置对话框测试时，`TuziAccountPanel.test.tsx` 的 19 项因测试环境未提供 `window.localStorage` 而失败；该失败发生在测试初始化清理阶段，与本次模型显示逻辑无关。其余相关设置和模型测试通过。
- OpenSpec CLI 未安装，`openspec validate add-model-visibility-toggles --strict` 无法执行；提案文件已按项目格式人工检查。
