# Change: 将工作流合并为 OpenTu 单一应用

## Why

当前工作流前端是独立的 React 19/Vite 7 应用，通过 iframe 嵌入 OpenTu React 18/Vite 6 主应用。两边依赖、路由、样式和运行时隔离，导致工作流必须先生成静态构建产物才能打开，修改工作流代码也不会跟随 OpenTu 自动热更新。生成、模型同步和配置还依赖 `postMessage` 桥接，增加了运行时边界和故障面。

## What Changes

- 将工作流页面源码纳入 OpenTu 主应用的同一构建入口和开发服务器。
- 移除工作流 iframe、宿主加载检查和 `postMessage` 生成/模型同步桥接。
- 将工作流路由接入 OpenTu 路由体系；保留 `/workflow` 入口和工作流内部页面路径。
- 将工作流的生成、模型目录、配置和 OpenTu provider settings 改为直接调用主应用已有服务/状态。
- 统一 React 与 React DOM 版本，处理 React 18 兼容性问题；统一 Vite、TypeScript、别名和依赖安装。
- 将工作流 Tailwind/Ant Design 样式限定在工作流根节点或明确的 CSS 层，避免污染普通画布；保留主题、语言和页面标题同步。
- 删除独立工作流构建产物依赖，普通 OpenTu 和工作流源码修改都通过同一 Vite HMR 链路更新。
- 保留现有工作流本地数据键、记录格式、插件数据和导入导出格式；不自动迁移或清理历史数据。

## Impact

- Affected specs: `unified-workflow-runtime`
- Affected code:
  - `packages/drawnix/src/workflow-mode/web/src/`
  - `packages/drawnix/src/workflow-mode/host/`
  - `packages/drawnix/src/drawnix.tsx` and OpenTu route/bootstrap code
  - `apps/web/vite.config.ts`, root `package.json`, workspace dependency configuration
  - workflow tests and integration documentation
- Breaking/compatibility: direct `/workflow` navigation remains supported; embedded standalone workflow build and iframe-only `window.parent` integration are removed from the supported runtime.
