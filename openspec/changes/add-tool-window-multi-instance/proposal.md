# Change: add tool window multi instance

## Why
当前工具弹窗运行时以 `toolId` 作为唯一窗口键，同一个工具只能打开一个弹窗实例，无法像桌面窗口一样并行处理多个任务。视频生成等高时延工具需要多开并发工作，因此需要将工具窗体能力升级为多实例模型。

## What Changes
- 将工具窗口状态从“按工具”升级为“按实例”，为每个弹窗引入稳定的 `instanceId`
- 在工具栏工具图标右键菜单增加“新窗口打开”，并让同工具的多个实例各自显示为独立图标
- 为内部工具组件注入实例上下文，允许工具按实例更新尺寸、最小化、关闭等窗口行为
- 对仍依赖单例 `toolId` 的内部工具保留兼容行为，未适配前不开放多实例入口

## Impact
- Affected specs: `toolbox-plugin-runtime`, `toolbox`
- Affected code:
  - `packages/drawnix/src/services/tool-window-service.ts`
  - `packages/drawnix/src/components/toolbox-drawer/ToolWinBoxManager.tsx`
  - `packages/drawnix/src/components/toolbar/minimized-tools-bar/MinimizedToolsBar.tsx`
  - `packages/drawnix/src/components/toolbar/toolbar-context-menu.tsx`
